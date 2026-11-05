import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactHederaScheme, PrivateKey, createClientHederaSigner } from "@x402/hedera";
import OpenAI from "openai";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NETWORK = "hedera:testnet";
const ROUTER_URL = (process.env.ROUTER_URL ?? process.env.PUBLIC_HOST ?? "http://localhost:3000").replace(/\/+$/, "");
const MODEL = process.env.MODEL ?? "0gm-1.0-35b-a3b";
const TOPUP_USD = "0.50";
const AUTO_TOPUP_MICRO = "1000000";
const DAILY_CAP_MICRO = "2000000";
const RAISE_CAP_MICRO = "10000000";
const MIRROR = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

const galileo = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_GALILEO_RPC ?? "https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: { default: { name: "Chainscan", url: "https://chainscan-galileo.0g.ai" } },
});

const usdcAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const perpAbi = [
  {
    type: "function",
    name: "modify",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "bytes32" },
      { name: "sizeDelta", type: "int256" },
      { name: "marginDelta", type: "int256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "maxLeverage", type: "uint256" },
      { name: "maxOiTokens", type: "uint256" },
      { name: "fundingK", type: "int256" },
      { name: "longOi", type: "uint256" },
      { name: "shortOi", type: "uint256" },
      { name: "cumFunding", type: "int256" },
      { name: "lastAccrual", type: "uint64" },
      { name: "listed", type: "bool" },
    ],
  },
] as const;

const oracleAbi = [
  {
    type: "function",
    name: "latest",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "priceMicroPerMTok", type: "uint256" },
      { name: "updatedAt", type: "uint64" },
    ],
  },
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function hederaKey(secret: string): PrivateKey {
  const trimmed = secret.replace(/^0x/, "");
  return trimmed.startsWith("302a") || trimmed.startsWith("302e")
    ? PrivateKey.fromStringDer(trimmed)
    : PrivateKey.fromStringECDSA(trimmed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashscan(txId: string): string {
  return `https://hashscan.io/testnet/transaction/${txId.replace("@", "-")}`;
}

async function waitForAgent(agentId: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${MIRROR}/api/v1/accounts/${agentId}`);
    if (response.ok) {
      console.log(`mirror        agent ${agentId} is visible`);
      return;
    }
    await sleep(2000);
  }
  console.log(`mirror        agent ${agentId} is still not visible; payments may fail`);
}

async function topUp(pay: ReturnType<typeof wrapFetchWithPayment>): Promise<{ key: string; keyId: string; txId: string }> {
  const response = await pay(`${ROUTER_URL}/api/v1/topup?usd=${TOPUP_USD}`, { method: "POST" });
  const text = await response.text();
  if (!response.ok) throw new Error(`top-up answered ${response.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as { key?: string; key_id: string; balance_usd_micro: string; tx_id: string };
  if (!body.key) throw new Error("top-up did not return a router key");
  console.log(`top-up        ${body.balance_usd_micro} micro USD, tx ${body.tx_id}`);
  console.log(`hashscan      ${hashscan(body.tx_id)}`);
  return { key: body.key, keyId: body.key_id, txId: body.tx_id };
}

async function configure(key: string): Promise<void> {
  const response = await fetch(`${ROUTER_URL}/api/v1/keys/settings`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ auto_topup_usd_micro: AUTO_TOPUP_MICRO, daily_topup_cap_usd_micro: DAILY_CAP_MICRO }),
  });
  console.log(`settings      ${response.status}`);
}

type Approval = {
  approval_id: string;
  user_code: string;
  verification_uri_complete: string;
  expires_at: string;
};

