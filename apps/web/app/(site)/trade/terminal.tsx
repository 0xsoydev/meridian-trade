"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BaseError } from "viem";
import { useConnection } from "wagmi";
import { z } from "zod";
import ProfileDropdown from "../../../components/kokonutui/profile-dropdown";
import {
  charge,
  clockFormat,
  fillsToPoints,
  formatMicroPerMtok,
  formatMtok,
  formatUsd,
  parseMtok,
  parseUsd,
  previewFill,
  sellerEarning,
  TOPUP_MAX_MICRO,
} from "../../../lib/price.ts";
import type { Balance, Bid, Book, RouterError, TradeResult } from "../../../lib/types";
import { useModels } from "../models";
import { useWalletDeposit } from "../wallet-deposit";
import { FillsChart, INTERVALS, type ScaleMode } from "./chart";
import { OrderBook } from "./order-book";
import { OrdersPanel } from "./orders-panel";

const KEY_STORAGE = "router_key";
const TAKE_BPS = 1000n;
const MAX_TOKENS = 1_000_000_000n;
const POLL_MS = 15_000;

const PRESETS = [
  { label: "1", value: "1" },
  { label: "10", value: "10" },
  { label: "100", value: "100" },
  { label: "1K", value: "1000" },
];

const MUTED = "text-[#757575]";

const digits = z.string().regex(/^\d+$/);
const holdingSchema = z.object({ data: z.array(z.object({ tokens: digits })) });
const soldSchema = z.object({
  fills: z.array(z.object({ tokens: digits, charge_usd_micro: digits })),
  offers: z.array(z.object({ tokens: digits, price_micro_per_mtok: digits })),
});

