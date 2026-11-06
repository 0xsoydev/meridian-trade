import { appendFileSync, readFileSync } from "node:fs";
import {
  AccountCreateTransaction,
  Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
} from "@hiero-ledger/sdk";
import { isHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_PATH = ".env";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function treasuryKey(secret: string): PrivateKey {
  return secret.startsWith("302a") || secret.startsWith("302e")
    ? PrivateKey.fromStringDer(secret)
    : PrivateKey.fromStringECDSA(secret);
}

function envValues(): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i <= 0) continue;
      const name = line.slice(0, i).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        map[name] = line.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
      }
    }
  } catch {
    throw new Error("run this from apps/web so it can read .env");
  }
  return map;
}

function append(lines: string[]): void {
  let text = "";
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    text = "";
  }
  const prefix = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
  appendFileSync(ENV_PATH, `${prefix}${lines.join("\n")}\n`, "utf8");
}

async function createHederaAgent(): Promise<{ id: string; key: string }> {
  const treasuryId = required("HEDERA_TREASURY_ID");
  const treasurySecret = required("HEDERA_TREASURY_KEY");
  const usdc = process.env.HEDERA_USDC ?? "0.0.429274";

  const client = Client.forTestnet();
  client.setRequestTimeout(30_000);
  const treasury = treasuryKey(treasurySecret);
  client.setOperator(treasuryId, treasury);

  try {
    const agentKey = PrivateKey.generateECDSA();
    const created = await (
      await new AccountCreateTransaction()
        .setKey(agentKey.publicKey)
        .setInitialBalance(new Hbar(2))
        .execute(client)
    ).getReceipt(client);
    const id = created.accountId?.toString();
    if (!id) throw new Error("account creation returned no account id");

    const associate = new TokenAssociateTransaction().setAccountId(id).setTokenIds([usdc]);
    associate.freezeWith(client);
    await associate.sign(agentKey);
    const associated = await (await associate.execute(client)).getReceipt(client);
    if (associated.status.toString() !== "SUCCESS") {
      throw new Error(`token association failed: ${associated.status}`);
    }

    return { id, key: agentKey.toStringDer() };
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  const values = envValues();
  const lines: string[] = [];
  let agentId = values.HEDERA_AGENT_ID ?? "";
  const agentKey = values.HEDERA_AGENT_KEY ?? "";
  let galileoKey = values.GALILEO_AGENT_KEY ?? "";

  if (!agentId || !agentKey) {
    const created = await createHederaAgent();
    agentId = created.id;
    lines.push(`HEDERA_AGENT_ID=${created.id}`, `HEDERA_AGENT_KEY=${created.key}`);
    console.log(`hedera agent  ${created.id} (2 HBAR, USDC associated)`);
  } else {
    console.log(`hedera agent  ${agentId} (already configured)`);
  }

  if (!galileoKey) {
    galileoKey = generatePrivateKey();
    lines.push(`GALILEO_AGENT_KEY=${galileoKey}`);
    console.log(`galileo key   generated`);
  }

  if (lines.length > 0) append(lines);

  if (!isHex(galileoKey) || galileoKey.length !== 66) throw new Error("GALILEO_AGENT_KEY must be a 0x-prefixed 32-byte hex key");
  const galileoAddress = privateKeyToAccount(galileoKey).address;
  console.log(`galileo addr  ${galileoAddress}`);
  console.log("");
  console.log("next:");
  console.log(`  circle faucet  https://faucet.circle.com  Hedera Testnet  ${agentId}  -> 10 USDC`);
  console.log(`  0g faucet      https://faucet.0g.ai       ${galileoAddress}  -> 0.1 0G`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
