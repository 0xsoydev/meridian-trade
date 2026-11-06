import assert from "node:assert/strict";
import { createWalletClient, erc20Abi, http, isHex, parseEther, type Hash } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mockUsdcAbi, perpMarketAbi } from "../lib/abi.ts";
import { addresses, galileo, publicClient } from "../lib/chain.ts";
import { modify, openMargin, readMarket, readPosition, type PerpWallet } from "../lib/perp.ts";

const MODEL = process.env.MODEL ?? "deepseek-v4.1-flash";
const LONG_TOKENS = 5_000_000n;
const SHORT_TOKENS = 2_000_000n;
const WAIT_MS = 30 * 60_000;
const POLL_MS = 20_000;

const funderKey = process.env.GALILEO_AGENT_KEY;
if (!funderKey || !isHex(funderKey) || funderKey.length !== 66) throw new Error("GALILEO_AGENT_KEY must be a 0x-prefixed 32-byte hex key");

const client = publicClient();
const { mockUsdc, perpMarket } = addresses();
const funder = createWalletClient({ account: privateKeyToAccount(funderKey), chain: galileo, transport: http() });
const usd = (micro: bigint) => `$${(Number(micro) / 1e6).toFixed(6)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mined = async (hash: Hash) => {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `transaction ${hash} reverted`);
  return receipt;
};
const usdcOf = (address: `0x${string}`) =>
  client.readContract({ address: mockUsdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });

async function trader(label: string): Promise<PerpWallet> {
  const wallet = createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: galileo, transport: http() });
  await mined(await funder.sendTransaction({ to: wallet.account.address, value: parseEther("0.01") }));
  await mined(
    await wallet.writeContract({ address: mockUsdc, abi: mockUsdcAbi, functionName: "mint", args: [wallet.account.address, 100_000_000n] }),
  );
  console.log(`${label} ${wallet.account.address} holds 0.01 0G and 100 MockUSDC`);
  return wallet;
}

const start = await readMarket(MODEL);
if (start.updatedAt === 0n || BigInt(Math.floor(Date.now() / 1000)) - start.updatedAt > 600n) {
  throw new Error(`${MODEL} index is stale; start the keeper`);
}
const fromBlock = await client.getBlockNumber();
console.log(`market     ${MODEL} index ${usd(start.price)} per MTok, funding ${(Number(start.fundingRatePerHour) / 1e16).toFixed(4)}% per hour`);

const longWallet = await trader("long ");
const shortWallet = await trader("short");

const longOpened = await modify(longWallet, MODEL, LONG_TOKENS, openMargin(LONG_TOKENS, start.price, 5n));
await mined(longOpened);
console.log(`long  open ${longOpened}`);
const shortOpened = await modify(shortWallet, MODEL, -SHORT_TOKENS, openMargin(-SHORT_TOKENS, start.price, 2n));
await mined(shortOpened);
console.log(`short open ${shortOpened}`);

const long = await readPosition(MODEL, longWallet.account.address);
assert.equal(long.size, LONG_TOKENS);
const short = await readPosition(MODEL, shortWallet.account.address);
assert.equal(short.size, -SHORT_TOKENS);
console.log(`long       ${LONG_TOKENS / 1_000_000n} MTok at ${usd(long.entryPrice)}, margin ${usd(long.margin)}, liquidation at ${usd(long.liquidationPrice)}`);
console.log(`short      ${SHORT_TOKENS / 1_000_000n} MTok at ${usd(short.entryPrice)}, margin ${usd(short.margin)}`);

const deadline = Date.now() + WAIT_MS;
for (;;) {
  const position = await readPosition(MODEL, longWallet.account.address);
  if (position.size === 0n) break;
  if (Date.now() > deadline) throw new Error(`the long was not liquidated within ${WAIT_MS / 60_000} minutes`);
  const market = await readMarket(MODEL);
  console.log(`waiting    index ${usd(market.price)}, long equity ${usd(position.equity)}`);
  await sleep(POLL_MS);
}

const [liquidated] = await client.getContractEvents({
  address: perpMarket,
  abi: perpMarketAbi,
  eventName: "Liquidated",
  args: { account: longWallet.account.address },
  fromBlock,
});
assert.ok(liquidated, "the long closed without a Liquidated event");
console.log(`liquidated by ${liquidated.args.liquidator}, reward ${usd(liquidated.args.reward ?? 0n)}, tx ${liquidated.transactionHash}`);

const before = await usdcOf(shortWallet.account.address);
const held = await readPosition(MODEL, shortWallet.account.address);
await mined(await modify(shortWallet, MODEL, -held.size, 0n));
const received = (await usdcOf(shortWallet.account.address)) - before;
assert.ok(received > held.margin, "the short closed without a profit");
console.log(`short      closed at ${usd((await readMarket(MODEL)).price)}, received ${usd(received)} on ${usd(held.margin)} margin`);
