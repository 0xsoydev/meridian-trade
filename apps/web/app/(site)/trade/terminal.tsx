"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseError } from "viem";
import { useConnection } from "wagmi";
import {
  charge,
  formatMicroPerMtok,
  formatMtok,
  formatUsd,
  parseMtok,
  previewFill,
  TOPUP_MAX_MICRO,
} from "../../../lib/price.ts";
import type {
  Balance,
  Book,
  ModelRow,
  RouterError,
  Trade,
  TradeResult,
} from "../../../lib/types";
import { useWalletDeposit } from "../wallet-deposit";
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

type Stat = { label: string; value: string; tone?: "up" | "down" | undefined };

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
  const { ready, login } = usePrivy();
  const { address } = useConnection();
  const walletDeposit = useWalletDeposit();
  const [paying, setPaying] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [account, setAccount] = useState<Balance | null>(null);
  const [pending, setPending] = useState(false);
  const [fills, setFills] = useState<SessionFill[]>([]);
  const [problem, setProblem] = useState<{ message: string; shortfall: bigint | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState<string | null>(null);
  const nowRef = useRef(Date.now());
  const picker = useRef<HTMLDetailsElement | null>(null);

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
  const volume = venueFills.reduce((total, fill) => total + BigInt(fill.tokens), 0n);
  const widest = asks.reduce((max, ask) => (BigInt(ask.tokens_left) > max ? BigInt(ask.tokens_left) : max), 0n);

  const affordable =
    balance !== null && bestAsk !== null && balance > 0n ? (balance * 1_000_000n) / bestAsk : 0n;
  const affordPct =
    affordable > 0n
      ? Math.max(0, Math.min(100, Math.round((Number(wanted) / Number(affordable)) * 100)))
      : 0;
  const overCap = wanted > MAX_TOKENS;
  const shortfall =
    balance !== null && preview.cost > balance ? ((preview.cost - balance + 9_999n) / 10_000n) * 10_000n : 0n;
  const wallet = account?.wallet ?? null;
  const payFromWallet = wallet !== null && shortfall > 0n;
  const payBlocked = !payFromWallet
    ? null
    : shortfall > TOPUP_MAX_MICRO
      ? `One wallet deposit carries at most ${formatUsd(TOPUP_MAX_MICRO)}; buy less, or deposit in parts on Keys.`
      : address && address.toLowerCase() !== wallet
        ? `Connect ${wallet}, the wallet that created this key, to pay.`
        : null;

  const pick = (id: string) => {
    setModel(id);
    setFills([]);
    if (picker.current) picker.current.open = false;
    router.replace(`/trade?model=${encodeURIComponent(id)}`, { scroll: false });
  };

  const buy = async () => {
    if (!key || wanted === 0n || pending) return;
    setPending(true);
    setProblem(null);
    setFills([]);
    try {
      if (payFromWallet) {
        setPaying(true);
        try {
          await walletDeposit(key, shortfall, account);
        } finally {
          setPaying(false);
        }
      }
      const res = await fetch("/api/v1/trades", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, tokens: wanted.toString() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as RouterError | null;
        const code = body?.error?.code;
        setProblem({
          message:
            code === "invalid_api_key"
              ? "router key rejected — paste it again on Keys"
              : code === "no_liquidity"
                ? "the asks moved before the fill; retry"
                : body?.error?.message ?? `request failed (${res.status})`,
          shortfall: wallet === null && balance !== null && preview.cost > balance ? preview.cost - balance : null,
        });
        return;
      }
      const result = (await res.json()) as TradeResult;
      const at = new Date().toISOString();
      setFills(result.fills.map((fill) => ({ ...fill, at })));
      setDock("mine");
      void refreshBook();
      void refreshBalance();
    } catch (cause) {
      setProblem({
        message: cause instanceof BaseError ? cause.shortMessage : cause instanceof Error ? cause.message : "network error — retry",
        shortfall: null,
      });
      void refreshBalance();
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

  const stats: Stat[] = [
    { label: "best ask", value: bestAsk !== null ? formatMicroPerMtok(bestAsk) : "—" },
    { label: "list price", value: listPrice !== null ? formatMicroPerMtok(listPrice) : "—" },
    {
      label: "under list",
      value:
        bestAsk !== null && listPrice !== null && listPrice > 0n
          ? `${formatMicroPerMtok(((listPrice - bestAsk) * 100_000_000n) / listPrice)}%`
          : "—",
      tone: "down",
    },
    {
      label: "change, window",
      value: delta !== null ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)}%` : "—",
      tone: delta === null ? undefined : delta >= 0 ? "up" : "down",
    },
    { label: "volume", value: `${formatMtok(volume)} MTok` },
    { label: "depth", value: `${formatMtok(depth)} MTok` },
  ];

  return (
    <section>
      <h1 className="font-serif text-[50px] leading-[1.05] text-[#1E1E1E]">
        Trade what <span className="text-[#A3A3A3]">expires</span>
      </h1>
      <p className="mt-4 max-w-[425px] text-[14px] leading-[18px] text-black">
        Pick a model, read the asks, and buy MTokens at the book price. Ten percent keeps the venue
        running; the rest goes to the seller. Every fill prints to the public log.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <details ref={picker} className="relative">
          <summary className="flex cursor-pointer list-none items-baseline gap-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[15px] font-semibold text-[#1E1E1E]">{model} / USDC</span>
              <span className={`block text-[11px] ${MUTED}`}>
                spot · {selected ? `${selected.rails.length} rail${selected.rails.length === 1 ? "" : "s"}` : "loading"}
              </span>
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
              balance <span className="font-semibold">{formatUsd(balance)}</span>
            </span>
          ) : null}
          <Link href="/keys" className="text-[#1743FF] hover:underline">
            {key ? "manage keys" : "connect your agent"}
          </Link>
        </div>
      </div>

      <div className="mt-6 border-t border-[#CECECE] pt-5">
        <p className="text-[13px] text-[#1E1E1E]">[ live ask book ]</p>
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

      <div className={`mt-5 grid gap-[17px] ${expanded ? "" : "lg:grid-cols-[1fr_300px]"}`}>
        <div className="border border-[#CECECE] bg-[#EBEBEB] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-pressed={expanded}
              className="text-[14px] text-[#1743FF] hover:underline"
              aria-label={expanded ? "show the buy ticket" : "expand the chart"}
            >
              {expanded ? "show the buy ticket" : "expand the chart"}
            </button>
          </div>

          <div className={`flex flex-wrap gap-x-4 gap-y-0.5 pt-3 text-[13px] ${MUTED}`}>
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
                  first <span className="tabular-nums text-[#1E1E1E]">{first?.toFixed(4)}</span>
                </span>
                <span>
                  high <span className="tabular-nums text-[#1E1E1E]">{Math.max(...points.map((p) => p.value)).toFixed(4)}</span>
                </span>
                <span>
                  low <span className="tabular-nums text-[#1E1E1E]">{Math.min(...points.map((p) => p.value)).toFixed(4)}</span>
                </span>
                <span>
                  last <span className="tabular-nums text-[#1E1E1E]">{last?.toFixed(4)}</span>
                </span>
              </>
            ) : null}
          </div>

          <FillsChart points={points} scale={scale} />

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

          <div className="mt-5 border-t border-[#D9D9D9] pt-4">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-[22px] leading-tight text-[#1E1E1E]">
                {pane === "book" ? "Ask book" : "Fill tape"}
              </h2>
              <div className="flex gap-4">
                {(["book", "tape"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPane(item)}
                    aria-pressed={pane === item}
                    className={`text-[14px] ${
                      pane === item
                        ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                        : "text-[#757575] hover:text-[#1E1E1E]"
                    }`}
                  >
                    {item === "book" ? "Order book" : "Trades"}
                  </button>
                ))}
              </div>
            </div>

            {pane === "book" ? (
              <>
                <div className="mt-3">
                  {asks.map((ask) => (
                    <div
                      key={ask.listing_id}
                      className="flex items-baseline justify-between gap-4 border-t border-[#D9D9D9] py-3"
                      style={{
                        background: `linear-gradient(90deg, rgba(23, 67, 255, ${widest === 0n ? 0 : (Number(BigInt(ask.tokens_left)) / Number(widest)) * 0.12}) , rgba(23, 67, 255, 0) 100%)`,
                      }}
                    >
                      <span className="text-[14px] tabular-nums text-[#1E1E1E]">
                        {formatMicroPerMtok(BigInt(ask.price_micro_per_mtok))}
                        <span className={`ml-1.5 text-[12px] ${MUTED}`}>USD / MTok</span>
                      </span>
                      <span className="text-[13px] tabular-nums text-[#757575]">
                        {formatMtok(BigInt(ask.tokens_left))} MTok
                      </span>
                      <span className={`text-[13px] ${ask.verifiable ? "text-[#1743FF]" : MUTED}`}>
                        {ask.rail}
                        {ask.verifiable ? " · TEE" : ""}
                      </span>
                    </div>
                  ))}
                  {asks.length === 0 ? (
                    <p className="border-t border-[#D9D9D9] py-6 text-center text-[14px] text-[#757575]">
                      no asks yet for {model}
                    </p>
                  ) : null}
                </div>
                <p className="border-t border-[#D9D9D9] pt-3 text-[13px] text-[#757575]">
                  no bids — asks supply this venue. book depth: {formatMtok(depth)} MTok
                </p>
              </>
            ) : (
              <div className="mt-3">
                {venueFills.slice(0, 40).map((fill, index) => {
                  const next = venueFills[index + 1];
                  const up = next === undefined || BigInt(fill.price_micro_per_mtok) >= BigInt(next.price_micro_per_mtok);
                  return (
                    <div key={`${fill.listing_id}-${fill.created_at}`} className="flex items-baseline justify-between gap-4 border-t border-[#D9D9D9] py-3">
                      <span className={`text-[13px] tabular-nums ${MUTED}`}>{timeShort(fill.created_at)}</span>
                      <span className={`text-[14px] tabular-nums ${up ? "text-[#2EBD85]" : "text-[#F6465D]"}`}>
                        {formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}
                      </span>
                      <span className={`text-[13px] tabular-nums ${MUTED}`}>{formatMtok(BigInt(fill.tokens))} MTok</span>
                    </div>
                  );
                })}
                {venueFills.length === 0 ? (
                  <p className="border-t border-[#D9D9D9] py-6 text-center text-[14px] text-[#757575]">
                    the venue has not printed a fill for {model} yet
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {!expanded && (
          <div className="border border-[#CECECE] bg-[#EBEBEB] p-4">
            <div className="flex border border-[#CECECE] bg-white">
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

            <div className="mt-4 space-y-4">
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
                    Create one with your wallet on Keys, or paste an agent&apos;s key there. It stays in this
                    browser, never in a URL.
                  </p>
                </div>
              ) : null}

              {key === null ? (
                <Link
                  href="/keys"
                  className="flex h-[34px] items-center justify-center bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E]"
                >
                  Create a key on Keys
                </Link>
              ) : payFromWallet && !address ? (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => login()}
                  className="h-[34px] w-full bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4]"
                >
                  Connect wallet to pay
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void buy()}
                  disabled={pending || wanted === 0n || preview.cost === 0n || overCap || payBlocked !== null}
                  className="h-[34px] w-full bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
                >
                  {paying
                    ? "Paying from your wallet…"
                    : pending
                      ? "Buying…"
                      : wanted === 0n
                        ? "Enter a size"
                        : payFromWallet
                          ? `Pay ${formatUsd(shortfall)} and buy ${formatMtok(wanted)} MTok`
                          : `Buy ${formatMtok(wanted)} MTok`}
                </button>
              )}

              {shortfall > 0n ? (
                <p
                  className={`text-center text-[13px] leading-5 ${payFromWallet && payBlocked === null ? "text-[#757575]" : "text-[#F6465D]"}`}
                >
                  {!payFromWallet
                    ? `Short by ${formatUsd(shortfall)} — top up the agent.`
                    : payBlocked ??
                      (address
                        ? `The key is short ${formatUsd(shortfall)}; Buy sends it from your wallet in Hedera testnet USDC first.`
                        : `The key is short ${formatUsd(shortfall)}; connect the wallet that created it to pay in Hedera testnet USDC.`)}
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
        )}
      </div>

      <div className="mt-10 border-t border-[#CECECE] pt-8">
        <p className="text-[13px] text-[#1E1E1E]">[ public log ]</p>
        <h2 className="mt-3 font-serif text-[32px] leading-[1.1] text-[#1E1E1E]">
          Every fill, on the record.
        </h2>

        <div className="mt-4 flex items-center gap-5">
          {(["mine", "venue"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDock(item)}
              aria-pressed={dock === item}
              className={`text-[14px] ${
                dock === item
                  ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                  : "text-[#757575] hover:text-[#1E1E1E]"
              }`}
            >
              {item === "mine" ? "your fills" : "venue fills"}
            </button>
          ))}
          <span className={`text-[13px] ${MUTED}`}>
            {dock === "mine" ? `${fills.length} this session` : `${venueFills.length} printed on ${model}`}
          </span>
        </div>

        <div className="mt-4">
          {dock === "mine" ? (
            fills.length === 0 ? (
              <p className="border-t border-[#CECECE] py-5 text-[14px] text-[#757575]">
                Nothing bought from this browser yet.
              </p>
            ) : (
              fills.map((fill) => (
                <div key={fill.listing_id} className="flex flex-wrap items-baseline justify-between gap-4 border-t border-[#CECECE] py-4">
                  <span className={`text-[13px] tabular-nums ${MUTED}`}>{timeShort(fill.at)} UTC</span>
                  <span className="text-[14px] tabular-nums text-[#1E1E1E]">
                    {formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}
                    <span className={`ml-1.5 text-[12px] ${MUTED}`}>USD / MTok</span>
                  </span>
                  <span className={`text-[13px] tabular-nums ${MUTED}`}>{formatMtok(BigInt(fill.tokens))} MTok</span>
                  <span className="text-[14px] font-semibold tabular-nums text-[#1E1E1E]">{formatUsd(BigInt(fill.charge_usd_micro))}</span>
                  <Link href="/receipts" className="text-[14px] text-[#1743FF] hover:underline">
                    its rollup →
                  </Link>
                </div>
              ))
            )
          ) : venueFills.length === 0 ? (
            <p className="border-t border-[#CECECE] py-5 text-[14px] text-[#757575]">
              The venue has not printed a fill for {model} yet.
            </p>
          ) : (
            venueFills.map((fill) => (
              <div key={`${fill.listing_id}-${fill.created_at}`} className="flex flex-wrap items-baseline justify-between gap-4 border-t border-[#CECECE] py-4">
                <span className={`text-[13px] tabular-nums ${MUTED}`}>{timeShort(fill.created_at)} UTC</span>
                <span className="text-[14px] tabular-nums text-[#1E1E1E]">
                  {formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}
                  <span className={`ml-1.5 text-[12px] ${MUTED}`}>USD / MTok</span>
                </span>
                <span className={`text-[13px] tabular-nums ${MUTED}`}>{formatMtok(BigInt(fill.tokens))} MTok</span>
                <span className="text-[14px] font-semibold tabular-nums text-[#1E1E1E]">
                  {formatUsd(charge(BigInt(fill.tokens), BigInt(fill.price_micro_per_mtok)))}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function timeShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return clockFormat.format(date);
}
