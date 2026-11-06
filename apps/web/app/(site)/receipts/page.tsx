import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { parseAbiItem } from "viem";
import { addresses, galileo, publicClient } from "../../../lib/chain.ts";
import { db } from "../../../lib/db.ts";
import { MARKETS, marketId, readMarket } from "../../../lib/perp.ts";
import { formatUsd } from "../../../lib/price.ts";
import { topups } from "../../../lib/schema.ts";
import type { IndexPostReceipt, MarketIndex, ReceiptsConfig, TopupReceipt } from "../../../lib/types.ts";
import { Receipts } from "./terminal";

export const metadata: Metadata = { title: "Receipts — LLM Token Exchange" };
export const dynamic = "force-dynamic";

const DEMO_MODEL = "0gm-1.0-35b-a3b";
const POST_LIMIT = 8;
const SCAN_BLOCKS = 50_000n;
const SCAN_CHUNK = 10_000n;

const indexPosted = parseAbiItem(
  "event IndexPosted(bytes32 indexed market, uint256 priceMicroPerMTok, uint64 hcsSeqFrom, uint64 hcsSeqTo)",
);

function receiptsConfig(): ReceiptsConfig {
  const topicId = process.env.HCS_TOPIC_ID;
  const payer = process.env.HEDERA_TREASURY_ID;
  if (!topicId || !payer) return { ok: false, reason: "HCS_TOPIC_ID and HEDERA_TREASURY_ID are not set" };
  return {
    ok: true,
    mirrorUrl: process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com",
    topicId,
    payer,
    network: process.env.HEDERA_NETWORK === "hedera:mainnet" ? "mainnet" : "testnet",
  };
}

