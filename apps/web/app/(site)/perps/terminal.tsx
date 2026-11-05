"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseError, type Hash } from "viem";
import { useConnection, useSwitchChain, useWalletClient } from "wagmi";
import { mockUsdcAbi } from "../../../lib/abi";
import { addresses, galileo, publicClient } from "../../../lib/chain";
import { MARKETS, liquidationPrice, modify, notional, openMargin, readMarket, readPosition } from "../../../lib/perp";
import { formatMicroPerMtok, formatMtok, formatUsd, parseMtok } from "../../../lib/price";
import type { Book, ModelRow } from "../../../lib/types";
import { FillsChart, fillsToPoints, type ScaleMode } from "../trade/chart";

const POLL_MS = 15_000;
const MAX_LEVERAGE = 5n;
const STALE_S = 600n;
const FAUCET_USDC = 100_000_000n;

type Market = Awaited<ReturnType<typeof readMarket>>;
type Held = Awaited<ReturnType<typeof readPosition>> & { model: string; price: bigint };

function signedUsd(value: bigint): string {
  return `${value < 0n ? "−" : ""}${formatUsd(value < 0n ? -value : value)}`;
}

const WINDOWS = [
  { id: "1h", label: "1h", ms: 3_600_000 },
  { id: "6h", label: "6h", ms: 6 * 3_600_000 },
  { id: "24h", label: "24h", ms: 86_400_000 },
  { id: "all", label: "All", ms: null },
] as const;
type WindowId = (typeof WINDOWS)[number]["id"];

const PRESETS = [
  { label: "1", value: "1" },
  { label: "10", value: "10" },
  { label: "100", value: "100" },
  { label: "1K", value: "1000" },
];

const FUNDING_FORMULAS = [
  {
    name: "funding rate / s",
    body: "clamp( fundingK · (longOI − shortOI) / max(longOI + shortOI, 1e6), ±fundingK )",
  },
  {
    name: "accrual",
    body: "cumFunding += rate · (now − lastAccrual) · price, on every modify / liquidate",
  },
  {
    name: "funding owed",
    body: "size · (cumFunding − entryCumFunding) / 1e18 · 1e6, positive means the trader pays",
  },
  {
    name: "liquidation",
    body: "equity · 10,000 < notional · 500 → liquidatable; MM_BPS 500",
  },
];

const PARAMS = "MAX_LEVERAGE 5 · MM_BPS 500 · FEE_BPS 10 · LIQ_BPS 50 · fundingK 0.1%/hour at full skew · stale 600 s";

const MUTED = "text-[#757575]";

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const BOOK_TABS = ["Order Book", "Trades"] as const;
const STRIP_TABS = ["Positions", "Fills", "Funding History"] as const;

