import { keccak256, toBytes, type Account, type Address, type Chain, type Hash, type Transport, type WalletClient } from "viem";
import { indexOracleAbi, mockUsdcAbi, perpMarketAbi } from "./abi.ts";
import { addresses, galileo, publicClient } from "./chain.ts";

export const MARKETS = ["glm-5.3", "0gm-1.0-35b-a3b", "deepseek-v4.1-flash"] as const;

const MM_BPS = 500n;
const SEARCH_CEILING = 1n << 128n;

export type PerpWallet = WalletClient<Transport, Chain, Account>;

export type PositionMath = { size: bigint; margin: bigint; entryPrice: bigint; fundingOwed: bigint };

export function marketId(model: string): Hash {
  return keccak256(toBytes(model));
}

function pnl(size: bigint, entryPrice: bigint, price: bigint): bigint {
  return (size * (price - entryPrice)) / 1_000_000n;
}

export function notional(size: bigint, price: bigint): bigint {
  return ((size < 0n ? -size : size) * price) / 1_000_000n;
}

export function liquidatable(p: PositionMath, price: bigint): boolean {
  const equity = p.margin + pnl(p.size, p.entryPrice, price) - p.fundingOwed;
  const notional = ((p.size < 0n ? -p.size : p.size) * price) / 1_000_000n;
  return equity * 10_000n < notional * MM_BPS;
}

export function liquidationPrice(p: PositionMath): bigint {
  if (p.size === 0n) return 0n;
  const long = p.size > 0n;
  if (long && !liquidatable(p, 0n)) return 0n;
  let safe = long ? SEARCH_CEILING : 0n;
  let liq = long ? 0n : SEARCH_CEILING;
  while ((long ? safe - liq : liq - safe) > 1n) {
    const mid = (safe + liq) / 2n;
    if (liquidatable(p, mid)) liq = mid;
    else safe = mid;
  }
  return liq;
}

export function openMargin(sizeDelta: bigint, price: bigint, maxLeverage: bigint): bigint {
  const size = sizeDelta < 0n ? -sizeDelta : sizeDelta;
  const value = notional(size, price);
  const fee = (size * price * 10n + 9_999_999_999n) / 10_000_000_000n;
  return value / maxLeverage + value / 100n + fee + 1n;
}

export async function readMarket(model: string) {
  const client = publicClient();
  const { perpMarket, indexOracle } = addresses();
  const id = marketId(model);
  const [[price, updatedAt], market, rate] = await Promise.all([
    client.readContract({ address: indexOracle, abi: indexOracleAbi, functionName: "latest", args: [id] }),
    client.readContract({ address: perpMarket, abi: perpMarketAbi, functionName: "markets", args: [id] }),
    client.readContract({ address: perpMarket, abi: perpMarketAbi, functionName: "fundingRate", args: [id] }),
  ]);
  return { price, updatedAt, longOi: market[3], shortOi: market[4], fundingRatePerHour: rate * 3600n };
}

export async function readPosition(model: string, account: Address) {
  const client = publicClient();
  const { perpMarket, indexOracle } = addresses();
  const id = marketId(model);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [position, equity, [price]] = await Promise.all([
    client.readContract({ address: perpMarket, abi: perpMarketAbi, functionName: "positions", args: [account, id], blockNumber }),
    client.readContract({ address: perpMarket, abi: perpMarketAbi, functionName: "equity", args: [account, id], blockNumber }),
    client.readContract({ address: indexOracle, abi: indexOracleAbi, functionName: "latest", args: [id], blockNumber }),
  ]);
  const fundingOwed = position.margin + pnl(position.size, position.entryPrice, price) - equity;
  return {
    size: position.size,
    margin: position.margin,
    entryPrice: position.entryPrice,
    equity,
    liquidationPrice: liquidationPrice({ ...position, fundingOwed }),
  };
}

export async function modify(wallet: PerpWallet, model: string, sizeDelta: bigint, marginDelta: bigint): Promise<Hash> {
  const client = publicClient();
  const { perpMarket, mockUsdc } = addresses();
  if (marginDelta > 0n) {
    const allowance = await client.readContract({
      address: mockUsdc,
      abi: mockUsdcAbi,
      functionName: "allowance",
      args: [wallet.account.address, perpMarket],
    });
    if (allowance < marginDelta) {
      const { request } = await client.simulateContract({
        account: wallet.account,
        chain: galileo,
        address: mockUsdc,
        abi: mockUsdcAbi,
        functionName: "approve",
        args: [perpMarket, marginDelta],
      });
      const receipt = await client.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
      if (receipt.status !== "success") throw new Error("USDC approval reverted");
    }
  }
  const { request } = await client.simulateContract({
    account: wallet.account,
    chain: galileo,
    address: perpMarket,
    abi: [...perpMarketAbi, ...mockUsdcAbi],
    functionName: "modify",
    args: [marketId(model), sizeDelta, marginDelta],
  });
  return wallet.writeContract(request);
}

export async function liquidate(wallet: PerpWallet, account: Address, model: string): Promise<Hash> {
  const { request } = await publicClient().simulateContract({
    account: wallet.account,
    address: addresses().perpMarket,
    abi: perpMarketAbi,
    functionName: "liquidate",
    args: [account, marketId(model)],
  });
  return wallet.writeContract(request);
}

export async function needsLiquidation(account: Address, model: string): Promise<boolean> {
  return publicClient().readContract({
    address: addresses().perpMarket,
    abi: perpMarketAbi,
    functionName: "canLiquidate",
    args: [account, marketId(model)],
  });
}

export async function postIndex(
  wallet: PerpWallet,
  model: string,
  price: bigint,
  seqFrom: bigint,
  seqTo: bigint,
): Promise<Hash> {
  const { request } = await publicClient().simulateContract({
    account: wallet.account,
    address: addresses().indexOracle,
    abi: indexOracleAbi,
    functionName: "post",
    args: [marketId(model), price, seqFrom, seqTo],
  });
  return wallet.writeContract(request);
}

export async function positionAccounts(fromBlock: bigint, toBlock: bigint) {
  const events = await publicClient().getContractEvents({
    address: addresses().perpMarket,
    abi: perpMarketAbi,
    eventName: "PositionModified",
    fromBlock,
    toBlock,
  });
  return events.flatMap((e) => (e.args.account && e.args.market ? [{ account: e.args.account, market: e.args.market }] : []));
}