async function marketIndexes(): Promise<MarketIndex[]> {
  const rows = await Promise.all(
    MARKETS.map(async (model): Promise<MarketIndex | null> => {
      try {
        return { model, priceMicroPerMtok: (await readMarket(model)).price.toString() };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((row): row is MarketIndex => row !== null);
}

async function TopupsLedger({ hashscan }: { hashscan: string | null }) {
  let rows: TopupReceipt[] | { error: string };
  try {
    const found = await db()
      .select({
        txId: topups.txId,
        amountUsdMicro: topups.amountUsdMicro,
        payer: topups.payer,
        keyId: topups.keyId,
        createdAt: topups.createdAt,
      })
      .from(topups)
      .orderBy(desc(topups.createdAt))
      .limit(20);
    rows = found.map((row) => ({
      ...row,
      amountUsdMicro: row.amountUsdMicro.toString(),
      createdAt: row.createdAt.toISOString(),
    }));
  } catch {
    rows = { error: "top-ups are not configured yet" };
  }

  return (
    <div>
      <p className="text-[13px] text-[#1E1E1E]">[ top-ups ]</p>
      {Array.isArray(rows) ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-[13px] [&_td]:pr-4 [&_th]:pr-4">
            <thead>
              <tr className="text-[#757575]">
                <th scope="col" className="pb-2 font-normal">UTC</th>
                <th scope="col" className="pb-2 font-normal">amount</th>
                <th scope="col" className="pb-2 font-normal">key</th>
                <th scope="col" className="pb-2 font-normal">payer</th>
                <th scope="col" className="pb-2 font-normal">tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.txId} className="border-t border-[#D9D9D9]">
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">{row.createdAt.slice(11, 16)}</td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">{formatUsd(BigInt(row.amountUsdMicro))}</td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">{row.keyId.slice(0, 8)}…</td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">{row.payer}</td>
                  <td className="py-2.5">
                    {hashscan ? (
                      <a
                        href={`${hashscan}/transaction/${row.txId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#1743FF] hover:underline"
                      >
                        HashScan ↗
                      </a>
                    ) : (
                      <span className="text-[#757575]">{row.txId}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-[#757575]">
              no top-ups yet — fund a key on{" "}
              <Link href="/keys" className="text-[#1743FF] hover:underline">
                /keys
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[14px] text-[#757575]">{rows.error}</p>
      )}
    </div>
  );
}

async function PostsLedger() {
  const chainscan = galileo.blockExplorers.default.url;
  let rows: IndexPostReceipt[] | { error: string };

  try {
    const client = publicClient();
    const { indexOracle } = addresses();
    const head = await client.getBlockNumber();
    const configured = process.env.PERP_DEPLOY_BLOCK;
    const floor =
      configured && /^\d+$/.test(configured) ? BigInt(configured) : head > SCAN_BLOCKS ? head - SCAN_BLOCKS : 0n;

    const modelById = new Map(MARKETS.map((model) => [marketId(model), model]));
    const stamps = new Map<string, string | null>();
    const found: IndexPostReceipt[] = [];
    let to = head;
    while (found.length < POST_LIMIT && to >= floor) {
      const start = to - floor + 1n > SCAN_CHUNK ? to - SCAN_CHUNK + 1n : floor;
      const chunk = await client.getLogs({
        address: indexOracle,
        event: indexPosted,
        strict: true,
        fromBlock: start,
        toBlock: to,
      });
      for (let i = chunk.length - 1; i >= 0 && found.length < POST_LIMIT; i--) {
        const log = chunk[i];
        if (!log) continue;
        const model = modelById.get(log.args.market);
        if (!model) continue;
        const key = log.blockNumber.toString();
        if (!stamps.has(key)) {
          try {
            const block = await client.getBlock({ blockNumber: log.blockNumber });
            stamps.set(key, new Date(Number(block.timestamp) * 1000).toISOString());
          } catch {
            stamps.set(key, null);
          }
        }
        found.push({
          model,
          priceMicroPerMtok: log.args.priceMicroPerMTok.toString(),
          hcsSeqFrom: log.args.hcsSeqFrom.toString(),
          hcsSeqTo: log.args.hcsSeqTo.toString(),
          txHash: log.transactionHash,
          blockNumber: key,
          loggedAt: stamps.get(key) ?? null,
        });
      }
      if (start === floor) break;
      to = start - 1n;
    }
    rows = found;
  } catch (error) {
    rows = { error: `the Galileo RPC did not answer: ${error instanceof Error ? error.message : "unknown error"}` };
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-[#1E1E1E]">[ index posts ]</p>
        <a href={chainscan} target="_blank" rel="noreferrer" className="text-[13px] text-[#1743FF] hover:underline">
          source: chainscan ↗
        </a>
      </div>
      {Array.isArray(rows) ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-[13px] [&_td]:pr-4 [&_th]:pr-4">
            <thead>
              <tr className="text-[#757575]">
                <th scope="col" className="pb-2 font-normal">UTC</th>
                <th scope="col" className="pb-2 font-normal">model</th>
                <th scope="col" className="pb-2 font-normal">price</th>
                <th scope="col" className="pb-2 font-normal">seq</th>
                <th scope="col" className="pb-2 font-normal">tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.txHash} className="border-t border-[#D9D9D9]">
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">
                    {row.loggedAt ? row.loggedAt.slice(11, 16) : `block ${row.blockNumber}`}
                  </td>
                  <td className="py-2.5 text-[#1E1E1E]">{row.model}</td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">
                    {formatUsd(BigInt(row.priceMicroPerMtok))}
                  </td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">
                    {row.hcsSeqFrom === "0" && row.hcsSeqTo === "0" ? "—" : `${row.hcsSeqFrom}→${row.hcsSeqTo}`}
                  </td>
                  <td className="py-2.5">
                    <a
                      href={`${chainscan}/tx/${row.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#1743FF] hover:underline"
                    >
                      {row.txHash.slice(0, 10)}… ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-[#757575]">waiting for the first index post</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[14px] text-[#757575]">{rows.error}</p>
      )}
    </div>
  );
}

function LedgerFallback({ label }: { label: string }) {
  return (
    <div>
      <p className="text-[13px] text-[#1E1E1E]">[ {label} ]</p>
      <p className="mt-3 py-6 text-center text-[14px] text-[#757575]">loading the ledger…</p>
    </div>
  );
}

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ model?: string }> }) {
  const { model } = await searchParams;
  const picked = MARKETS.find((id) => id === model) ?? DEMO_MODEL;
  const config = receiptsConfig();
  const latest = await marketIndexes();
  const configured = Number(process.env.INDEX_WINDOW_MIN ?? 60);
  const windowMin = Number.isInteger(configured) && configured > 0 ? configured : 60;
  return (
    <>
      <Receipts initialModel={picked} config={config} latest={latest} markets={[...MARKETS]} windowMin={windowMin} />
      <div className="mt-8 grid grid-cols-1 gap-8 border-t border-[#CECECE] pt-5 lg:grid-cols-2">
        <Suspense fallback={<LedgerFallback label="top-ups" />}>
          <TopupsLedger hashscan={config.ok ? `https://hashscan.io/${config.network}` : null} />
        </Suspense>
        <Suspense fallback={<LedgerFallback label="index posts" />}>
          <PostsLedger />
        </Suspense>
      </div>
      <p className="mt-8 border-t border-[#CECECE] pt-5 text-[13px] leading-[18px] text-[#757575]">
        Rollups and the recompute read the public Hedera mirror in your browser; the reference price and the
        on-chain index come from our API and the chain.
      </p>
    </>
  );
}
