import {
  Client,
  PrivateKey,
  TokenAssociateTransaction,
  TopicCreateTransaction,
} from "@hiero-ledger/sdk";

let client: Client | null = null;

function treasuryKey(secret: string): PrivateKey {
  return secret.startsWith("302a") || secret.startsWith("302e")
    ? PrivateKey.fromStringDer(secret)
    : PrivateKey.fromStringECDSA(secret);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function mirrorBase(): string {
  return process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
}

async function hbarBalance(account: string): Promise<string> {
  try {
    const response = await fetch(`${mirrorBase()}/api/v1/accounts/${account}`);
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { balance?: { balance?: number } };
    return String((body.balance?.balance ?? 0) / 100_000_000);
  } catch {
    return "unknown";
  }
}

async function associatedTokens(account: string): Promise<Set<string>> {
  try {
    const response = await fetch(`${mirrorBase()}/api/v1/accounts/${account}/tokens?limit=100`);
    if (!response.ok) return new Set();
    const body = (await response.json()) as { tokens?: Array<{ token_id: string }> };
    return new Set((body.tokens ?? []).map((token) => token.token_id));
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  const account = required("HEDERA_TREASURY_ID");
  const secret = required("HEDERA_TREASURY_KEY");
  const usdc = process.env.HEDERA_USDC ?? "0.0.429274";
  const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";

  const connection = network.includes("mainnet") ? Client.forMainnet() : Client.forTestnet();
  connection.setRequestTimeout(30_000);
  client = connection;
  connection.setOperator(account, treasuryKey(secret));

  console.log(`treasury ${account} balance: ${await hbarBalance(account)} HBAR`);

  const tokens = await associatedTokens(account);
  if (tokens.has(usdc)) {
    console.log(`token ${usdc} already associated`);
  } else {
    const receipt = await (
      await new TokenAssociateTransaction().setAccountId(account).setTokenIds([usdc]).execute(connection)
    ).getReceipt(connection);
    if (receipt.status.toString() !== "SUCCESS") throw new Error(`association failed: ${receipt.status}`);
    console.log(`token ${usdc} associated`);
  }

  const existing = process.env.HCS_TOPIC_ID;
  if (existing) {
    console.log(`topic already configured: ${existing}`);
  } else {
    const receipt = await (
      await new TopicCreateTransaction().setTopicMemo("celestial-trade").execute(connection)
    ).getReceipt(connection);
    if (!receipt.topicId) throw new Error("topic creation returned no topic id");
    console.log(`HCS_TOPIC_ID=${receipt.topicId.toString()}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client?.close());
