"use client";

import { KeyRound, ReceiptText, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { charge, formatMicroPerMtok, formatMtok, formatUsd, parseMtok, previewFill } from "../../../lib/price.ts";
import type {
  Balance,
  Book,
  ModelRow,
  RouterError,
  Trade,
  TradeResult,
} from "../../../lib/types";
import ProfileDropdown from "../../../components/kokonutui/profile-dropdown";
import { FillsChart, fillsToPoints, type ScaleMode } from "./chart";

const KEY_STORAGE = "router_key";
const TAKE_BPS = 1000n;
const MAX_TOKENS = 1_000_000_000n;
const POLL_MS = 15_000;

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

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const MUTED = "text-[#757575]";

type SessionFill = Trade & { at: string };

export function Trade({ initialModel }: { initialModel: string }) {
  const router = useRouter();
  const [model, setModel] = useState(initialModel);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [bookFailed, setBookFailed] = useState<"unknown" | "down" | null>(null);
  const [pane, setPane] = useState<"book" | "tape">("book");
  const [dock, setDock] = useState<"mine" | "venue">("venue");
  const [windowId, setWindowId] = useState<WindowId>("all");
  const [scale, setScale] = useState<ScaleMode>("linear");
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState("10");
  const [key, setKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [account, setAccount] = useState<Balance | null>(null);
  const [pending, setPending] = useState(false);
  const [fills, setFills] = useState<SessionFill[]>([]);
  const [problem, setProblem] = useState<{ message: string; shortfall: bigint | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [clock, setClock] = useState<string | null>(null);
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

  const refreshBook = useCallback(
    async (signal?: AbortSignal) => {
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
    },
    [model],
  );

  const refreshBalance = useCallback(async () => {
    const token = window.localStorage.getItem(KEY_STORAGE);
    if (!token) {
      setBalance(null);
      setAccount(null);
      return;
    }
    try {
      const res = await fetch("/api/v1/balance", {
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setBalance(null);
        setAccount(null);
        return;
      }
      const body = (await res.json()) as Balance;
      setBalance(BigInt(body.balance_usd_micro));
      setAccount(body);
    } catch {
      setBalance(null);
      setAccount(null);
    }
  }, []);

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
    setFills([]);
    setProblem(null);
    void refreshBalance();
  }, [model, refreshBalance]);

  const selected = models.find((row) => row.id === model);
  const asks = book?.asks ?? [];
  const venueFills = book?.fills ?? [];
  const wanted = parseMtok(size);
  const preview = useMemo(() => previewFill(asks, wanted, TAKE_BPS), [asks, wanted]);
  const points = useMemo(
    () => fillsToPoints(venueFills, WINDOWS.find((w) => w.id === windowId)?.ms ?? null, nowRef.current),
    [venueFills, windowId],
  );

  const bestAsk = asks[0] ? BigInt(asks[0].price_micro_per_mtok) : null;
  const listPrice = selected ? BigInt(selected.reference_blended_micro_per_mtok) : null;
  const last = points.at(-1)?.value ?? null;
  const first = points[0]?.value ?? null;
  const delta = last !== null && first !== null ? (last - first) / first : null;
  const depth = asks.reduce((total, ask) => total + BigInt(ask.tokens_left), 0n);
  const widest = asks.reduce((max, ask) => (BigInt(ask.tokens_left) > max ? BigInt(ask.tokens_left) : max), 0n);

  const day = useMemo(() => {
    const cutoff = nowRef.current - 86_400_000;
    let first: { at: number; price: bigint } | null = null;
    let final: { at: number; price: bigint } | null = null;
    let usd = 0n;
    for (const fill of venueFills) {
      const at = Date.parse(fill.created_at);
      if (!Number.isFinite(at) || at < cutoff) continue;
      const price = BigInt(fill.price_micro_per_mtok);
      if (!first || at < first.at) first = { at, price };
      if (!final || at > final.at) final = { at, price };
      usd += charge(BigInt(fill.tokens), price);
    }
    return { first: first?.price ?? null, last: final?.price ?? null, usd };
  }, [venueFills]);
  const dayDelta =
    day.first !== null && day.last !== null && day.first > 0n
      ? Number(day.last - day.first) / Number(day.first)
      : null;
  const mark = day.last ?? bestAsk;

  const modelAccounts = models.map((row) => ({
    id: row.id,
    name: row.id,
    email: row.best_ask_micro_per_mtok
      ? `${formatMicroPerMtok(BigInt(row.best_ask_micro_per_mtok))} USD / MTok`
      : "no asks yet",
    plan: "Spot",
  }));
  const menuItems = [
    {
      label: key ? "Manage agent" : "Connect your agent",
      icon: <KeyRound className="h-4 w-4" />,
      href: "/keys",
    },
    { label: "Sell tokens", icon: <Tag className="h-4 w-4" />, href: "/sell" },
    { label: "Receipts", icon: <ReceiptText className="h-4 w-4" />, href: "/receipts" },
  ];

  const affordable =
    balance !== null && bestAsk !== null && balance > 0n ? (balance * 1_000_000n) / bestAsk : 0n;
  const affordPct =
    affordable > 0n
      ? Math.max(0, Math.min(100, Math.round((Number(wanted) / Number(affordable)) * 100)))
      : 0;
  const overCap = wanted > MAX_TOKENS;

  const pick = (id: string) => {
    setModel(id);
    setFills([]);
    router.replace(`/trade?model=${encodeURIComponent(id)}`, { scroll: false });
  };

  const buy = async () => {
    if (!key || wanted === 0n || pending) return;
    setPending(true);
    setProblem(null);
    setFills([]);
    try {
      const res = await fetch("/api/v1/trades", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, tokens: wanted.toString() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as RouterError | null;
        const code = body?.error?.code;
        const shortfall = balance !== null && preview.cost > balance ? preview.cost - balance : null;
        setProblem({
          message:
            code === "invalid_api_key"
              ? "router key rejected — paste it again on Keys"
              : code === "no_liquidity"
                ? "the asks moved before the fill; retry"
                : body?.error?.message ?? `request failed (${res.status})`,
          shortfall,
        });
        return;
      }
      const result = (await res.json()) as TradeResult;
      const at = new Date().toISOString();
      setFills(result.fills.map((fill) => ({ ...fill, at })));
      setDock("mine");
      void refreshBook();
      void refreshBalance();
    } catch {
      setProblem({ message: "network error — retry", shortfall: null });
    } finally {
      setPending(false);
    }
  };

  const topupCommand = () => {
    const cents = ((preview.cost - (balance ?? 0n) + 9_999n) / 10_000n) * 10_000n;
    return `POST ${window.location.origin}/api/v1/topup?usd=${formatMicroPerMtok(cents)}`;
  };

  const copyTopup = async () => {
    try {
      await navigator.clipboard.writeText(topupCommand());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const signOut = () => {
    window.localStorage.removeItem(KEY_STORAGE);
    setKey(null);
    setBalance(null);
    setAccount(null);
  };

  return (
    <section>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border border-[#CECECE] bg-white px-4 py-3">
        <ProfileDropdown
          accounts={modelAccounts}
          defaultAccountId={model}
          onAccountChange={(entry) => pick(entry.id)}
          info={{ label: "Available to trade", value: balance !== null ? formatUsd(balance) : "—" }}
          items={menuItems}
          signedIn={key !== null}
          onSignOut={signOut}
        />

        <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
          <Stat label="Mark" value={mark !== null ? formatMicroPerMtok(mark) : "—"} />
          <Stat
            label="24h change"
            value={dayDelta !== null ? `${dayDelta >= 0 ? "+" : ""}${(dayDelta * 100).toFixed(2)}%` : "—"}
            tone={dayDelta === null ? undefined : dayDelta >= 0 ? "up" : "down"}
          />
          <Stat label="24h volume" value={day.usd > 0n ? formatUsd(day.usd) : "—"} />
          <Stat label="Ask depth" value={`${formatMtok(depth)} MTok`} />
          <Stat label="Oracle" value="—" />
          <Stat label="Open interest" value="—" />
          <Stat label="Funding / countdown" value="—" />
        </div>

        <div className="ml-auto flex items-center gap-5 text-[14px]">
          {key && balance !== null ? (
            <span className="tabular-nums text-[#1E1E1E]">
              balance <span className="font-semibold">{formatUsd(balance)}</span>
            </span>
          ) : null}
          <Link href="/keys" className="text-[#1743FF] hover:underline">
            {key ? "manage keys" : "connect your agent"}
          </Link>
        </div>
      </div>

      {bookFailed ? (
        <p className="mt-2 text-[13px] text-[#F6465D]">
          {bookFailed === "unknown"
            ? `the venue does not know ${model} — pick another model above`
            : "the book feed is unreachable; retrying every 15 seconds"}
        </p>
      ) : null}

      <div className={`mt-5 grid gap-[17px] ${expanded ? "" : "lg:grid-cols-[minmax(0,1fr)_250px_290px]"}`}>
        <div className="flex flex-col border border-[#CECECE] bg-white">
          <div className="flex items-center gap-5 border-b border-[#D9D9D9] px-4 py-2.5 text-[14px]">
            <span className="font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4">
              Chart
            </span>
            <span className={MUTED}>Funding</span>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-pressed={expanded}
              className="ml-auto text-[13px] text-[#1743FF] hover:underline"
              aria-label={expanded ? "show the buy ticket" : "expand the chart"}
            >
              {expanded ? "show the ticket" : "expand"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-5 px-4 py-2 text-[14px]">
            {WINDOWS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setWindowId(item.id)}
                aria-pressed={windowId === item.id}
                className={`${
                  windowId === item.id
                    ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                    : "text-[#757575] hover:text-[#1E1E1E]"
                }`}
              >
                {item.label}
              </button>
            ))}
            <span aria-hidden className="h-4 w-px bg-[#D9D9D9]" />
            {(["percent", "log"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setScale(scale === mode ? "linear" : mode)}
                aria-pressed={scale === mode}
                className={`${
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

          <div className={`flex flex-wrap gap-x-4 gap-y-0.5 px-4 pb-1 text-[13px] ${MUTED}`}>
            <span className="text-[#1E1E1E]">
              {model} · fills
              <span
                aria-hidden
                className={`ml-2 inline-block h-[7px] w-[7px] rounded-full ${bookFailed === null ? "bg-[#2EBD85]" : "bg-[#C9C9C9]"}`}
              />
            </span>
            {points.length > 0 ? (
              <>
                <span>
                  O <span className="tabular-nums text-[#1E1E1E]">{first?.toFixed(4)}</span>
                </span>
                <span>
                  H <span className="tabular-nums text-[#1E1E1E]">{Math.max(...points.map((p) => p.value)).toFixed(4)}</span>
                </span>
                <span>
                  L <span className="tabular-nums text-[#1E1E1E]">{Math.min(...points.map((p) => p.value)).toFixed(4)}</span>
                </span>
                <span>
                  C <span className="tabular-nums text-[#1E1E1E]">{last?.toFixed(4)}</span>
                </span>
                {delta !== null ? (
                  <span className={`tabular-nums ${delta >= 0 ? "text-[#2EBD85]" : "text-[#F6465D]"}`}>
                    ({delta >= 0 ? "+" : ""}
                    {(delta * 100).toFixed(2)}%)
                  </span>
                ) : null}
              </>
            ) : null}
          </div>

          <FillsChart points={points} scale={scale} className="min-h-[420px] flex-1" />

        </div>

        {!expanded && (
          <>
            <div className="flex flex-col border border-[#CECECE] bg-white">
              <div className="flex items-center gap-5 border-b border-[#D9D9D9] px-4 py-2.5 text-[14px]">
                {(["book", "tape"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPane(item)}
                    aria-pressed={pane === item}
                    className={`${
                      pane === item
                        ? "font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                        : "text-[#757575] hover:text-[#1E1E1E]"
                    }`}
                  >
                    {item === "book" ? "Order book" : "Trades"}
                  </button>
                ))}
                <span className={`ml-auto text-[12px] ${MUTED}`}>
                  {pane === "book" ? `${asks.length} asks` : `${venueFills.length} prints`}
                </span>
              </div>

              {pane === "book" ? (
                <>
                  <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-[#757575]">
                    <span>Price</span>
                    <span>Size (MTok)</span>
                    <span>Total</span>
                  </div>
                  <div className="max-h-[420px] min-h-0 flex-1 overflow-auto">
                    {[...asks].reverse().map((ask) => (
                      <div
                        key={ask.listing_id}
                        className="flex items-center justify-between gap-3 px-4 py-[5px] text-[13px] tabular-nums"
                        style={{
                          background: `linear-gradient(90deg, rgba(246, 70, 93, ${widest === 0n ? 0 : (Number(BigInt(ask.tokens_left)) / Number(widest)) * 0.12}), rgba(246, 70, 93, 0) 100%)`,
                        }}
                      >
                        <span className="text-[#F6465D]">{formatMicroPerMtok(BigInt(ask.price_micro_per_mtok))}</span>
                        <span className="text-[#1E1E1E]">{formatMtok(BigInt(ask.tokens_left))}</span>
                        <span className={MUTED}>
                          {formatUsd(charge(BigInt(ask.tokens_left), BigInt(ask.price_micro_per_mtok)))}
                        </span>
                      </div>
                    ))}
                    {asks.length === 0 ? (
                      <p className="px-4 py-6 text-center text-[13px] text-[#757575]">no asks yet for {model}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between border-y border-[#D9D9D9] px-4 py-2 text-[13px]">
                    <span className={MUTED}>Best ask</span>
                    <span className="tabular-nums text-[#1E1E1E]">
                      {bestAsk !== null ? formatMicroPerMtok(bestAsk) : "—"}
                    </span>
                    <span className="tabular-nums text-[#F6465D]">
                      {bestAsk !== null && listPrice !== null && listPrice > 0n
                        ? `${formatMicroPerMtok(((listPrice - bestAsk) * 100_000_000n) / listPrice)}% under list`
                        : ""}
                    </span>
                  </div>

                  <p className="px-4 py-2 text-[12px] text-[#757575]">
                    no bids — asks supply this venue. depth: {formatMtok(depth)} MTok
                  </p>
                </>
              ) : (
                <div className="max-h-[420px] min-h-0 flex-1 overflow-auto">
                  {venueFills.slice(0, 40).map((fill, index) => {
                    const next = venueFills[index + 1];
                    const up = next === undefined || BigInt(fill.price_micro_per_mtok) >= BigInt(next.price_micro_per_mtok);
                    return (
                      <div key={`${fill.listing_id}-${fill.created_at}`} className="flex items-center justify-between gap-3 border-t border-[#D9D9D9] px-4 py-[5px] text-[13px] tabular-nums">
                        <span className={MUTED}>{timeShort(fill.created_at)}</span>
                        <span className={up ? "text-[#2EBD85]" : "text-[#F6465D]"}>
                          {formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}
                        </span>
                        <span className={MUTED}>{formatMtok(BigInt(fill.tokens))} MTok</span>
                      </div>
                    );
                  })}
                  {venueFills.length === 0 ? (
                    <p className="px-4 py-6 text-center text-[13px] text-[#757575]">
                      the venue has not printed a fill for {model} yet
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-[17px]">
              <div className="border border-[#CECECE] bg-white">
                <div className="flex border-b border-[#D9D9D9]">
                  <button
                    type="button"
                    onClick={() => setPane("book")}
                    className="w-1/2 bg-black py-2 text-[14px] font-semibold text-white"
                  >
                    Buy
                  </button>
                  <Link
                    href="/sell"
                    className="flex w-1/2 items-center justify-center border-l border-[#CECECE] py-2 text-[14px] font-semibold text-[#757575] hover:text-[#1E1E1E]"
                  >
                    Sell →
                  </Link>
                </div>

                <div className="space-y-4 p-4">
                  <div className="flex justify-between text-[14px]">
                    <span className={MUTED}>Available to trade</span>
                    <span className="tabular-nums text-[#1E1E1E]">{balance !== null ? formatUsd(balance) : "—"}</span>
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
                      value={affordPct}
                      disabled={affordable === 0n}
                      onChange={(event) => setSize(formatMtok((affordable * BigInt(event.target.value)) / 100n))}
                      aria-label="share of what the balance affords"
                      className="h-1 w-full accent-[#1743FF] disabled:opacity-40"
                    />
                    <span className={`w-12 text-right text-[12px] leading-4 tabular-nums ${MUTED}`}>
                      {affordPct}% of balance
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
                      <dt className={MUTED}>Average ask</dt>
                      <dd className="tabular-nums text-[#1E1E1E]">{preview.fillable > 0n ? formatMicroPerMtok(preview.avg) : "—"}</dd>
                    </div>
                    <div className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                      <dt className={MUTED}>Venue fee, 10 percent</dt>
                      <dd className="tabular-nums text-[#1E1E1E]">{preview.fee > 0n ? formatUsd(preview.fee) : "—"}</dd>
                    </div>
                    <div className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                      <dt className={MUTED}>Seller receives</dt>
                      <dd className="tabular-nums text-[#1E1E1E]">{preview.net > 0n ? formatUsd(preview.net) : "—"}</dd>
                    </div>
                    <div className="flex justify-between py-3">
                      <dt className="text-[15px] font-semibold text-[#1E1E1E]">You pay</dt>
                      <dd className="text-[16px] font-semibold tabular-nums text-[#1E1E1E]">
                        {preview.cost > 0n ? formatUsd(preview.cost) : "—"}
                      </dd>
                    </div>
                  </dl>

                  {preview.partial && wanted > 0n && !overCap ? (
                    <p className="text-[13px] leading-5 text-[#F6465D]">
                      The book covers {formatMtok(preview.fillable)} of {formatMtok(wanted)} MTok. The rest stays unfilled.
                    </p>
                  ) : null}

                  {overCap ? (
                    <p className="text-[13px] leading-5 text-[#F6465D]">
                      One trade caps at {formatMtok(MAX_TOKENS)} MTok.
                    </p>
                  ) : null}

                  {key === null ? (
                    <div className="border border-[#CECECE] bg-white px-3 py-3">
                      <p className="text-[14px] text-[#1E1E1E]">Buying needs a router key.</p>
                      <p className="mt-1 text-[13px] leading-5 text-[#757575]">
                        Paste your agent&apos;s key once. It stays in this browser, never in a URL.
                      </p>
                    </div>
                  ) : null}

                  {key === null ? (
                    <Link
                      href="/keys"
                      className="flex h-[34px] items-center justify-center rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E]"
                    >
                      Connect your agent
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void buy()}
                      disabled={pending || wanted === 0n || preview.cost === 0n || overCap}
                      className="h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
                    >
                      {pending ? "Buying…" : wanted > 0n ? `Buy ${formatMtok(wanted)} MTok` : "Enter a size"}
                    </button>
                  )}

                  {balance !== null && balance < preview.cost ? (
                    <p className="text-center text-[13px] text-[#F6465D]">
                      Short by {formatUsd(preview.cost - balance)} — top up the agent.
                    </p>
                  ) : null}

                  {problem ? (
                    <div className="border border-[#F6465D]/40 bg-white px-3 py-2">
                      <p className="text-[13px] leading-5 text-[#F6465D]">{problem.message}</p>
                      {problem.shortfall !== null ? (
                        <button
                          type="button"
                          onClick={() => void copyTopup()}
                          className="mt-2 w-full border border-[#CECECE] bg-white px-2 py-1.5 text-left text-[13px] tabular-nums text-[#1E1E1E] hover:border-[#1743FF]"
                        >
                          {copied ? "Copied — run it from your agent. " : "Copy top-up, "}
                          {`POST /api/v1/topup?usd=${formatMicroPerMtok(problem.shortfall)}`}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {account ? (
                    <div className="border-t border-[#D9D9D9] pt-4">
                      <p className="text-[13px] text-[#1E1E1E]">[ account summary ]</p>
                      <dl className="mt-2">
                        {[
                          ["Balance", formatUsd(BigInt(account.balance_usd_micro))],
                          ["Reserved", formatUsd(BigInt(account.reserved_usd_micro))],
                          ["Topped up today", formatUsd(BigInt(account.topped_up_today_usd_micro))],
                          ["Daily cap", formatUsd(BigInt(account.daily_topup_cap_usd_micro))],
                          ["Auto top-up", formatUsd(BigInt(account.auto_topup_usd_micro))],
                        ].map(([label, value]) => (
                          <div key={label} className="flex justify-between py-1 text-[13px]">
                            <dt className={MUTED}>{label}</dt>
                            <dd className="tabular-nums text-[#1E1E1E]">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    ) : null}
                </div>
              </div>

              {noticeOpen ? (
                <div className="border border-[#CECECE] bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-semibold text-[#1E1E1E]">Announcements</p>
                    <button
                      type="button"
                      onClick={() => setNoticeOpen(false)}
                      aria-label="dismiss announcements"
                      className="text-[#757575] hover:text-[#1E1E1E]"
                    >
                      ×
                    </button>
                  </div>
                  <ul className="mt-3 space-y-3 text-[13px] leading-5">
                    <li>
                      <p className="text-[#1E1E1E]">Asks-only venue</p>
                      <p className={MUTED}>
                        Sellers list MTokens; there is no bid side yet. Each ask shows the price and size
                        it unlocks.
                      </p>
                    </li>
                    <li>
                      <p className="text-[#1E1E1E]">Every fill rolls up</p>
                      <p className={MUTED}>
                        Usage roots land on the public record —{" "}
                        <Link href="/receipts" className="text-[#1743FF] hover:underline">
                          receipts
                        </Link>
                        .
                      </p>
                    </li>
                    <li>
                      <p className="text-[#1E1E1E]">Buying needs an agent key</p>
                      <p className={MUTED}>
                        Paste it once on{" "}
                        <Link href="/keys" className="text-[#1743FF] hover:underline">
                          keys
                        </Link>
                        ; it stays in this browser.
                      </p>
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="mt-5 border border-[#CECECE] bg-white">
        <div className="flex flex-wrap items-center gap-5 border-b border-[#D9D9D9] px-4 py-2.5 text-[14px]">
          {(["mine", "venue"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDock(item)}
              aria-pressed={dock === item}
              className={`${
                dock === item
                  ? "font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                  : "text-[#757575] hover:text-[#1E1E1E]"
              }`}
            >
              {item === "mine" ? "your fills" : "venue fills"}
            </button>
          ))}
          <span className={`ml-auto text-[13px] ${MUTED}`}>
            {dock === "mine" ? `${fills.length} this session` : `${venueFills.length} printed on ${model}`}
          </span>
        </div>

        <div className="grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_90px] gap-x-4 px-4 py-1.5 text-[11px] text-[#757575]">
          <span>Time</span>
          <span className="text-right">Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Charge</span>
          <span className="text-right">Record</span>
        </div>

        {dock === "mine" ? (
          fills.length === 0 ? (
            <p className="border-t border-[#D9D9D9] px-4 py-5 text-[14px] text-[#757575]">
              Nothing bought from this browser yet.
            </p>
          ) : (
            fills.map((fill) => (
              <div
                key={fill.listing_id}
                className="grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_90px] gap-x-4 border-t border-[#D9D9D9] px-4 py-2.5 text-[13px] tabular-nums"
              >
                <span className={MUTED}>{timeShort(fill.at)}</span>
                <span className="text-right text-[#1E1E1E]">{formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}</span>
                <span className={`text-right ${MUTED}`}>{formatMtok(BigInt(fill.tokens))} MTok</span>
                <span className="text-right font-semibold text-[#1E1E1E]">{formatUsd(BigInt(fill.charge_usd_micro))}</span>
                <span className="text-right">
                  <Link href="/receipts" className="text-[#1743FF] hover:underline">
                    rollup →
                  </Link>
                </span>
              </div>
            ))
          )
        ) : venueFills.length === 0 ? (
          <p className="border-t border-[#D9D9D9] px-4 py-5 text-[14px] text-[#757575]">
            The venue has not printed a fill for {model} yet.
          </p>
        ) : (
          venueFills.map((fill) => (
            <div
              key={`${fill.listing_id}-${fill.created_at}`}
              className="grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_90px] gap-x-4 border-t border-[#D9D9D9] px-4 py-2.5 text-[13px] tabular-nums"
            >
              <span className={MUTED}>{timeShort(fill.created_at)}</span>
              <span className="text-right text-[#1E1E1E]">{formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}</span>
              <span className={`text-right ${MUTED}`}>{formatMtok(BigInt(fill.tokens))} MTok</span>
              <span className="text-right font-semibold text-[#1E1E1E]">
                {formatUsd(charge(BigInt(fill.tokens), BigInt(fill.price_micro_per_mtok)))}
              </span>
              <span />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | undefined;
}) {
  return (
    <div>
      <p className="text-[11px] leading-4 text-[#757575]">{label}</p>
      <p
        className={`text-[14px] font-semibold tabular-nums ${
          tone === "up" ? "text-[#2EBD85]" : tone === "down" ? "text-[#F6465D]" : "text-[#1E1E1E]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function timeShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return clockFormat.format(date);
}
