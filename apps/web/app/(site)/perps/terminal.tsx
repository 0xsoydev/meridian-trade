"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liquidationPrice } from "../../../lib/perp";
import { formatMicroPerMtok } from "../../../lib/price";
import type { Book, ModelRow } from "../../../lib/types";
import { FillsChart, fillsToPoints, type ScaleMode } from "../trade/chart";

const KEY_STORAGE = "router_key";
const POLL_MS = 15_000;
const MAX_LEVERAGE = 5n;

const WINDOWS = [
  { id: "1h", label: "1h", ms: 3_600_000 },
  { id: "6h", label: "6h", ms: 6 * 3_600_000 },
  { id: "24h", label: "24h", ms: 86_400_000 },
  { id: "all", label: "All", ms: null },
] as const;
type WindowId = (typeof WINDOWS)[number]["id"];

const PRESETS = [
  { label: "100K", value: "100000" },
  { label: "1M", value: "1000000" },
  { label: "10M", value: "10000000" },
  { label: "100M", value: "100000000" },
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

const usd = (micro: bigint) => `$${formatMicroPerMtok(micro)}`;

function tokensText(value: bigint): string {
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function parseTokens(input: string): bigint {
  const digits = input.trim().replace(/[,_\s]/g, "");
  if (!/^\d{1,13}$/.test(digits)) return 0n;
  return BigInt(digits);
}

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
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [size, setSize] = useState("1000000");
  const [key, setKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
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

  useEffect(() => {
    setKey(window.localStorage.getItem(KEY_STORAGE));
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
      setBookFailed(error instanceof Error && error.message === "404" ? "unknown" : "down");
    }
  }, [model]);

  useEffect(() => {
    const controller = new AbortController();
    setBook(null);
    void refreshBook(controller.signal);
    const id = window.setInterval(() => void refreshBook(), POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [refreshBook]);

  useEffect(() => {
    const token = window.localStorage.getItem(KEY_STORAGE);
    if (!token) {
      setBalance(null);
      return;
    }
    fetch("/api/v1/balance", {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ balance_usd_micro: string }>) : null))
      .then((body) => setBalance(body ? BigInt(body.balance_usd_micro) : null))
      .catch(() => setBalance(null));
  }, []);

  const selected = models.find((row) => row.id === model);
  const asks = book?.asks ?? [];
  const wanted = parseTokens(size);
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
  const index = selected?.index_micro_per_mtok ? BigInt(selected.index_micro_per_mtok) : null;
  const mark = index ?? lastPrice ?? bestAsk;
  const notional = wanted > 0n && mark !== null ? wanted * mark : 0n;
  const margin = notional / MAX_LEVERAGE;
  const liqPreview =
    wanted > 0n && mark !== null
      ? liquidationPrice({
          size: (side === "long" ? 1n : -1n) * wanted * 1_000_000n,
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
    { label: "volume, 24h", value: volume24 > 0 ? `${volume24.toFixed(2)}M MTok` : "—" },
    { label: "open interest", value: "—" },
    { label: "funding / countdown", value: "—" },
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
          {key && balance !== null ? (
            <span className="tabular-nums text-[#1E1E1E]">
              balance <span className="font-semibold">{usd(balance)}</span>
            </span>
          ) : null}
          <Link href="/keys" className="text-[#1743FF] hover:underline">
            {key ? "manage keys" : "connect your agent"}
          </Link>
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
                  {model} · perp fills
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
                          <span className="text-right tabular-nums text-[#757575]">{tokensText(BigInt(ask.tokens_left))}</span>
                          <span className="text-right tabular-nums text-[#757575]">{tokensText(total)}</span>
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
                  depth {tokensText(depth)} MTok
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
                      <span className={`text-[13px] tabular-nums ${MUTED}`}>{tokensText(BigInt(fill.tokens))} MTok</span>
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