export function Trade({ initialModel }: { initialModel: string }) {
  const router = useRouter();
  const [model, setModel] = useState(initialModel);
  const models = useModels();
  const [book, setBook] = useState<Book | null>(null);
  const [bookFailed, setBookFailed] = useState<"unknown" | "down" | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [bucket, setBucket] = useState(60);
  const [scale, setScale] = useState<ScaleMode>("linear");
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState("10");
  const [limitPrice, setLimitPrice] = useState("");
  const [rested, setRested] = useState<Bid | null>(null);
  const [ordersVersion, setOrdersVersion] = useState(0);
  const { ready, login } = usePrivy();
  const { address } = useConnection();
  const walletDeposit = useWalletDeposit();
  const [paying, setPaying] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [account, setAccount] = useState<Balance | null>(null);
  const [pending, setPending] = useState(false);
  const [holding, setHolding] = useState<bigint | null>(null);
  const [sold, setSold] = useState<z.infer<typeof soldSchema> | null>(null);
  const [problem, setProblem] = useState<{ message: string; shortfall: bigint | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [statusBar, setStatusBar] = useState<HTMLElement | null>(null);
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
    setKey(window.localStorage.getItem(KEY_STORAGE));
    setStatusBar(document.getElementById("status-bar"));
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

  const refreshHolding = useCallback(async () => {
    const token = window.localStorage.getItem(KEY_STORAGE);
    if (!token) {
      setHolding(null);
      return;
    }
    const res = await fetch(`/api/v1/holdings?model=${encodeURIComponent(model)}`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null);
    const parsed = holdingSchema.safeParse(res?.ok ? await res.json().catch(() => null) : null);
    setHolding(parsed.success ? parsed.data.data.reduce((sum, row) => sum + BigInt(row.tokens), 0n) : null);
  }, [model]);

  useEffect(() => {
    setProblem(null);
    setSold(null);
    void refreshBalance();
    void refreshHolding();
  }, [model, refreshBalance, refreshHolding]);

  const selected = models.find((row) => row.id === model);
  const asks = book?.asks ?? [];
  const venueFills = book?.fills ?? [];
  const wanted = parseMtok(size);
  const limit = limitPrice.trim() === "" ? null : parseUsd(limitPrice);
  const limitBad = limitPrice.trim() !== "" && (limit === null || limit === 0n);
  const preview = useMemo(
    () => previewFill(limit === null ? asks : asks.filter((ask) => BigInt(ask.price_micro_per_mtok) <= limit), wanted, TAKE_BPS),
    [asks, limit, wanted],
  );
  const resting = limit !== null && wanted > preview.fillable ? wanted - preview.fillable : 0n;
  const hold = limit !== null && resting > 0n ? charge(resting, limit) : 0n;
  const needed = preview.cost + hold;
  const points = useMemo(() => fillsToPoints(venueFills), [venueFills]);

  const bidLevels = book?.bids ?? [];
  const sellPreview = previewFill(
    bidLevels
      .filter((level) => limit === null || BigInt(level.price_micro_per_mtok) >= limit)
      .map((level) => ({ price_micro_per_mtok: level.price_micro_per_mtok, tokens_left: level.tokens })),
    wanted,
    TAKE_BPS,
  );
  const listing = limit !== null && wanted > sellPreview.fillable ? wanted - sellPreview.fillable : 0n;

  const bestAsk = asks[0] ? BigInt(asks[0].price_micro_per_mtok) : null;
  const bestBid = bidLevels[0] ? BigInt(bidLevels[0].price_micro_per_mtok) : null;
  const listPrice = selected ? BigInt(selected.reference_blended_micro_per_mtok) : null;
  const ceiling = selected ? BigInt(selected.list_ceiling_micro_per_mtok) : null;
  const limitHigh = limit !== null && ceiling !== null && limit > ceiling;
  const limitNote =
    limit === null || limitBad
      ? null
      : limitHigh && ceiling !== null
        ? { bad: true, text: `Above the ${formatMicroPerMtok(ceiling)} list price: no ask can sit above it.` }
        : side === "buy"
          ? resting === 0n
            ? { bad: false, text: "At or above the best ask: fills now at the asks, never above your limit." }
            : preview.fillable === 0n
              ? { bad: false, text: `Below the best ask: waits on the book as a bid at ${formatMicroPerMtok(limit)}.` }
              : null
          : listing === 0n
            ? { bad: false, text: "At or below the best bid: sells now into the bids, never below your limit." }
            : sellPreview.fillable === 0n
              ? { bad: false, text: `Above the best bid: waits on the book as an ask at ${formatMicroPerMtok(limit)}.` }
              : null;
  const action =
    limit === null
      ? `buy ${formatMtok(wanted)} MTok`
      : resting === 0n
        ? `buy ${formatMtok(wanted)} MTok now (limit ${formatMicroPerMtok(limit)})`
        : preview.fillable === 0n
          ? `bid for ${formatMtok(wanted)} MTok at ${formatMicroPerMtok(limit)}`
          : `buy ${formatMtok(preview.fillable)} MTok now, bid for ${formatMtok(resting)} at ${formatMicroPerMtok(limit)}`;
  const sellAction =
    limit === null
      ? `sell ${formatMtok(wanted)} MTok`
      : listing === 0n
        ? `sell ${formatMtok(wanted)} MTok now (limit ${formatMicroPerMtok(limit)})`
        : sellPreview.fillable === 0n
          ? `list ${formatMtok(wanted)} MTok at ${formatMicroPerMtok(limit)}`
          : `sell ${formatMtok(sellPreview.fillable)} MTok now, list ${formatMtok(listing)} at ${formatMicroPerMtok(limit)}`;
  const shortHolding = holding !== null && wanted > holding;
  const soldTokens = sold ? sold.fills.reduce((sum, fill) => sum + BigInt(fill.tokens), 0n) : 0n;
  const soldNet = sold ? sold.fills.reduce((sum, fill) => sum + sellerEarning(BigInt(fill.charge_usd_micro), TAKE_BPS), 0n) : 0n;
  const listedTokens = sold ? sold.offers.reduce((sum, offer) => sum + BigInt(offer.tokens), 0n) : 0n;
  const listedAt = sold?.offers[0]?.price_micro_per_mtok ?? null;
  const last = points.at(-1)?.value ?? null;
  const first = points[0]?.value ?? null;
  const delta = last !== null && first !== null ? (last - first) / first : null;
  const depth = asks.reduce((total, ask) => total + BigInt(ask.tokens_left), 0n);

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

  const affordable =
    balance !== null && bestAsk !== null && balance > 0n ? (balance * 1_000_000n) / bestAsk : 0n;
  const sizeCap = side === "buy" ? affordable : (holding ?? 0n);
  const sizePct =
    sizeCap > 0n ? Math.max(0, Math.min(100, Math.round((Number(wanted) / Number(sizeCap)) * 100))) : 0;
  const overCap = wanted > MAX_TOKENS;
  const shortfall =
    balance !== null && needed > balance ? ((needed - balance + 9_999n) / 10_000n) * 10_000n : 0n;
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
    router.replace(`/trade?model=${encodeURIComponent(id)}`, { scroll: false });
  };

  const buy = async () => {
    if (!key || wanted === 0n || pending || limitBad || limitHigh) return;
    setPending(true);
    setProblem(null);
    setRested(null);
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
        body: JSON.stringify(
          limit === null
            ? { model, tokens: wanted.toString() }
            : { model, tokens: wanted.toString(), limit_price_micro_per_mtok: limit.toString() },
        ),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as RouterError | null;
        const code = body?.error?.code;
        setProblem({
          message:
            code === "invalid_api_key"
              ? "router key rejected; create a new one on Keys"
              : code === "no_liquidity"
                ? "the asks moved before the fill; retry"
                : body?.error?.message ?? `request failed (${res.status})`,
          shortfall: wallet === null && balance !== null && needed > balance ? needed - balance : null,
        });
        return;
      }
      const result = (await res.json()) as TradeResult;
      setRested(result.bid);
      setOrdersVersion((value) => value + 1);
      void refreshBook();
      void refreshBalance();
      void refreshHolding();
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

  const sellNow = async () => {
    if (!key || wanted === 0n || pending || limitBad || limitHigh || shortHolding) return;
    setPending(true);
    setProblem(null);
    setSold(null);
    try {
      const res = await fetch("/api/v1/sells", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(
          limit === null
            ? { model, tokens: wanted.toString() }
            : { model, tokens: wanted.toString(), limit_price_micro_per_mtok: limit.toString() },
        ),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
        setProblem({ message: failure.data?.error.message ?? `request failed (${res.status})`, shortfall: null });
        return;
      }
      const result = soldSchema.safeParse(body);
      setSold(result.success ? result.data : null);
      setOrdersVersion((value) => value + 1);
      void refreshBook();
      void refreshBalance();
      void refreshHolding();
    } catch (cause) {
      setProblem({ message: cause instanceof Error ? cause.message : "network error — retry", shortfall: null });
    } finally {
      setPending(false);
    }
  };

  const topupCommand = () => {
    const cents = ((needed - (balance ?? 0n) + 9_999n) / 10_000n) * 10_000n;
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

  return (
    <section className="relative -mx-4 -my-4 bg-[#F1F1F1] px-4 py-4 lg:-mx-6 lg:-my-6 lg:px-10 lg:py-6">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-6 hidden w-px bg-[#CECECE] lg:block" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-6 hidden w-px bg-[#CECECE] lg:block" />
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[6px] border border-[#E4E4E4] bg-white px-4 py-3">
        <p className="w-full text-[10px] font-medium tracking-[0.14em] text-[#757575] uppercase">
          Live book · {model}
        </p>
        <ProfileDropdown
          accounts={modelAccounts}
          defaultAccountId={model}
          onAccountChange={(entry) => pick(entry.id)}
          info={{ label: "Available to trade", value: balance !== null ? formatUsd(balance) : "—" }}
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
        <div className="flex flex-col self-start rounded-[6px] border border-[#E4E4E4] bg-white">
          <div className="flex items-center gap-5 border-b border-[#ECECEC] px-4 py-2.5 text-[14px]">
            <span className="font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4">
              Chart
            </span>
            <span className={MUTED}>Funding</span>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-pressed={expanded}
              className="ml-auto text-[13px] text-[#1743FF] hover:underline"
              aria-label={expanded ? "show the ticket" : "expand the chart"}
            >
              {expanded ? "show the ticket" : "expand"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-5 px-4 py-2 text-[14px]">
            <div role="group" aria-label="candle interval" className="flex gap-5">
              {INTERVALS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setBucket(item.seconds)}
                  aria-pressed={bucket === item.seconds}
                  className={`${
                    bucket === item.seconds
                      ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                      : "text-[#757575] hover:text-[#1E1E1E]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
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

          <FillsChart points={points} bucket={bucket} scale={scale} className="h-[calc(100svh-380px)] min-h-[320px]" />
        </div>

        {!expanded && (
          <>
            <OrderBook book={book} model={model} listPrice={listPrice} />

            <div className="flex flex-col gap-[17px] self-start lg:h-[calc(100svh-277px)] lg:min-h-[423px]">
              <div className="flex min-h-0 flex-1 flex-col rounded-[6px] border border-[#E4E4E4] bg-white">
                <div className="flex shrink-0 border-b border-[#ECECEC]">
                  {(["buy", "sell"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setSide(item)}
                      aria-pressed={side === item}
                      className={`w-1/2 py-2 text-[14px] font-semibold ${item === "sell" ? "border-l border-[#E4E4E4]" : ""} ${
                        side === item ? "bg-black text-white" : "text-[#757575] hover:text-[#1E1E1E]"
                      }`}
                    >
                      {item === "buy" ? "Buy" : "Sell"}
                    </button>
                  ))}
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
                  <div className="flex justify-between text-[14px]">
                    <span className={MUTED}>{side === "buy" ? "Available to trade" : "Available to sell"}</span>
                    <span className="tabular-nums text-[#1E1E1E]">
                      {side === "buy"
                        ? balance !== null
                          ? formatUsd(balance)
                          : "—"
                        : holding !== null
                          ? `${formatMtok(holding)} MTok`
                          : "—"}
                    </span>
                  </div>

                  <label className="block">
                    <span className={`mb-1 block text-[13px] ${MUTED}`}>Size, in MTokens</span>
                    <span className="flex items-center gap-2 rounded-[6px] border border-[#E4E4E4] bg-white px-2.5 focus-within:border-[#1743FF]">
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
                      value={sizePct}
                      disabled={sizeCap === 0n}
                      onChange={(event) => setSize(formatMtok((sizeCap * BigInt(event.target.value)) / 100n))}
                      aria-label={side === "buy" ? "share of what the balance affords" : "share of what you hold"}
                      className="h-1 w-full accent-[#1743FF] disabled:opacity-40"
                    />
                    <span className={`shrink-0 whitespace-nowrap text-right text-[12px] leading-4 tabular-nums ${MUTED}`}>
                      {sizePct}% of {side === "buy" ? "balance" : "holding"}
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

                  <label className="block">
                    <span className={`mb-1 block text-[13px] ${MUTED}`}>Limit price, USD per MTok (blank: market)</span>
                    <input
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(event.target.value)}
                      inputMode="decimal"
                      placeholder="market"
                      className={`h-[34px] w-full border bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF] ${limitBad || limitHigh ? "border-[#F6465D]" : "border-[#E4E4E4]"}`}
                    />
                    {limitNote ? (
                      <span className={`mt-1 block text-[12px] leading-4 ${limitNote.bad ? "text-[#F6465D]" : MUTED}`}>{limitNote.text}</span>
                    ) : null}
                  </label>

                  {side === "buy" ? (
                    <dl className="border-t border-[#ECECEC]">
                      <div className="flex justify-between border-b border-[#ECECEC] py-2 text-[14px]">
                        <dt className={MUTED}>Average ask</dt>
                        <dd className="tabular-nums text-[#1E1E1E]">{preview.fillable > 0n ? formatMicroPerMtok(preview.avg) : "—"}</dd>
                      </div>
                      <div className="flex justify-between border-b border-[#ECECEC] py-2 text-[14px]">
                        <dt className={MUTED}>Venue fee, 10 percent</dt>
                        <dd className="tabular-nums text-[#1E1E1E]">{preview.fee > 0n ? formatUsd(preview.fee) : "—"}</dd>
                      </div>
                      <div className="flex justify-between border-b border-[#ECECEC] py-2 text-[14px]">
                        <dt className={MUTED}>Seller receives</dt>
                        <dd className="tabular-nums text-[#1E1E1E]">{preview.net > 0n ? formatUsd(preview.net) : "—"}</dd>
                      </div>
                      {hold > 0n ? (
                        <div className="flex justify-between border-b border-[#ECECEC] py-2 text-[14px]">
                          <dt className={MUTED}>Held for the bid</dt>
                          <dd className="tabular-nums text-[#1E1E1E]">{formatUsd(hold)}</dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between py-3">
                        <dt className="text-[15px] font-semibold text-[#1E1E1E]">You pay</dt>
                        <dd className="text-[16px] font-semibold tabular-nums text-[#1E1E1E]">
                          {needed > 0n ? formatUsd(needed) : "—"}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <dl className="border-t border-[#ECECEC]">
                      <div className="flex justify-between border-b border-[#ECECEC] py-2 text-[14px]">
                        <dt className={MUTED}>Best bid</dt>
                        <dd className="tabular-nums text-[#1E1E1E]">{bestBid !== null ? formatMicroPerMtok(bestBid) : "none"}</dd>
                      </div>
                      <div className="flex justify-between border-b border-[#ECECEC] py-2 text-[14px]">
                        <dt className={MUTED}>Average bid</dt>
                        <dd className="tabular-nums text-[#1E1E1E]">
                          {sellPreview.fillable > 0n ? formatMicroPerMtok(sellPreview.avg) : "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between border-b border-[#ECECEC] py-2 text-[14px]">
                        <dt className={MUTED}>Venue fee, 10 percent</dt>
                        <dd className="tabular-nums text-[#1E1E1E]">{sellPreview.fee > 0n ? formatUsd(sellPreview.fee) : "—"}</dd>
                      </div>
                      {limit !== null && listing > 0n ? (
                        <div className="flex justify-between border-b border-[#ECECEC] py-2 text-[14px]">
                          <dt className={MUTED}>Rests as an ask</dt>
                          <dd className="tabular-nums text-[#1E1E1E]">
                            {formatMtok(listing)} MTok at {formatMicroPerMtok(limit)}
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between py-3">
                        <dt className="text-[15px] font-semibold text-[#1E1E1E]">You receive now</dt>
                        <dd className="text-[16px] font-semibold tabular-nums text-[#1E1E1E]">
                          {sellPreview.net > 0n ? formatUsd(sellPreview.net) : "—"}
                        </dd>
                      </div>
                    </dl>
                  )}

                  {side === "buy" && limit !== null && resting > 0n && !overCap ? (
                    <p className={`text-[13px] leading-5 ${MUTED}`}>
                      {formatMtok(preview.fillable)} MTok fill now; {formatMtok(resting)} MTok wait on the book as a bid at{" "}
                      {formatMicroPerMtok(limit)} until an ask meets it. Cancel returns what the bid still holds.
                    </p>
                  ) : side === "buy" && preview.partial && wanted > 0n && !overCap ? (
                    <p className="text-[13px] leading-5 text-[#F6465D]">
                      The book covers {formatMtok(preview.fillable)} of {formatMtok(wanted)} MTok. The rest stays unfilled.
                    </p>
                  ) : side === "sell" && limit !== null && listing > 0n && !overCap ? (
                    <p className={`text-[13px] leading-5 ${MUTED}`}>
                      {formatMtok(sellPreview.fillable)} MTok sell now; {formatMtok(listing)} MTok wait on the book as an ask at{" "}
                      {formatMicroPerMtok(limit)} until a buy meets it. Cancel returns them to your holdings.
                    </p>
                  ) : side === "sell" && limit === null && sellPreview.partial && sellPreview.fillable > 0n && !overCap ? (
                    <p className="text-[13px] leading-5 text-[#F6465D]">
                      The bids cover {formatMtok(sellPreview.fillable)} of {formatMtok(wanted)} MTok. The rest stays with you.
                    </p>
                  ) : null}

                  {overCap ? (
                    <p className="text-[13px] leading-5 text-[#F6465D]">
                      One trade caps at {formatMtok(MAX_TOKENS)} MTok.
                    </p>
                  ) : null}

                  {key === null ? (
                    <div className="border-t border-[#ECECEC] pt-3">
                      <p className="text-[14px] text-[#1E1E1E]">{side === "buy" ? "Buying" : "Selling"} needs a router key.</p>
                      <p className="mt-1 text-[13px] leading-5 text-[#757575]">
                        Create one with your wallet on Keys. It stays in this browser, never in a URL.
                      </p>
                    </div>
                  ) : null}

                  {key === null ? (
                    <Link
                      href="/keys"
                      className="flex h-[34px] items-center justify-center rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E]"
                    >
                      Create a key on Keys
                    </Link>
                  ) : side === "sell" ? (
                    <button
                      type="button"
                      onClick={() => void sellNow()}
                      disabled={
                        pending ||
                        wanted === 0n ||
                        overCap ||
                        limitBad ||
                        limitHigh ||
                        holding === null ||
                        shortHolding ||
                        (limit === null && sellPreview.fillable === 0n)
                      }
                      className="h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
                    >
                      {pending
                        ? "Placing the order…"
                        : wanted === 0n
                          ? "Enter a size"
                          : shortHolding && holding !== null
                            ? `You hold ${formatMtok(holding)} MTok`
                            : limitBad
                              ? "Enter a limit price in USD"
                              : limitHigh
                                ? "Lower the limit to the list price or below"
                                : limit === null && sellPreview.fillable === 0n
                                  ? "No bids; set a limit price to list them"
                                  : `${sellAction.charAt(0).toUpperCase()}${sellAction.slice(1)}`}
                    </button>
                  ) : payFromWallet && !address ? (
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => login()}
                      className="h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4]"
                    >
                      Connect wallet to pay
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void buy()}
                      disabled={pending || wanted === 0n || needed === 0n || overCap || limitBad || limitHigh || payBlocked !== null}
                      className="h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
                    >
                      {paying
                        ? "Paying from your wallet…"
                        : pending
                          ? "Placing the order…"
                          : wanted === 0n
                            ? "Enter a size"
                            : limitBad
                              ? "Enter a limit price in USD"
                              : limitHigh
                                ? "Lower the limit to the list price or below"
                                : payFromWallet
                                  ? `Pay ${formatUsd(shortfall)} and ${action}`
                                  : `${action.charAt(0).toUpperCase()}${action.slice(1)}`}
                    </button>
                  )}

                  {side === "buy" && shortfall > 0n ? (
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
                    <div className="rounded-[6px] border border-[#F6465D]/40 bg-white px-3 py-2">
                      <p className="text-[13px] leading-5 text-[#F6465D]">{problem.message}</p>
                      {problem.shortfall !== null ? (
                        <button
                          type="button"
                          onClick={() => void copyTopup()}
                          className="mt-2 w-full rounded-[6px] border border-[#E4E4E4] bg-white px-2 py-1.5 text-left text-[13px] tabular-nums text-[#1E1E1E] hover:border-[#1743FF]"
                        >
                          {copied ? "Copied — run it from your agent. " : "Copy top-up, "}
                          {`POST /api/v1/topup?usd=${formatMicroPerMtok(problem.shortfall)}`}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {side === "buy" && rested ? (
                    <p className="text-[13px] leading-5 text-[#2EBD85]">
                      {formatMtok(BigInt(rested.tokens))} MTok rest as a bid at{" "}
                      {formatMicroPerMtok(BigInt(rested.price_micro_per_mtok))}, holding {formatUsd(BigInt(rested.hold_usd_micro))}.
                    </p>
                  ) : null}

                  {side === "sell" && sold ? (
                    <p className="text-[13px] leading-5 text-[#2EBD85]">
                      {soldTokens > 0n ? `Sold ${formatMtok(soldTokens)} MTok for ${formatUsd(soldNet)}` : ""}
                      {soldTokens > 0n && listedTokens > 0n ? "; " : ""}
                      {listedTokens > 0n && listedAt !== null
                        ? `${formatMtok(listedTokens)} MTok listed at ${formatMicroPerMtok(BigInt(listedAt))}`
                        : ""}
                      .
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <OrdersPanel
        routerKey={key}
        model={model}
        venueFills={venueFills}
        account={account}
        version={ordersVersion}
        onChange={() => {
          void refreshBook();
          void refreshBalance();
          void refreshHolding();
        }}
      />

      {noticeOpen && statusBar
        ? createPortal(
            <div
              role="status"
              className="absolute bottom-full right-4 mb-4 w-[min(290px,calc(100vw-2rem))] rounded-[6px] border border-[#E4E4E4] bg-white p-4 shadow-[0_8px_24px_rgba(30,30,30,0.08)] transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none lg:right-6"
            >
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
                  <p className="text-[#1E1E1E]">Buying needs an API key</p>
                  <p className={MUTED}>
                    Create one on{" "}
                    <Link href="/keys" className="text-[#1743FF] hover:underline">
                      keys
                    </Link>
                    ; it stays in this browser.
                  </p>
                </li>
              </ul>
            </div>,
            statusBar,
          )
        : null}
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