async function waitForApproval(key: string, approval: Approval): Promise<boolean> {
  console.log(`approval      open ${approval.verification_uri_complete}`);
  console.log(`approval      code ${approval.user_code} (expires ${approval.expires_at})`);

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(3000);
    const poll = await fetch(`${ROUTER_URL}/api/v1/approvals/${approval.approval_id}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!poll.ok) {
      console.log(`approval      poll answered ${poll.status}`);
      return false;
    }
    const status = (await poll.json()) as { status: string };
    console.log(`approval      ${status.status}`);
    if (status.status === "approved") return true;
    if (status.status === "denied" || status.status === "expired") {
      console.log("approval      deny path taken");
      return false;
    }
    if (attempt === 29) {
      console.log("approval      still pending; continuing without it");
      return false;
    }
  }
  return false;
}

async function linkHuman(key: string): Promise<boolean> {
  const response = await fetch(`${ROUTER_URL}/api/v1/approvals`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "link_human" }),
  });
  if (!response.ok) {
    console.log(`link          answered ${response.status}`);
    return false;
  }
  return waitForApproval(key, (await response.json()) as Approval);
}

async function demonstrateApproval(key: string): Promise<void> {
  console.log("link          requesting a human link");
  const linked = await linkHuman(key);
  if (!linked) {
    console.log("link          not approved; skipping the cap raise");
    return;
  }

  const response = await fetch(`${ROUTER_URL}/api/v1/keys/settings`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ daily_topup_cap_usd_micro: RAISE_CAP_MICRO }),
  });

  if (response.status !== 403) {
    console.log(`approval      cap raise answered ${response.status}; nothing to approve`);
    return;
  }

  const body = (await response.json()) as { approval?: Approval };
  const approval = body.approval;
  if (!approval) {
    console.log("approval      the 403 carried no approval object");
    return;
  }

  const approved = await waitForApproval(key, approval);
  if (!approved) return;

  const retry = await fetch(`${ROUTER_URL}/api/v1/keys/settings`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ daily_topup_cap_usd_micro: RAISE_CAP_MICRO }),
  });
  console.log(`approval      cap raise after approval ${retry.status}`);
}

async function streamOnce(client: OpenAI, prompt: string): Promise<void> {
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    stream: true,
    max_tokens: 64,
  });
  let text = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      text += delta;
      process.stdout.write(delta);
    }
  }
  process.stdout.write(`\nstream        ${text.length} chars\n`);
}

async function hedge(): Promise<void> {
  const secret = process.env.GALILEO_AGENT_KEY;
  const usdc = process.env.NEXT_PUBLIC_MOCK_USDC;
  const perp = process.env.NEXT_PUBLIC_PERP_MARKET;
  const oracle = process.env.NEXT_PUBLIC_INDEX_ORACLE;
  if (!secret || !usdc || !perp || !oracle) {
    console.log("hedge         skipped: GALILEO_AGENT_KEY or contract addresses missing");
    return;
  }
  const hedgeModel = process.env.HEDGE_MODEL ?? MODEL;

  try {
    const account = privateKeyToAccount(secret as `0x${string}`);
    const transport = http();
    const wallet = createWalletClient({ account, chain: galileo, transport });
    const reader = createPublicClient({ chain: galileo, transport });

    const balance = (await reader.readContract({
      address: usdc as Address,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    if (balance < 100_000n) {
      const minted = await wallet.writeContract({
        address: usdc as Address,
        abi: usdcAbi,
        functionName: "mint",
        args: [account.address, 100_000n],
      });
      await reader.waitForTransactionReceipt({ hash: minted });
    }

    const approved = await wallet.writeContract({
      address: usdc as Address,
      abi: usdcAbi,
      functionName: "approve",
      args: [perp as Address, 100_000n],
    });
    await reader.waitForTransactionReceipt({ hash: approved });

    const market = keccak256(toBytes(hedgeModel));
    const listed = await reader.readContract({
      address: perp as Address,
      abi: perpAbi,
      functionName: "markets",
      args: [market],
    });
    if (!listed[7]) {
      console.log(`hedge         skipped: ${hedgeModel} is not listed on PerpMarket`);
      return;
    }

    const latest = await reader.readContract({
      address: oracle as Address,
      abi: oracleAbi,
      functionName: "latest",
      args: [market],
    });
    const updatedAt = Number(latest[1]);
    if (updatedAt === 0 || Math.floor(Date.now() / 1000) - updatedAt > 600) {
      console.log(`hedge         skipped: ${hedgeModel} index is stale; start the keeper`);
      return;
    }
    const modified = await wallet.writeContract({
      address: perp as Address,
      abi: perpAbi,
      functionName: "modify",
      args: [market, 100_000n, 100_000n],
    });
    await reader.waitForTransactionReceipt({ hash: modified });
    console.log(`hedge         ${hedgeModel} tx ${modified}`);
  } catch (error) {
    console.log(`hedge         skipped: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function main(): Promise<void> {
  const agentId = required("HEDERA_AGENT_ID");
  const signer = createClientHederaSigner(agentId, hederaKey(required("HEDERA_AGENT_KEY")), { network: NETWORK });
  const client = new x402Client().register(NETWORK, new ExactHederaScheme(signer));
  const pay = wrapFetchWithPayment(globalThis.fetch, client);

  await waitForAgent(agentId);
  const routerKey = await topUp(pay);
  await configure(routerKey.key);
  await demonstrateApproval(routerKey.key);

  const openai = new OpenAI({ baseURL: `${ROUTER_URL}/api/v1`, apiKey: routerKey.key, fetch: pay as typeof fetch });
  try {
    await streamOnce(openai, "In one sentence, what does a router do?");
  } catch (error) {
    console.log(`stream        failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  await hedge();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
