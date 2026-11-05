"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liquidationPrice } from "../../lib/perp";
import { formatMicroPerMtok } from "../../lib/price";
import type { Book, ModelRow } from "../../lib/types";
import { FillsChart, fillsToPoints, type ScaleMode } from "../(site)/trade/chart";

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

const timeFormat = new Intl.DateTimeFormat("en-GB", {
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
    fetch("/api/v1/balance", { headers: { authorization: `Bearer ${token}` } })
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

  const pointsAll = useMemo(
    () => fillsToPoints(book?.fills ?? [], null, nowRef.current),
    [book],
  );
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

  const pick = (id: string) => {
    setModel(id);
    if (picker.current) picker.current.open = false;
    router.replace(`/perps?model=${encodeURIComponent(id)}`, { scroll: false });
  };

  return (
    <main className="flex min-h-screen flex-col bg-[#0A0D10] font-sans text-[#E7EAEE]">
      <header className="sticky top-0 z-30 border-b border-[#1B222B] bg-[#0A0D10]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <Link href="/" className="font-serif text-[18px] whitespace-nowrap text-[#E7EAEE]">
            LLM Token Exchange
          </Link>

          <span className="hidden h-8 w-px bg-[#1B222B] md:block" />

          <details ref={picker} className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-[14px] font-semibold uppercase tracking-wide text-[#E7EAEE]">
                  {model}-USDC
                </span>
                <span className="block text-[11px] text-[#5C6675]">
                  perp · $/MTok index · {selected?.verifiability ? "TEE · " : ""}
                  {selected ? `${selected.rails.length} rail${selected.rails.length === 1 ? "" : "s"}` : "loading"}
                </span>
              </span>
              <span
                aria-hidden
                className="rounded-sm border border-[#1743FF]/40 bg-[#1743FF]/10 px-1.5 py-0.5 text-[11px] text-[#8FA5FF]"
              >
                {MAX_LEVERAGE.toString()}x
              </span>
              <span aria-hidden className="text-[#5C6675]">⌄</span>
            </summary>
            <ul className="absolute left-0 top-full z-20 mt-2 max-h-80 w-80 overflow-auto rounded-md border border-[#1B222B] bg-[#0E1217] py-1 shadow-lg shadow-black/40">
              {models.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => pick(row.id)}
                    className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-[12px] hover:bg-[#141A21] ${
                      row.id === model ? "text-[#E7EAEE]" : "text-[#9AA6B5]"
                    }`}
                  >
                    <span>{row.id}</span>
                    <span className="font-mono text-[11px] text-[#5C6675]">
                      {row.best_ask_micro_per_mtok
                        ? `ask ${formatMicroPerMtok(BigInt(row.best_ask_micro_per_mtok))}`
                        : "no asks"}
                    </span>
                  </button>
                </li>
              ))}
              {models.length === 0 ? (
                <li className="px-3 py-2 text-[12px] text-[#5C6675]">loading models…</li>
              ) : null}
            </ul>
          </details>

          <div className="hidden gap-x-6 xl:flex">
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">Mark · last fill</p>
              <p className="font-mono text-[14px] text-[#E7EAEE]">
                {lastPrice !== null ? formatMicroPerMtok(lastPrice) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">Best ask</p>
              <p className="font-mono text-[14px] text-[#E7EAEE]">
                {bestAsk !== null ? formatMicroPerMtok(bestAsk) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">24h Change</p>
              {delta !== null ? (
                <p className={`font-mono text-[14px] ${delta >= 0 ? "text-[#2EBD85]" : "text-[#F6465D]"}`}>
                  {delta >= 0 ? "+" : ""}
                  {(delta * 100).toFixed(2)}%
                </p>
              ) : (
                <p className="font-mono text-[14px] text-[#E7EAEE]">—</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">24h Volume</p>
              <p className="font-mono text-[14px] text-[#E7EAEE]">{volume24 > 0 ? `${volume24.toFixed(2)}M MTok` : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">Index</p>
              <p className="font-mono text-[14px] text-[#E7EAEE]" title="IndexOracle.latest — posted by the keeper">
                {index !== null ? formatMicroPerMtok(index) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">Open Interest</p>
              <p className="font-mono text-[14px] text-[#E7EAEE]" title="PerpMarket OI — live with the keeper">
                —
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">Funding / Countdown</p>
              <p className="font-mono text-[14px] text-[#E7EAEE]" title="fundingRate — live with the keeper">—</p>
            </div>
          </div>

          {key ? (
            <span className="ml-auto hidden rounded-sm border border-[#1B222B] px-2 py-1 text-[11px] text-[#9AA6B5] md:block">
              balance <span className="font-mono text-[#E7EAEE]">{balance !== null ? usd(balance) : "…"}</span>
            </span>
          ) : null}
          <nav className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#9AA6B5] ${key ? "" : "ml-auto"}`}>
            {(
              [
                ["/", "Home"],
                ["/trade", "Trade"],
                ["/sell", "Sell"],
                ["/keys", "Keys"],
                ["/receipts", "Receipts"],
              ] as const
            ).map(([href, label]) => (
              <Link key={href} href={href} className="hover:text-[#E7EAEE]">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="min-w-0 flex-1 lg:border-r lg:border-[#1B222B]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#1B222B] px-4">
            <div className="flex items-center gap-1">
              {(["Chart", "Funding"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setChartTab(item)}
                  aria-pressed={chartTab === item}
                  className={`-mb-px border-b-2 px-3 py-2.5 text-[12px] ${
                    chartTab === item
                      ? "border-[#1743FF] text-[#E7EAEE]"
                      : "border-transparent text-[#9AA6B5] hover:text-[#E7EAEE]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            {chartTab === "Chart" ? (
              <>
                <span className="hidden h-4 w-px bg-[#1B222B] md:block" />
                <div className="flex items-center gap-1">
                  {WINDOWS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setWindowId(item.id)}
                      aria-pressed={windowId === item.id}
                      className={`rounded-sm px-2 py-1 text-[11px] ${
                        windowId === item.id ? "bg-[#1A2029] text-[#E7EAEE]" : "text-[#5C6675] hover:text-[#9AA6B5]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                  {(["percent", "log"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setScale(scale === mode ? "linear" : mode)}
                      aria-pressed={scale === mode}
                      className={`rounded-sm px-2 py-1 text-[11px] ${
                        scale === mode ? "bg-[#1A2029] text-[#E7EAEE]" : "text-[#5C6675] hover:text-[#9AA6B5]"
                      }`}
                    >
                      {mode === "percent" ? "%" : "log"}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-[#5C6675]">
              {points.length > 0 ? (
                <>
                  <span>
                    hi <span className="text-[#E7EAEE]">{Math.max(...points.map((p) => p.value)).toFixed(4)}</span>
                  </span>
                  <span>
                    lo <span className="text-[#E7EAEE]">{Math.min(...points.map((p) => p.value)).toFixed(4)}</span>
                  </span>
                </>
              ) : null}
              <span>{clock ?? "--:--:--"} UTC</span>
            </span>
          </div>

          {chartTab === "Chart" ? (
            <div>
              <FillsChart
                points={points}
                scale={scale}
                emptyNote="waiting for the first index post — the venue's fills seed the curve"
              />
            </div>
          ) : (
            <div className="px-4 py-5">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[#5C6675]">[ funding on skew ]</p>
              <p className="mt-3 max-w-xl text-[13px] leading-5 text-[#9AA6B5]">
                Longs pay shorts when the book leans long, the other way when it leans short. The
                accrual lands on every modify and every liquidation, off the keeper&apos;s index — the
                same TWAP of venue fills you can recompute on /receipts.
              </p>
              <dl className="mt-5 space-y-3 border border-[#1B222B] bg-[#0E1217] px-4 py-4">
                {FUNDING_FORMULAS.map((row) => (
                  <div key={row.name}>
                    <dt className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">{row.name}</dt>
                    <dd className="mt-1 font-mono text-[12px] leading-5 text-[#E7EAEE]">{row.body}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 font-mono text-[11px] leading-5 text-[#5C6675]">{PARAMS}</p>
            </div>
          )}

          <div className="border-t border-[#1B222B]">
            <div className="flex items-center gap-1 border-b border-[#1B222B] px-2">
              {STRIP_TABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStripTab(item)}
                  aria-pressed={stripTab === item}
                  className={`-mb-px border-b-2 px-3 py-2 text-[12px] ${
                    stripTab === item
                      ? "border-[#1743FF] text-[#E7EAEE]"
                      : "border-transparent text-[#9AA6B5] hover:text-[#E7EAEE]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>

            {stripTab === "Positions" ? (
              <div className="px-4 py-3">
                <div className="hidden overflow-hidden text-left text-[10px] uppercase tracking-[0.08em] text-[#5C6675] md:grid md:grid-cols-9">
                  {["Market", "Size", "Position Value", "Entry Price", "Mark Price", "PNL / ROE %", "Liq. Price", "Margin", "Funding"].map(
                    (head, i) => (
                      <span key={head} className={i === 0 ? "pr-2" : "text-right"}>
                        {head}
                      </span>
                    ),
                  )}
                </div>
                <p className="py-8 text-[13px] text-[#9AA6B5]">No open positions yet</p>
              </div>
            ) : null}

            {stripTab === "Fills" ? (
              <div className="px-4 py-3">
                <p className="mb-2 text-[11px] text-[#5C6675]">
                  last {book?.fills.length ?? 0} fills on {model} — the log the index TWAP reads
                </p>
                {(book?.fills.length ?? 0) === 0 ? (
                  <p className="py-6 text-center text-[13px] text-[#5C6675]">the venue has not printed a fill yet</p>
                ) : (
                  <ul className="max-h-[190px] overflow-auto">
                    {book?.fills.map((fill) => (
                      <li
                        key={`${fill.listing_id}-${fill.created_at}`}
                        className="flex items-center justify-between gap-4 border-b border-[#141A21] py-1.5 font-mono text-[12px]"
                      >
                        <span className="text-[#9AA6B5]">{timeFormat.format(new Date(fill.created_at))}</span>
                        <span className="text-[#E7EAEE]">{formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}</span>
                        <span className="text-[#9AA6B5]">{tokensText(BigInt(fill.tokens))} MTok</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {stripTab === "Funding History" ? (
              <div className="px-4 py-3">
                <p className="py-8 text-[13px] text-[#9AA6B5]">
                  No funding payments yet — accrual starts with the first PerpMarket modify.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="w-full shrink-0 lg:w-[360px]">
          <div className="flex items-center justify-between border-b border-[#1B222B] px-4">
            <div className="flex items-center gap-1">
              {BOOK_TABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setBookTab(item)}
                  aria-pressed={bookTab === item}
                  className={`-mb-px border-b-2 px-2 py-2.5 text-[12px] ${
                    bookTab === item
                      ? "border-[#1743FF] text-[#E7EAEE]"
                      : "border-transparent text-[#9AA6B5] hover:text-[#E7EAEE]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <span className="text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">
              {bookFailed ? (bookFailed === "unknown" ? "unknown model" : "feed retrying") : `${tokensText(depth)} MTok`}
            </span>
          </div>

          {bookTab === "Order Book" ? (
            <div>
              {asks.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13px] text-[#5C6675]">
                  no asks yet for {model} — the book is empty
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-[1.1fr_1fr_1fr_2.5rem] px-4 py-1.5 text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">
                    <span>Price</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Total</span>
                    <span className="text-right">Rail</span>
                  </div>
                  <ul className="max-h-[260px] overflow-auto">
                    {ladderRows.map(({ ask, total }) => (
                      <li
                        key={ask.listing_id}
                        className="relative grid grid-cols-[1.1fr_1fr_1fr_2.5rem] px-4 py-[3px] font-mono text-[12px]"
                      >
                        <span
                          aria-hidden
                          className="absolute inset-y-0.5 right-0 rounded-sm bg-[#F6465D]/10"
                          style={{
                            width: `${Math.max(2, Math.min(100, Number((total * 100n) / (depth === 0n ? 1n : depth))))}%`,
                          }}
                        />
                        <span className="relative text-[#F6465D]">{formatMicroPerMtok(BigInt(ask.price_micro_per_mtok))}</span>
                        <span className="relative text-right text-[#9AA6B5]">{tokensText(BigInt(ask.tokens_left))}</span>
                        <span className="relative text-right text-[#9AA6B5]">{tokensText(total)}</span>
                        <span className="relative truncate text-right text-[10px] uppercase text-[#5C6675]">{ask.rail}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-y border-[#1B222B] bg-[#0E1217] px-4 py-1.5 text-[11px] text-[#5C6675]">
                    <span>asks only — buy side clears the ladder</span>
                    <span className="font-mono">{bestAsk !== null ? formatMicroPerMtok(bestAsk) : "—"}</span>
                  </div>
                </>
              )}
              <p className="px-4 pb-3 pt-2 text-[11px] leading-4 text-[#3A424D]">
                spot book · seeds the index the perp clears against
              </p>
            </div>
          ) : (
            <ul className="max-h-[300px] min-h-[120px] overflow-auto px-4 py-2">
              {(book?.fills.length ?? 0) === 0 ? (
                <li className="py-6 text-center text-[13px] text-[#5C6675]">no fills yet</li>
              ) : (
                book?.fills.map((fill) => (
                  <li key={`${fill.listing_id}-${fill.created_at}`} className="flex justify-between gap-3 py-1 font-mono text-[12px]">
                    <span className="text-[#F6465D]">{formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}</span>
                    <span className="text-[#9AA6B5]">{tokensText(BigInt(fill.tokens))}</span>
                    <span className="text-[#5C6675]">{timeFormat.format(new Date(fill.created_at))}</span>
                  </li>
                ))
              )}
            </ul>
          )}

          <div className="border-t border-[#1B222B] px-4 pb-4 pt-3">
            <div className="flex gap-1">
              {["market", "limit"].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setOrderType(item as "market" | "limit")}
                  aria-pressed={orderType === item}
                  className={`flex-1 rounded-sm py-1 text-[12px] ${
                    orderType === item ? "bg-[#1A2029] text-[#E7EAEE]" : "text-[#5C6675] hover:text-[#9AA6B5]"
                  }`}
                >
                  {item === "market" ? "Market" : "Limit"}
                </button>
              ))}
              <span className="ml-3 rounded-sm px-2 py-1 text-[12px] text-[#3A424D]">Pro</span>
            </div>

            <div className="mt-1.5 flex gap-3">
              <button
                type="button"
                onClick={() => setSide("long")}
                aria-pressed={side === "long"}
                className={`flex-1 rounded-sm py-1.5 text-[12px] ${
                  side === "long" ? "bg-[#2EBD85] font-medium text-[#04140D]" : "border border-[#1B222B] text-[#5C6675] hover:text-[#E7EAEE]"
                }`}
              >
                Buy / Long
              </button>
              <button
                type="button"
                onClick={() => setSide("short")}
                aria-pressed={side === "short"}
                className={`flex-1 rounded-sm py-1.5 text-[12px] ${
                  side === "short" ? "bg-[#F6465D] font-medium text-white" : "border border-[#1B222B] text-[#5C6675] hover:text-[#E7EAEE]"
                }`}
              >
                Sell / Short
              </button>
            </div>

            <div className="mt-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <span className="text-[#5C6675]">Available to Trade</span>
                <span className="font-mono text-[#E7EAEE]">{balance !== null ? `${usd(balance)} USDC` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5C6675]">Current Position</span>
                <span className="font-mono text-[#E7EAEE]">0.00 MTok</span>
              </div>
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-[10px] uppercase tracking-[0.08em] text-[#5C6675]">Size · MTokens</span>
              <span className="flex items-center gap-2 rounded-sm border border-[#1B222B] bg-[#0A0D10] px-2 focus-within:border-[#1743FF]">
                <input
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                  inputMode="numeric"
                  placeholder="1000000"
                  className="h-9 w-full bg-transparent font-mono text-[13px] text-[#E7EAEE] outline-none placeholder:text-[#3A424D]"
                />
                <span className="text-[11px] text-[#5C6675]">MTok</span>
              </span>
            </label>

            <div className="mt-2 flex gap-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSize(preset.value)}
                  className={`flex-1 rounded-sm border px-1 py-1 text-[11px] ${
                    size === preset.value
                      ? "border-[#1743FF] text-[#E7EAEE]"
                      : "border-[#1B222B] text-[#5C6675] hover:text-[#9AA6B5]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <label className="mt-2.5 block">
              <span className="sr-only">size as a percent of displayed depth</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sliderPct}
                onChange={(event) => setSize(((BigInt(event.target.value) * usableDepth) / 100n).toString())}
                aria-label="size as a percent of displayed depth"
                className="w-full accent-[#1743FF]"
              />
              <span className="flex justify-between font-mono text-[10px] text-[#5C6675]">
                <span>0%</span>
                <span>{sliderPct}% of depth</span>
                <span>100%</span>
              </span>
            </label>

            <div className="mt-2.5 flex items-center gap-5 text-[12px] text-[#3A424D]" title="live with PerpMarket">
              <span>☐ Reduce Only</span>
              <span>☐ Take Profit / Stop Loss</span>
            </div>

            <dl className="mt-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <dt className="text-[#5C6675]">Liquidation Price (est)</dt>
                <dd className="font-mono text-[#E7EAEE]">{liqPreview > 0n ? formatMicroPerMtok(liqPreview) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#5C6675]">Order Value</dt>
                <dd className="font-mono text-[#E7EAEE]">{notional > 0n ? usd(notional) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#5C6675]">Margin Required · {MAX_LEVERAGE.toString()}x</dt>
                <dd className="font-mono text-[#E7EAEE]">{margin > 0n ? usd(margin) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#5C6675]">Venue Fee</dt>
                <dd className="font-mono text-[#E7EAEE]">10 bps of notional</dd>
              </div>
            </dl>

            {key ? (
              <>
                <button
                  type="button"
                  disabled
                  title="PerpMarket modify lands with the keeper — until then buy at the ask on /trade"
                  className="mt-3 w-full cursor-not-allowed rounded-sm bg-[#1743FF] py-2 text-[13px] font-medium text-white opacity-60"
                >
                  {side === "long" ? "Long" : "Short"} {wanted > 0n ? tokensText(wanted) : ""} MTok
                </button>
                <p className="mt-1.5 text-center text-[11px] text-[#5C6675]">
                  orders settle after the keeper posts the index
                </p>
              </>
            ) : (
              <Link
                href="/keys"
                className="mt-3 flex w-full items-center justify-center rounded-sm bg-[#1743FF] py-2 text-[13px] font-medium text-white hover:bg-[#1743FF]/90"
              >
                Connect
              </Link>
            )}

            <div className="mt-2.5 flex gap-2">
              <Link
                href="/keys"
                className="flex-1 rounded-sm border border-[#1B222B] py-1.5 text-center text-[12px] text-[#9AA6B5] hover:border-[#1743FF] hover:text-[#E7EAEE]"
              >
                Deposit
              </Link>
              <span className="flex-1 cursor-not-allowed rounded-sm border border-[#1B222B] py-1.5 text-center text-[12px] text-[#3A424D]">
                Withdraw
              </span>
            </div>

            <div className="mt-3 border-t border-[#1B222B] pt-2.5">
              <p className="text-[11px] text-[#5C6675]">Key account summary</p>
              <dl className="mt-1.5 space-y-1 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-[#5C6675]">Portfolio value</dt>
                  <dd className="font-mono text-[#E7EAEE]">{balance !== null ? usd(balance) : "$0.00"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5C6675]">Unrealized PNL</dt>
                  <dd className="font-mono text-[#E7EAEE]" title="positions read from PerpMarket">—</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5C6675]">Account ratio</dt>
                  <dd className="font-mono text-[#E7EAEE]">—</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] leading-4 text-[#3A424D]">
                longs cap tomorrow&apos;s compute cost · shorts lock revenue on expiring credits — settled
                against the house vault at {MAX_LEVERAGE.toString()}x
              </p>
            </div>
          </div>
        </aside>
      </div>

      <footer className="flex items-center justify-between border-t border-[#1B222B] px-4 py-2 text-[11px] text-[#5C6675]">
        <span className="font-mono">{clock ?? "--:--:--"} (UTC)</span>
        <nav className="flex items-center gap-4">
          <a href="https://github.com/0xsoydev/celestial-trade/blob/develop/docs/plan.md">Plan</a>
          <a href="https://github.com/0xsoydev/celestial-trade">README</a>
          <Link href="/receipts" className="hover:text-[#E7EAEE]">
            Receipts
          </Link>
        </nav>
      </footer>
    </main>
  );
}
