import { createPublicClient, createWalletClient, defineChain, http, isAddress, isHex, nonceManager, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const galileo = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_GALILEO_RPC ?? "https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: { default: { name: "Chainscan", url: "https://chainscan-galileo.0g.ai" } },
});

function address(name: string, value: string | undefined): Address {
  if (!value || !isAddress(value)) throw new Error(`${name} is not set`);
  return value;
}

export function addresses() {
  return {
    perpMarket: address("NEXT_PUBLIC_PERP_MARKET", process.env.NEXT_PUBLIC_PERP_MARKET),
    indexOracle: address("NEXT_PUBLIC_INDEX_ORACLE", process.env.NEXT_PUBLIC_INDEX_ORACLE),
    mockUsdc: address("NEXT_PUBLIC_MOCK_USDC", process.env.NEXT_PUBLIC_MOCK_USDC),
  };
}

function createClient() {
  return createPublicClient({ chain: galileo, transport: http() });
}

let client: ReturnType<typeof createClient> | null = null;

export function publicClient() {
  if (!client) client = createClient();
  return client;
}

export function keeperWallet() {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key || !isHex(key) || key.length !== 66) throw new Error("KEEPER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  return createWalletClient({ account: privateKeyToAccount(key, { nonceManager }), chain: galileo, transport: http() });
}