export function Perps({ initialModel }: { initialModel: string }) {
  const router = useRouter();
  const [model, setModel] = useState(initialModel);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [bookFailed, setBookFailed] = useState<"unknown" | "down" | null>(null);
  const [chartTab, setChartTab] = useState<"Chart" | "Funding">("Chart");
  const [windowId, setWindowId] = useState<WindowId>("all");
  const [scale, setScale] = useState<ScaleMode>("linear");
  const [bookTab, setBookTab] = useState<(typeof BOOK_TABS)[number]>("Order Book");
  const [stripTab, setStripTab] = useState<(typeof STRIP_TABS)[number]>("Positions");
  const [side, setSide] = useState<"long" | "short">("long");
  const [size, setSize] = useState("10");
  const { ready, authenticated, login } = usePrivy();
  const { address, chainId } = useConnection();
  const { data: wallet } = useWalletClient();
  const { mutateAsync: switchChain } = useSwitchChain();
  const [market, setMarket] = useState<Market | null>(null);
  const [held, setHeld] = useState<Held[]>([]);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [gas, setGas] = useState<bigint | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [clock, setClock] = useState<string | null>(null);
  const picker = useRef<HTMLDetailsElement | null>(null);
  const nowRef = useRef(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(clockFormat.format(new Date()));
      nowRef.current = Date.now();
    }, 1000);
    setClock(clockFormat.format(new Date()));
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/models")
      .then((res) => (res.ok ? (res.json() as Promise<{ data: ModelRow[] }>) : null))
      .then((body) => {
        if (alive && body) setModels(body.data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const refreshBook = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/v1/book?model=${encodeURIComponent(model)}`, {
        cache: "no-store",
        signal: signal ?? null,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setBook((await res.json()) as Book);
      setBookFailed(null);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setBookFailed(error instanceof Error && error.message === "404" ? "unknown" : "down");
    }
  }, [model]);

  useEffect(() => {
    const controller = new AbortController();
    setBook(null);
    void refreshBook(controller.signal);
    const id = window.setInterval(() => void refreshBook(controller.signal), POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [refreshBook]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await readMarket(model);
        if (alive) setMarket(next);
        if (!address) return;
        const client = publicClient();
        const [positions, balance, native] = await Promise.all([
          Promise.all(MARKETS.map(async (id) => ({ model: id, price: (await readMarket(id)).price, ...(await readPosition(id, address)) }))),
          client.readContract({ address: addresses().mockUsdc, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] }),
          client.getBalance({ address }),
        ]);
        if (!alive) return;
        setHeld(positions.filter((row) => row.size !== 0n));
        setUsdc(balance);
        setGas(native);
      } catch {
        if (alive) setNotice("the Galileo RPC did not answer; retrying");
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [model, address, version]);

  const send = async (run: () => Promise<Hash>) => {
    setPending(true);
    setNotice(null);
    try {
      if (chainId !== galileo.id) await switchChain({ chainId: galileo.id });
      const hash = await run();
      const receipt = await publicClient().waitForTransactionReceipt({ hash });
      setNotice(`${receipt.status === "success" ? "confirmed" : "reverted"} ${hash.slice(0, 10)}…`);
      setVersion((value) => value + 1);
    } catch (cause) {
      setNotice(cause instanceof BaseError ? cause.shortMessage : cause instanceof Error ? cause.message : "the transaction failed");
    } finally {
      setPending(false);
    }
  };

  const selected = models.find((row) => row.id === model);
  const asks = book?.asks ?? [];
  const wanted = parseMtok(size);
  const depth = asks.reduce((total, ask) => total + BigInt(ask.tokens_left), 0n);

  const ladderRows = useMemo(() => {
    let acc = 0n;
    const rows = asks.map((ask) => {
      acc += BigInt(ask.tokens_left);
      return { ask, total: acc };
    });
    rows.reverse();
    return rows;
  }, [asks]);

  const points = useMemo(
    () =>
      fillsToPoints(
        book?.fills ?? [],
        WINDOWS.find((w) => w.id === windowId)?.ms ?? null,
        nowRef.current,
      ),
    [book, windowId],
  );
  const points24 = useMemo(
    () => fillsToPoints(book?.fills ?? [], 86_400_000, nowRef.current),
    [book],
  );

  const bestAsk = asks[0] ? BigInt(asks[0].price_micro_per_mtok) : null;
  const lastFill = book?.fills.at(-1);
  const lastPrice = lastFill ? BigInt(lastFill.price_micro_per_mtok) : null;
  const first24 = points24[0]?.value ?? null;
  const last24 = points24.at(-1)?.value ?? null;
  const delta = last24 !== null && first24 !== null ? (last24 - first24) / first24 : null;
  const volume24 = points24.reduce((total, point) => total + point.volume, 0);
  const index = market && market.updatedAt > 0n ? market.price : null;
  const stale =
    !market || market.updatedAt === 0n || BigInt(Math.floor(nowRef.current / 1000)) - market.updatedAt > STALE_S;
  const mark = index ?? lastPrice ?? bestAsk;
  const orderValue = wanted > 0n && mark !== null ? notional(wanted, mark) : 0n;
  const margin = wanted > 0n && mark !== null ? openMargin(wanted, mark, MAX_LEVERAGE) : 0n;
  const current = held.find((row) => row.model === model) ?? null;
  const equityTotal = held.reduce((sum, row) => sum + row.equity, 0n);
  const pnlTotal = held.reduce((sum, row) => sum + (row.size * (row.price - row.entryPrice)) / 1_000_000n, 0n);
  const liqPreview =
    wanted > 0n && mark !== null
      ? liquidationPrice({
          size: (side === "long" ? 1n : -1n) * wanted,
          margin,
          entryPrice: mark,
          fundingOwed: 0n,
        })
      : 0n;
  const usableDepth = depth > 0n ? depth : 1n;
  const sliderPct = wanted >= usableDepth ? 100 : Number((wanted * 100n) / usableDepth);
  const first = points[0]?.value ?? null;
  const last = points.at(-1)?.value ?? null;
  const high = points.length > 0 ? Math.max(...points.map((point) => point.value)) : null;
  const low = points.length > 0 ? Math.min(...points.map((point) => point.value)) : null;

  const pick = (id: string) => {
    setModel(id);
    if (picker.current) picker.current.open = false;
    router.replace(`/perps?model=${encodeURIComponent(id)}`, { scroll: false });
  };

  const stats: Stat[] = [
    { label: "mark", value: mark !== null ? formatMicroPerMtok(mark) : "—" },
    { label: "index", value: index !== null ? formatMicroPerMtok(index) : "—" },
    { label: "best ask", value: bestAsk !== null ? formatMicroPerMtok(bestAsk) : "—" },
    {
      label: "change, 24h",
      value: delta !== null ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)}%` : "—",
      tone: delta === null ? undefined : delta >= 0 ? "up" : "down",
    },
    { label: "volume, 24h", value: volume24 > 0 ? `${volume24.toFixed(2)} MTok` : "—" },
    { label: "open interest", value: market ? `${formatMtok(market.longOi)} / ${formatMtok(market.shortOi)} MTok` : "—" },
    { label: "funding / hour", value: market ? `${(Number(market.fundingRatePerHour) / 1e16).toFixed(4)}%` : "—" },
  ];

  return (
    <section>
      <h1 className="font-serif text-[50px] leading-[1.05] text-[#1E1E1E]">
        Pressure what <span className="text-[#A3A3A3]">expires</span>
      </h1>
      <p className="mt-4 max-w-[425px] text-[14px] leading-[18px] text-black">
        Long the compute you will need, or short the credits you will not. Positions settle against
        the house vault at five times, funded off the same venue fills the spot book prints.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <details ref={picker} className="relative">
          <summary className="flex cursor-pointer list-none items-baseline gap-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[15px] font-semibold text-[#1E1E1E]">{model} / USDC</span>
              <span className={`block text-[11px] ${MUTED}`}>
                perp · index · {selected?.verifiability ? "TEE · " : ""}
                {selected ? `${selected.rails.length} rail${selected.rails.length === 1 ? "" : "s"}` : "loading"}
              </span>
            </span>
            <span className="border border-[#CECECE] bg-white px-1.5 py-0.5 text-[11px] tabular-nums text-[#1743FF]">
              {MAX_LEVERAGE.toString()}x
            </span>
            <span aria-hidden className="text-[#757575]">⌄</span>
          </summary>
          <ul className="absolute left-0 top-full z-20 mt-1 max-h-80 w-72 overflow-auto border border-[#CECECE] bg-white py-1">
            {models.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => pick(row.id)}
                  className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-[14px] hover:bg-[#F5F5F5] ${
                    row.id === model ? "text-[#1E1E1E]" : "text-[#757575]"
                  }`}
                >
                  <span>{row.id}</span>
                  <span className="tabular-nums text-[13px] text-[#757575]">
                    {row.best_ask_micro_per_mtok ? `ask ${formatMicroPerMtok(BigInt(row.best_ask_micro_per_mtok))}` : "no asks"}
                  </span>
                </button>
              </li>
            ))}
            {models.length === 0 ? (
              <li className="px-3 py-2 text-[13px] text-[#757575]">loading models…</li>
            ) : null}
          </ul>
        </details>

        <div className="flex items-center gap-5 text-[14px]">
          {address ? (
            <span className="tabular-nums text-[#1E1E1E]">
              {address.slice(0, 6)}…{address.slice(-4)} ·{" "}
              <span className="font-semibold">{usdc !== null ? formatUsd(usdc) : "—"}</span> USDC
            </span>
          ) : (
            <button type="button" disabled={!ready} onClick={() => login()} className="text-[#1743FF] hover:underline">
              connect a wallet
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 border-t border-[#CECECE] pt-5">
        <p className="text-[13px] text-[#1E1E1E]">[ live perp book ]</p>
        <dl className="mt-3 flex flex-wrap gap-x-[26px] gap-y-3">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className={`text-[13px] ${MUTED}`}>{stat.label}</dt>
              <dd
                className={`text-[13px] tabular-nums ${
                  stat.tone === "up" ? "text-[#2EBD85]" : stat.tone === "down" ? "text-[#F6465D]" : "text-[#1E1E1E]"
                }`}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        {bookFailed ? (
          <p className="mt-2 text-[13px] text-[#F6465D]">
            {bookFailed === "unknown"
              ? `the venue does not know ${model} — pick another model above`
              : "the book feed is unreachable; retrying every 15 seconds"}
          </p>
        ) : null}
      </div>

      <div className="mt-5 grid gap-[17px] lg:grid-cols-[1fr_300px]">
        <div className="border border-[#CECECE] bg-[#EBEBEB] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-5">
              {(["Chart", "Funding"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setChartTab(item)}
                  aria-pressed={chartTab === item}
                  className={`text-[14px] ${
                    chartTab === item
                      ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                      : "text-[#757575] hover:text-[#1E1E1E]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            {chartTab === "Chart" ? (
              <div className="flex gap-5">
                {WINDOWS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setWindowId(item.id)}
                    aria-pressed={windowId === item.id}
                    className={`text-[14px] ${
                      windowId === item.id
                        ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                        : "text-[#757575] hover:text-[#1E1E1E]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {chartTab === "Chart" ? (
            <>
              <div className={`flex flex-wrap gap-x-4 gap-y-0.5 pt-3 text-[13px] ${MUTED}`}>
                <span className="text-[#1E1E1E]">
                  {model} · spot fills
                  <span
                    aria-hidden
                    className={`ml-2 inline-block h-[7px] w-[7px] rounded-full ${bookFailed === null ? "bg-[#2EBD85]" : "bg-[#C9C9C9]"}`}
                  />
                </span>
                {points.length > 0 ? (
                  <>
                    <span>
                      first <span className="tabular-nums text-[#1E1E1E]">{first?.toFixed(4)}</span>
                    </span>
                    <span>
                      high <span className="tabular-nums text-[#1E1E1E]">{high?.toFixed(4)}</span>
                    </span>
                    <span>
                      low <span className="tabular-nums text-[#1E1E1E]">{low?.toFixed(4)}</span>
                    </span>
                    <span>
                      last <span className="tabular-nums text-[#1E1E1E]">{last?.toFixed(4)}</span>
                    </span>
                  </>
                ) : null}
              </div>

              <FillsChart
                points={points}
                scale={scale}
                emptyNote="waiting for the first index post — the venue's fills seed the curve"
              />

              <div className="flex flex-wrap items-center gap-5 pt-1">
                {(["percent", "log"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setScale(scale === mode ? "linear" : mode)}
                    aria-pressed={scale === mode}
                    className={`text-[14px] ${
                      scale === mode
                        ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                        : "text-[#757575] hover:text-[#1E1E1E]"
                    }`}
                  >
                    {mode === "percent" ? "%" : "log"}
                  </button>
                ))}
                <span className={`ml-auto text-[13px] tabular-nums ${MUTED}`}>{clock ?? "--:--:--"} UTC</span>
              </div>
            </>
          ) : (
            <div className="pt-4">
              <p className="text-[13px] text-[#1E1E1E]">[ funding on skew ]</p>
              <p className="mt-3 max-w-xl text-[14px] leading-5 text-[#1E1E1E]">
                Longs pay shorts when the book leans long, the other way when it leans short. The
                accrual lands on every modify and every liquidation, off the keeper&apos;s index — the
                same TWAP of venue fills you can recompute on /receipts.
              </p>
              <dl className="mt-5 border border-[#CECECE] bg-white px-4 py-3">
                {FUNDING_FORMULAS.map((row) => (
                  <div key={row.name} className="border-b border-[#D9D9D9] py-2 last:border-0">
                    <dt className={`text-[13px] ${MUTED}`}>{row.name}</dt>
                    <dd className="mt-0.5 text-[13px] leading-5 tabular-nums text-[#1E1E1E]">{row.body}</dd>
                  </div>
                ))}
              </dl>
              <p className={`mt-4 text-[13px] leading-5 ${MUTED}`}>{PARAMS}</p>
            </div>
          )}

          <div className="mt-5 border-t border-[#D9D9D9] pt-4">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-[22px] leading-tight text-[#1E1E1E]">
                {bookTab === "Order Book" ? "Ask book" : "Fill tape"}
              </h2>
              <div className="flex gap-4">
                {BOOK_TABS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setBookTab(item)}
                    aria-pressed={bookTab === item}
                    className={`text-[14px] ${
                      bookTab === item
                        ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                        : "text-[#757575] hover:text-[#1E1E1E]"
                    }`}
                  >
                    {item === "Order Book" ? "Order book" : "Trades"}
                  </button>
                ))}
              </div>
            </div>

            {bookTab === "Order Book" ? (
              <>
                <div className="mt-3">
                  {asks.length === 0 ? (
                    <p className="border-t border-[#D9D9D9] py-6 text-center text-[14px] text-[#757575]">
                      no asks yet for {model}
                    </p>
                  ) : (
                    <>
                      <div className={`grid grid-cols-[1.1fr_1fr_1fr_2.5rem] border-t border-[#D9D9D9] py-2 text-[12px] ${MUTED}`}>
                        <span>Price</span>
                        <span className="text-right">Size</span>
                        <span className="text-right">Total</span>
                        <span className="text-right">Rail</span>
                      </div>
                      {ladderRows.map(({ ask, total }) => (
                        <div
                          key={ask.listing_id}
                          className="relative grid grid-cols-[1.1fr_1fr_1fr_2.5rem] border-t border-[#D9D9D9] py-3 text-[13px]"
                          style={{
                            background: `linear-gradient(90deg, rgba(23, 67, 255, ${(Number(total) / Number(depth === 0n ? 1n : depth)) * 0.08}), rgba(23, 67, 255, 0) 100%)`,
                          }}
                        >
                          <span className="tabular-nums text-[#1E1E1E]">
                            {formatMicroPerMtok(BigInt(ask.price_micro_per_mtok))}
                            <span className={`ml-1.5 text-[12px] ${MUTED}`}>USD / MTok</span>
                          </span>
                          <span className="text-right tabular-nums text-[#757575]">{formatMtok(BigInt(ask.tokens_left))}</span>
                          <span className="text-right tabular-nums text-[#757575]">{formatMtok(total)}</span>
                          <span className={`truncate text-right text-[13px] ${ask.verifiable ? "text-[#1743FF]" : MUTED}`}>
                            {ask.rail}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <p className={`border-t border-[#D9D9D9] pt-3 text-[13px] ${MUTED}`}>
                  asks only — buy side clears the ladder. best ask {bestAsk !== null ? formatMicroPerMtok(bestAsk) : "—"} ·
                  depth {formatMtok(depth)} MTok
                </p>
              </>
            ) : (
              <div className="mt-3">
                {(book?.fills.length ?? 0) === 0 ? (
                  <p className="border-t border-[#D9D9D9] py-6 text-center text-[14px] text-[#757575]">
                    the venue has not printed a fill for {model} yet
                  </p>
                ) : (
                  book?.fills.map((fill) => (
                    <div
                      key={`${fill.listing_id}-${fill.created_at}`}
                      className="flex items-baseline justify-between gap-4 border-t border-[#D9D9D9] py-3"
                    >
                      <span className={`text-[13px] tabular-nums ${MUTED}`}>{clockFormat.format(new Date(fill.created_at))}</span>
                      <span className="text-[14px] tabular-nums text-[#1E1E1E]">
                        {formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}
                        <span className={`ml-1.5 text-[12px] ${MUTED}`}>USD / MTok</span>
                      </span>
                      <span className={`text-[13px] tabular-nums ${MUTED}`}>{formatMtok(BigInt(fill.tokens))} MTok</span>
                    </div>
                  ))
                )}
              </div>
            )}

            <p className={`mt-3 border-t border-[#D9D9D9] pt-3 text-[13px] ${MUTED}`}>
              spot book · seeds the index the perp clears against
            </p>
          </div>
        </div>

        <div className="border border-[#CECECE] bg-[#EBEBEB] p-4">
          <div className="flex border border-[#CECECE] bg-white">
            <button
              type="button"
              onClick={() => setSide("long")}
              aria-pressed={side === "long"}
              className={`w-1/2 py-2 text-[14px] font-semibold ${
                side === "long" ? "bg-black text-white" : "text-[#757575] hover:text-[#1E1E1E]"
              }`}
            >
              Long
            </button>
            <button
              type="button"
              onClick={() => setSide("short")}
              aria-pressed={side === "short"}
              className={`w-1/2 border-l border-[#CECECE] py-2 text-[14px] font-semibold ${
                side === "short" ? "bg-black text-white" : "text-[#757575] hover:text-[#1E1E1E]"
              }`}
            >
              Short
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <div className="flex justify-between text-[14px]">
              <span className={MUTED}>Available to trade</span>
              <span className="tabular-nums text-[#1E1E1E]">{usdc !== null ? formatUsd(usdc) : "—"}</span>
            </div>
            <div className="flex justify-between text-[14px]">
              <span className={MUTED}>Current position</span>
              <span className="tabular-nums text-[#1E1E1E]">
                {current
                  ? `${current.size > 0n ? "long" : "short"} ${formatMtok(current.size < 0n ? -current.size : current.size)} MTok`
                  : "none"}
              </span>
            </div>

            <label className="block">
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Size, in MTokens</span>
              <span className="flex items-center gap-2 border border-[#CECECE] bg-white px-2.5 focus-within:border-[#1743FF]">
                <input
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                  inputMode="numeric"
                  placeholder="10"
                  className="h-[34px] w-full bg-transparent text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9]"
                />
                <span className={`text-[12px] ${MUTED}`}>MTok</span>
              </span>
            </label>

            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sliderPct}
                onChange={(event) => setSize(formatMtok((BigInt(event.target.value) * usableDepth) / 100n))}
                aria-label="size as a percent of displayed depth"
                className="h-1 w-full accent-[#1743FF]"
              />
              <span className={`w-14 text-right text-[12px] leading-4 tabular-nums ${MUTED}`}>
                {sliderPct}% of depth
              </span>
            </div>

            <div className="flex gap-5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSize(preset.value)}
                  className={`text-[14px] ${
                    size === preset.value
                      ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                      : "text-[#757575] hover:text-[#1E1E1E]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <dl className="border-t border-[#D9D9D9]">
              <div className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                <dt className={MUTED}>Liquidation price, est</dt>
                <dd className="tabular-nums text-[#1E1E1E]">{liqPreview > 0n ? formatMicroPerMtok(liqPreview) : "—"}</dd>
              </div>
              <div className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                <dt className={MUTED}>Order value</dt>
                <dd className="tabular-nums text-[#1E1E1E]">{orderValue > 0n ? formatUsd(orderValue) : "—"}</dd>
              </div>
              <div className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                <dt className={MUTED}>Margin required · {MAX_LEVERAGE.toString()}x</dt>
                <dd className="tabular-nums text-[#1E1E1E]">{margin > 0n ? formatUsd(margin) : "—"}</dd>
              </div>
              <div className="flex justify-between py-3">
                <dt className="text-[15px] font-semibold text-[#1E1E1E]">Venue fee</dt>
                <dd className="text-[15px] font-semibold tabular-nums text-[#1E1E1E]">10 bps of notional</dd>
              </div>
            </dl>

            {!authenticated || !address ? (
              <button
                type="button"
                disabled={!ready}
                onClick={() => login()}
                className="h-[34px] w-full bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4]"
              >
                Connect wallet
              </button>
            ) : chainId !== galileo.id ? (
              <button
                type="button"
                onClick={() => void switchChain({ chainId: galileo.id })}
                className="h-[34px] w-full bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E]"
              >
                Switch to 0G Galileo
              </button>
            ) : (
              <button
                type="button"
                disabled={!wallet || pending || stale || orderValue === 0n || (usdc ?? 0n) < margin || gas === 0n}
                onClick={() => {
                  if (wallet) void send(() => modify(wallet, model, side === "long" ? wanted : -wanted, margin));
                }}
                className="h-[34px] w-full bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
              >
                {pending ? "Confirming…" : `${side === "long" ? "Long" : "Short"} ${wanted > 0n ? `${formatMtok(wanted)} MTok` : ""}`}
              </button>
            )}
            <p className={`text-center text-[13px] ${MUTED}`}>
              {notice ??
                (!address
                  ? "trades sign with your own wallet on 0G Galileo"
                  : stale
                    ? "the index is stale; trading reopens after the keeper's next post"
                    : gas === 0n
                      ? "this wallet needs 0G gas: faucet.0g.ai"
                      : (usdc ?? 0n) < margin
                        ? "not enough test USDC; mint some below"
                        : "margin and fee settle in MockUSDC")}
            </p>
            {address ? (
              <button
                type="button"
                disabled={!wallet || pending}
                onClick={() => {
                  if (wallet) {
                    void send(() =>
                      wallet.writeContract({
                        chain: galileo,
                        address: addresses().mockUsdc,
                        abi: mockUsdcAbi,
                        functionName: "mint",
                        args: [wallet.account.address, FAUCET_USDC],
                      }),
                    );
                  }
                }}
                className="flex h-[34px] w-full items-center justify-center border border-[#CECECE] bg-white text-[13px] text-[#1E1E1E] hover:border-[#1743FF] disabled:text-[#C9C9C9]"
              >
                Get 100 test USDC
              </button>
            ) : null}

            <div className="border-t border-[#D9D9D9] pt-4">
              <p className="text-[13px] text-[#1E1E1E]">[ account summary ]</p>
              <dl className="mt-2">
                {[
                  ["Portfolio value", usdc !== null ? formatUsd(usdc + equityTotal) : "$0.00"],
                  ["Unrealized PNL", held.length > 0 ? signedUsd(pnlTotal) : "—"],
                  ["Account ratio", "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between py-1 text-[13px]">
                    <dt className={MUTED}>{label}</dt>
                    <dd className="tabular-nums text-[#1E1E1E]">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className={`mt-2 text-[13px] leading-5 ${MUTED}`}>
                longs cap tomorrow&apos;s compute cost · shorts lock revenue on expiring credits — settled
                against the house vault at {MAX_LEVERAGE.toString()}x
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 border-t border-[#CECECE] pt-8">
        <p className="text-[13px] text-[#1E1E1E]">[ positions ]</p>
        <h2 className="mt-3 font-serif text-[32px] leading-[1.1] text-[#1E1E1E]">
          Positions, fills, funding.
        </h2>

        <div className="mt-4 flex items-center gap-5">
          {STRIP_TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStripTab(item)}
              aria-pressed={stripTab === item}
              className={`text-[14px] ${
                stripTab === item
                  ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                  : "text-[#757575] hover:text-[#1E1E1E]"
              }`}
            >
              {item}
            </button>
          ))}
          <span className={`text-[13px] ${MUTED}`}>
            {stripTab === "Positions"
              ? `${held.length} open`
              : stripTab === "Fills"
                ? `${book?.fills.length ?? 0} on ${model}`
                : "nothing accrued"}
          </span>
        </div>

        <div className="mt-4">
          {stripTab === "Positions" ? (
            <>
              <div className={`hidden border-y border-[#CECECE] py-2 text-[12px] md:grid md:grid-cols-9 ${MUTED}`}>
                {["Market", "Size", "Position value", "Entry price", "Mark price", "PNL / ROE %", "Liq. price", "Margin", "Funding"].map(
                  (head, i) => (
                    <span key={head} className={i === 0 ? "pr-2" : "text-right"}>
                      {head}
                    </span>
                  ),
                )}
              </div>
              {held.length === 0 ? (
                <p className="border-t border-[#CECECE] py-5 text-[14px] text-[#757575] md:border-t-0">
                  No open positions yet.
                </p>
              ) : (
                held.map((row) => {
                  const size = row.size < 0n ? -row.size : row.size;
                  const pnl = (row.size * (row.price - row.entryPrice)) / 1_000_000n;
                  const funding = row.margin + pnl - row.equity;
                  return (
                    <div
                      key={row.model}
                      className="grid grid-cols-3 gap-y-1 border-t border-[#CECECE] py-3 text-[13px] tabular-nums text-[#1E1E1E] md:grid-cols-9"
                    >
                      <span className="pr-2">{row.model}</span>
                      <span className={`text-right ${row.size > 0n ? "text-[#2EBD85]" : "text-[#F6465D]"}`}>
                        {row.size > 0n ? "+" : "−"}
                        {formatMtok(size)}
                      </span>
                      <span className="text-right">{formatUsd(notional(row.size, row.price))}</span>
                      <span className="text-right">{formatMicroPerMtok(row.entryPrice)}</span>
                      <span className="text-right">{formatMicroPerMtok(row.price)}</span>
                      <span className="text-right">
                        {signedUsd(pnl)} /{" "}
                        {row.margin > 0n ? `${(Number((pnl * 10_000n) / row.margin) / 100).toFixed(2)}%` : "—"}
                      </span>
                      <span className="text-right">
                        {row.liquidationPrice > 0n ? formatMicroPerMtok(row.liquidationPrice) : "—"}
                      </span>
                      <span className="text-right">{formatUsd(row.margin)}</span>
                      <span className="text-right">
                        {signedUsd(-funding)}
                        <button
                          type="button"
                          disabled={!wallet || pending}
                          onClick={() => {
                            if (wallet) void send(() => modify(wallet, row.model, -row.size, 0n));
                          }}
                          className="ml-2 underline disabled:text-[#C9C9C9]"
                        >
                          close
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </>
          ) : null}

          {stripTab === "Fills" ? (
            (book?.fills.length ?? 0) === 0 ? (
              <p className="border-t border-[#CECECE] py-5 text-[14px] text-[#757575]">
                The venue has not printed a fill for {model} yet.
              </p>
            ) : (
              book?.fills.map((fill) => (
                <div
                  key={`${fill.listing_id}-${fill.created_at}`}
                  className="flex flex-wrap items-baseline justify-between gap-4 border-t border-[#CECECE] py-4"
                >
                  <span className={`text-[13px] tabular-nums ${MUTED}`}>{clockFormat.format(new Date(fill.created_at))} UTC</span>
                  <span className="text-[14px] tabular-nums text-[#1E1E1E]">
                    {formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}
                    <span className={`ml-1.5 text-[12px] ${MUTED}`}>USD / MTok</span>
                  </span>
                  <span className={`text-[13px] tabular-nums ${MUTED}`}>{formatMtok(BigInt(fill.tokens))} MTok</span>
                </div>
              ))
            )
          ) : null}

          {stripTab === "Funding History" ? (
            <p className="border-t border-[#CECECE] py-5 text-[14px] text-[#757575]">
              No funding payments yet — accrual starts with the first PerpMarket modify.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type Stat = { label: string; value: string; tone?: "up" | "down" | undefined };
