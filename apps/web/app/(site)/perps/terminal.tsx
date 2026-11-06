"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseError, type Hash } from "viem";
import { useConnection, useSwitchChain, useWalletClient } from "wagmi";
import ProfileDropdown from "../../../components/kokonutui/profile-dropdown";
import { mockUsdcAbi } from "../../../lib/abi";
import { addresses, galileo, publicClient } from "../../../lib/chain";
import { MARKETS, liquidationPrice, modify, notional, orderPlan, positionAfter, readMarket, readPosition } from "../../../lib/perp";
import { clockFormat, fillsToPoints, formatMicroPerMtok, formatMtok, formatUsd, parseMtok, parseUsd, stampFormat } from "../../../lib/price";
import type { Book, PerpFill } from "../../../lib/types";
import { useModels } from "../models";
import { FillsChart, INTERVALS, type ScaleMode } from "../trade/chart";
import { OrderBook } from "../trade/order-book";

const POLL_MS = 15_000;
const MAX_LEVERAGE = 5n;
const STALE_S = 600n;
const FAUCET_USDC = 100_000_000n;

type Market = Awaited<ReturnType<typeof readMarket>>;
type Held = Awaited<ReturnType<typeof readPosition>> & { model: string; price: bigint };

function signedUsd(value: bigint): string {
  return `${value < 0n ? "−" : ""}${formatUsd(value < 0n ? -value : value)}`;
}

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

const STRIP_TABS = ["Positions", "Trade History"] as const;

