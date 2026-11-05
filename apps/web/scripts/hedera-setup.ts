import {
  AccountBalanceQuery,
  Client,
  PrivateKey,
  TokenAssociateTransaction,
  TopicCreateTransaction,
} from "@hiero-ledger/sdk";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function associatedTokens(account: string): Promise<Set<string>> {
  const base = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
  const response = await fetch(`${base}/api/v1/accounts/${account}/tokens?limit=100`);
  if (!response.ok) return new Set();
  const body = (await response.json()) as { tokens?: Array<{ token_id: string }> };
  return new Set((body.tokens ?? []).map((token) => token.token_id));
}

async function main(): Promise<void> {
  const account = required("HEDERA_TREASURY_ID");
  const secret = required("HEDERA_TREASURY_KEY");
  const usdc = process.env.HEDERA_USDC ?? "0.0.429274";
  const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";

  const client = network.includes("mainnet") ? Client.forMainnet() : Client.forTestnet();
  const key = PrivateKey.fromString(secret);
  client.setOperator(account, key);

  const balance = await new AccountBalanceQuery().setAccountId(account).execute(client);
  console.log(`treasury ${account} balance: ${balance.hbars.toString()}`);

  const tokens = await associatedTokens(account);
  if (tokens.has(usdc)) {
    console.log(`token ${usdc} already associated`);
  } else {
    const receipt = await (
      await new TokenAssociateTransaction().setAccountId(account).setTokenIds([usdc]).execute(client)
    ).getReceipt(client);
    if (receipt.status.toString() !== "SUCCESS") throw new Error(`association failed: ${receipt.status}`);
    console.log(`token ${usdc} associated`);
  }

  const existing = process.env.HCS_TOPIC_ID;
  if (existing) {
    console.log(`topic already configured: ${existing}`);
  } else {
    const receipt = await (await new TopicCreateTransaction().setTopicMemo("celestial-trade").execute(client)).getReceipt(
      client,
    );
    if (!receipt.topicId) throw new Error("topic creation returned no topic id");
    console.log(`HCS_TOPIC_ID=${receipt.topicId.toString()}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