export function Perps({ initialModel }: { initialModel: string }) {
  const router = useRouter();
  const [model, setModel] = useState(initialModel);
  const models = useModels();
  const [book, setBook] = useState<Book | null>(null);
  const [bookFailed, setBookFailed] = useState<"unknown" | "down" | null>(null);
  const [chartTab, setChartTab] = useState<"Chart" | "Funding">("Chart");
  const [bucket, setBucket] = useState(60);
  const [scale, setScale] = useState<ScaleMode>("linear");
  const [expanded, setExpanded] = useState(false);
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
  const [history, setHistory] = useState<PerpFill[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [marginInput, setMarginInput] = useState("");
  const nowRef = useRef(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(clockFormat.format(new Date()));
      nowRef.current = Date.now();
    }, 1000);
    setClock(clockFormat.format(new Date()));
    return () => window.clearInterval(id);
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

  useEffect(() => {
    if (!address) {
      setHistory([]);
      return;
    }
    let alive = true;
    const load = () =>
      fetch(`/api/v1/perps/history?account=${address}`, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ data: PerpFill[] }>) : null))
        .then((body) => {
          if (alive && body) setHistory(body.data);
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [address, version]);

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
  const marketRows = models.filter((row) => MARKETS.some((id) => id === row.id));
  const asks = book?.asks ?? [];
  const wanted = parseMtok(size);
  const depth = asks.reduce((total, ask) => total + BigInt(ask.tokens_left), 0n);
  const listPrice = selected ? BigInt(selected.reference_blended_micro_per_mtok) : null;

  const points = useMemo(() => fillsToPoints(book?.fills ?? []), [book]);
  const points24 = useMemo(() => fillsToPoints(book?.fills ?? [], nowRef.current - 86_400_000), [book]);

  const bestAsk = asks[0] ? BigInt(asks[0].price_micro_per_mtok) : null;
  const lastFill = book?.fills[0];
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
  const current = held.find((row) => row.model === model) ?? null;
  const plan = mark !== null ? orderPlan(current?.size ?? 0n, side === "long" ? wanted : -wanted, mark, MAX_LEVERAGE) : [];
  const margin = plan.reduce((sum, leg) => sum + leg.margin, 0n);
  const resulting = mark !== null ? positionAfter(current, plan, mark) : null;
  const liqPreview = resulting ? liquidationPrice(resulting) : 0n;
  const heldSize = current ? (current.size < 0n ? -current.size : current.size) : 0n;
  const heldSide = current && current.size > 0n ? "long" : "short";
  const action =
    plan.length === 2
      ? `Close ${formatMtok(heldSize)} ${heldSide}, ${side} ${formatMtok(wanted - heldSize)} MTok`
      : plan[0]?.margin === 0n
        ? wanted === heldSize
          ? `Close ${formatMtok(heldSize)} MTok ${heldSide}`
          : `Reduce ${heldSide} by ${formatMtok(wanted)} MTok`
        : `${side === "long" ? "Long" : "Short"} ${wanted > 0n ? `${formatMtok(wanted)} MTok` : ""}`;
  const equityTotal = held.reduce((sum, row) => sum + row.equity, 0n);
  const pnlTotal = held.reduce((sum, row) => sum + (row.size * (row.price - row.entryPrice)) / 1_000_000n, 0n);
  const usableDepth = depth > 0n ? depth : 1n;
  const sliderPct = wanted >= usableDepth ? 100 : Number((wanted * 100n) / usableDepth);
  const first = points[0]?.value ?? null;
  const last = points.at(-1)?.value ?? null;
  const high = points.length > 0 ? Math.max(...points.map((point) => point.value)) : null;
  const low = points.length > 0 ? Math.min(...points.map((point) => point.value)) : null;
  const rangeDelta = first !== null && last !== null ? (last - first) / first : null;

  const pick = (id: string) => {
    setModel(id);
    router.replace(`/perps?model=${encodeURIComponent(id)}`, { scroll: false });
  };

  const stats: Stat[] = [
    { label: "Mark", value: mark !== null ? formatMicroPerMtok(mark) : "—" },
    { label: "Index", value: index !== null ? formatMicroPerMtok(index) : "—" },
    { label: "Best ask", value: bestAsk !== null ? formatMicroPerMtok(bestAsk) : "—" },
    {
      label: "24h change",
      value: delta !== null ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)}%` : "—",
      tone: delta === null ? undefined : delta >= 0 ? "up" : "down",
    },
    { label: "24h volume", value: volume24 > 0 ? `${volume24.toFixed(2)} MTok` : "—" },
    { label: "Open interest", value: market ? `${formatMtok(market.longOi)} / ${formatMtok(market.shortOi)} MTok` : "—" },
    { label: "Funding / hour", value: market ? `${(Number(market.fundingRatePerHour) / 1e16).toFixed(4)}%` : "—" },
  ];

  return (
    <section>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[6px] border border-[#CECECE] bg-white px-4 py-3">
        <ProfileDropdown
          accounts={marketRows.map((row) => ({
            id: row.id,
            name: row.id,
            email: row.best_ask_micro_per_mtok
              ? `${formatMicroPerMtok(BigInt(row.best_ask_micro_per_mtok))} USD / MTok`
              : "no asks yet",
            plan: `Perp · ${MAX_LEVERAGE.toString()}x`,
          }))}
          defaultAccountId={model}
          onAccountChange={(entry) => pick(entry.id)}
          info={{ label: "Available to trade", value: usdc !== null ? formatUsd(usdc) : "—" }}
          badge={`${MAX_LEVERAGE.toString()}x`}
        />

        <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-[11px] leading-4 text-[#757575]">{stat.label}</p>
              <p
                className={`text-[14px] font-semibold tabular-nums ${
                  stat.tone === "up" ? "text-[#2EBD85]" : stat.tone === "down" ? "text-[#F6465D]" : "text-[#1E1E1E]"
                }`}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-5 text-[14px]">
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

      {bookFailed ? (
        <p className="mt-2 text-[13px] text-[#F6465D]">
          {bookFailed === "unknown"
            ? `the venue does not know ${model} — pick another model above`
            : "the book feed is unreachable; retrying every 15 seconds"}
        </p>
      ) : null}

      <div className={`mt-5 grid gap-[17px] ${expanded ? "" : "lg:grid-cols-[minmax(0,1fr)_250px_290px]"}`}>
        <div className="flex flex-col self-start rounded-[6px] border border-[#CECECE] bg-white lg:h-[calc(100svh-277px)] lg:min-h-[423px]">
          <div className="flex items-center gap-5 border-b border-[#D9D9D9] px-4 py-2.5 text-[14px]">
            {(["Chart", "Funding"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setChartTab(item)}
                aria-pressed={chartTab === item}
                className={`${
                  chartTab === item
                    ? "font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                    : "text-[#757575] hover:text-[#1E1E1E]"
                }`}
              >
                {item}
              </button>
            ))}
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

          {chartTab === "Chart" ? (
            <>
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
                  {model} · spot fills
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
                      H <span className="tabular-nums text-[#1E1E1E]">{high?.toFixed(4)}</span>
                    </span>
                    <span>
                      L <span className="tabular-nums text-[#1E1E1E]">{low?.toFixed(4)}</span>
                    </span>
                    <span>
                      C <span className="tabular-nums text-[#1E1E1E]">{last?.toFixed(4)}</span>
                    </span>
                    {rangeDelta !== null ? (
                      <span className={`tabular-nums ${rangeDelta >= 0 ? "text-[#2EBD85]" : "text-[#F6465D]"}`}>
                        ({rangeDelta >= 0 ? "+" : ""}
                        {(rangeDelta * 100).toFixed(2)}%)
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>

              <FillsChart
                points={points}
                bucket={bucket}
                scale={scale}
                emptyNote="waiting for the first index post — the venue's fills seed the curve"
                className="h-[calc(100svh-380px)] min-h-[320px]"
              />
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <p className="text-[13px] text-[#1E1E1E]">[ funding on skew ]</p>
              <p className="mt-3 max-w-xl text-[14px] leading-5 text-[#1E1E1E]">
                Longs pay shorts when the book leans long, the other way when it leans short. The
                accrual lands on every modify and every liquidation, off the keeper&apos;s index — the
                same TWAP of venue fills you can recompute on /receipts.
              </p>
              <dl className="mt-5 rounded-[6px] border border-[#CECECE] bg-white px-4 py-3">
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
        </div>

        {!expanded && (
          <>
            <OrderBook book={book} model={model} listPrice={listPrice} />

            <div className="flex flex-col self-start rounded-[6px] border border-[#CECECE] bg-white lg:h-[calc(100svh-277px)] lg:min-h-[423px]">
              <div className="flex shrink-0 border-b border-[#D9D9D9]">
                {(["long", "short"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setSide(item)}
                    aria-pressed={side === item}
                    className={`w-1/2 py-2 text-[14px] font-semibold ${item === "short" ? "border-l border-[#CECECE]" : ""} ${
                      side === item ? "bg-black text-white" : "text-[#757575] hover:text-[#1E1E1E]"
                    }`}
                  >
                    {item === "long" ? "Long" : "Short"}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
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
                  <span className="flex items-center gap-2 rounded-[6px] border border-[#CECECE] bg-white px-2.5 focus-within:border-[#1743FF]">
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
                  <span className={`shrink-0 whitespace-nowrap text-right text-[12px] leading-4 tabular-nums ${MUTED}`}>
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
                    <dd className="tabular-nums text-[#1E1E1E]">{margin > 0n ? formatUsd(margin) : plan.length > 0 ? "none" : "—"}</dd>
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
                    className="h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4]"
                  >
                    Connect wallet
                  </button>
                ) : chainId !== galileo.id ? (
                  <button
                    type="button"
                    onClick={() => void switchChain({ chainId: galileo.id })}
                    className="h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E]"
                  >
                    Switch to 0G Galileo
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!wallet || pending || stale || plan.length === 0 || (usdc ?? 0n) < margin || gas === 0n}
                    onClick={() => {
                      if (!wallet) return;
                      void send(async () => {
                        let hash: Hash | null = null;
                        for (const leg of plan) {
                          if (hash && (await publicClient().waitForTransactionReceipt({ hash })).status !== "success") {
                            throw new Error("closing the position reverted; nothing was opened");
                          }
                          hash = await modify(wallet, model, leg.sizeDelta, leg.margin);
                        }
                        if (!hash) throw new Error("enter a size");
                        return hash;
                      });
                    }}
                    className="h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
                  >
                    {pending ? "Confirming…" : action}
                  </button>
                )}
                <p className={`text-center text-[13px] ${MUTED}`}>
                  {notice ??
                    (!address
                      ? "trades sign with your own wallet on 0G Galileo"
                      : stale
                        ? asks.length === 0
                          ? `no spot price for ${model} yet; trading opens once a seller lists it`
                          : "the index is stale; trading reopens after the keeper's next post"
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
                    className="flex h-[34px] w-full items-center justify-center rounded-[6px] border border-[#CECECE] bg-white text-[13px] text-[#1E1E1E] hover:border-[#1743FF] disabled:text-[#C9C9C9]"
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
          </>
        )}
      </div>

      <div className="mt-10 border-t border-[#CECECE] pt-8">
        <p className="text-[13px] text-[#1E1E1E]">[ positions ]</p>
        <h2 className="mt-3 font-serif text-[32px] leading-[1.1] text-[#1E1E1E]">
          Positions and trade history.
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
            {stripTab === "Positions" ? `${held.length} open` : `${history.length} trades`}
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
                  const value = notional(row.size, row.price);
                  const leverage = row.equity > 0n ? Number((value * 100n) / row.equity) / 100 : null;
                  const headroom = row.equity - (value + MAX_LEVERAGE - 1n) / MAX_LEVERAGE - 1n;
                  const settled = row.margin - row.fundingOwed;
                  const removable = headroom < settled ? headroom : settled;
                  const amount = parseUsd(marginInput);
                  return (
                    <div
                      key={row.model}
                      className="grid grid-cols-3 gap-y-1 border-t border-[#CECECE] py-3 text-[13px] tabular-nums text-[#1E1E1E] md:grid-cols-9"
                    >
                      <span className="pr-2">
                        {row.model}
                        {leverage !== null ? (
                          <span className="ml-1.5 rounded-[6px] border border-[#CECECE] bg-white px-1 text-[11px] text-[#1743FF]">
                            {leverage.toFixed(1)}x
                          </span>
                        ) : null}
                      </span>
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
                        {signedUsd(-row.fundingOwed)}
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(editing === row.model ? null : row.model);
                            setMarginInput("");
                          }}
                          aria-expanded={editing === row.model}
                          className="ml-2 underline"
                        >
                          margin
                        </button>
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
                      {editing === row.model ? (
                        <div className="col-span-3 flex flex-wrap items-center justify-end gap-3 pt-2 md:col-span-9">
                          <span className={MUTED}>
                            margin {formatUsd(row.margin)} · remove up to {formatUsd(removable > 0n ? removable : 0n)}
                          </span>
                          <input
                            value={marginInput}
                            onChange={(event) => setMarginInput(event.target.value)}
                            inputMode="decimal"
                            placeholder="USD"
                            aria-label={`USD of margin to add to or remove from ${row.model}`}
                            className="h-[28px] w-24 rounded-[6px] border border-[#CECECE] bg-white px-2 text-right outline-none focus:border-[#1743FF]"
                          />
                          <button
                            type="button"
                            disabled={!wallet || pending || !amount || (usdc ?? 0n) < amount}
                            onClick={() => {
                              if (wallet && amount) void send(() => modify(wallet, row.model, 0n, amount));
                            }}
                            className="underline disabled:text-[#C9C9C9]"
                          >
                            add
                          </button>
                          <button
                            type="button"
                            disabled={!wallet || pending || !amount || amount > removable}
                            onClick={() => {
                              if (wallet && amount) void send(() => modify(wallet, row.model, 0n, -amount));
                            }}
                            className="underline disabled:text-[#C9C9C9]"
                          >
                            remove
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </>
          ) : null}

          {stripTab === "Trade History" ? (
            <>
              <div className={`hidden border-y border-[#CECECE] py-2 text-[12px] md:grid md:grid-cols-6 ${MUTED}`}>
                {["Time, UTC", "Market", "Size", "Price", "Realized PNL", "Fee"].map((head, i) => (
                  <span key={head} className={i < 2 ? "pr-2" : "text-right"}>
                    {head}
                  </span>
                ))}
              </div>
              {history.length === 0 ? (
                <p className="border-t border-[#CECECE] py-5 text-[14px] text-[#757575] md:border-t-0">
                  {address
                    ? "No perp trades from this wallet yet. The keeper records each trade within a minute."
                    : "Connect a wallet to see its trades."}
                </p>
              ) : (
                <div className="max-h-[225px] overflow-y-auto">
                  {history.map((fill) => {
                    const change = BigInt(fill.size_change);
                    const pnl = BigInt(fill.realized_pnl_usd_micro);
                    const price = BigInt(fill.price_micro_per_mtok);
                    return (
                      <div
                        key={`${fill.tx_hash}:${fill.kind}`}
                        className="grid grid-cols-3 gap-y-1 border-t border-[#CECECE] py-3 text-[13px] tabular-nums text-[#1E1E1E] md:grid-cols-6"
                      >
                        <a
                          href={`${galileo.blockExplorers.default.url}/tx/${fill.tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`pr-2 hover:underline ${MUTED}`}
                        >
                          {stampFormat.format(new Date(fill.at))}
                        </a>
                        <span className="pr-2">
                          {fill.model}
                          {fill.kind === "liquidate" ? <span className="ml-1.5 text-[#F6465D]">liquidated</span> : null}
                        </span>
                        <span className={`text-right ${change > 0n ? "text-[#2EBD85]" : change < 0n ? "text-[#F6465D]" : ""}`}>
                          {change > 0n ? "+" : change < 0n ? "−" : ""}
                          {formatMtok(change < 0n ? -change : change)} MTok
                        </span>
                        <span className="text-right">{price > 0n ? formatMicroPerMtok(price) : "—"}</span>
                        <span className={`text-right ${pnl > 0n ? "text-[#2EBD85]" : pnl < 0n ? "text-[#F6465D]" : ""}`}>
                          {pnl === 0n ? "—" : signedUsd(pnl)}
                        </span>
                        <span className="text-right">
                          {fill.kind === "liquidate"
                            ? `reward ${formatUsd(BigInt(fill.reward_usd_micro))}`
                            : formatUsd(BigInt(fill.fee_usd_micro))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type Stat = { label: string; value: string; tone?: "up" | "down" | undefined };
