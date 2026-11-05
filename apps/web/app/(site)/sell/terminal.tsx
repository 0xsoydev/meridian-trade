"use client";

import { useEffect, useRef, useState } from "react";
import { charge, formatMicroPerMtok, parseUsd, sellerEarning } from "../../../lib/price";
import type { ModelRow } from "../../../lib/types";

const TAKE_BPS = 1000n;
const MUTED = "text-[#757575]";

const PRESETS = [
  { label: "1M", value: "1000000" },
  { label: "10M", value: "10000000" },
  { label: "100M", value: "100000000" },
];

const RAILS = [
  { id: "0g", label: "0G iAI", story: "daily credits reset at 00:00 UTC", market: true },
  { id: "anthropic", label: "Anthropic", story: "Console workspace, or Max / Team monthly credits", market: false },
  { id: "openai", label: "OpenAI", story: "project key with a budget", market: false },
  { id: "openrouter", label: "OpenRouter", story: "the gateway's own spend limit — the probe shows credits left", market: false },
  { id: "commandcode", label: "Command Code", story: "the gateway's own spend limit · OpenAI chat, max_completion_tokens", market: false },
  { id: "zen", label: "OpenCode Zen", story: "the gateway's own spend limit", market: false },
  { id: "opencode-go", label: "OpenCode Go", story: "the gateway's own spend limit", market: false },
] as const;

type RailId = (typeof RAILS)[number]["id"];

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

const usd = (micro: bigint) => `$${formatMicroPerMtok(micro)}`;

export function Sell({ privyReady }: { privyReady: boolean }) {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [rail, setRail] = useState<RailId>("0g");
  const [price, setPrice] = useState("");
  const [marketWanted, setMarketWanted] = useState(false);
  const [capacity, setCapacity] = useState("1000000");
  const [tab, setTab] = useState<"listings" | "payouts">("listings");
  const picker = useRef<HTMLDetailsElement | null>(null);

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

  const selected = models.find((row) => row.id === model) ?? models[0] ?? null;
  const railConfig = RAILS.find((item) => item.id === rail) ?? RAILS[0];
  const atMarket = marketWanted && railConfig.market;
  const typed = parseUsd(price);
  const blended = selected ? BigInt(selected.reference_blended_micro_per_mtok) : null;
  const marketAnchor = blended !== null ? (blended * 9n) / 10n : null;
  const priceMicro = atMarket ? marketAnchor : typed;
  const capacityMtok = parseTokens(capacity);
  const capacityTokens = capacityMtok * 1_000_000n;
  const notional =
    priceMicro !== null && priceMicro > 0n && capacityTokens > 0n ? charge(capacityTokens, priceMicro) : 0n;
  const earning = sellerEarning(notional, TAKE_BPS);
  const fee = notional - earning;

  const blocker = !privyReady
    ? "connect a wallet first — set NEXT_PUBLIC_PRIVY_APP_ID"
    : models.length === 0
      ? "waiting for the model list"
      : !atMarket && price.trim() !== "" && typed === null
        ? "that price is not a USD amount"
        : atMarket && marketAnchor === null
          ? "market price needs a listing reference for this model"
          : priceMicro === null || priceMicro === 0n
            ? "enter a price, or list at market on a daily rail"
            : capacityTokens === 0n
              ? "enter a capacity"
              : "listing is not live yet — waits on /api/listings";

  const pick = (id: string) => {
    setModel(id);
    if (picker.current) picker.current.open = false;
  };

  return (
    <section>
      <h1 className="font-serif text-[50px] leading-[1.05] text-[#1E1E1E]">
        Sell what <span className="text-[#A3A3A3]">expires</span>
      </h1>
      <p className="mt-4 max-w-[425px] text-[14px] leading-[18px] text-black">
        Credits expire; capacity does not have to. Prove one human once, attach a rail you already
        pay for, and list the MTokens you will not use. Ten percent keeps the venue running.
      </p>

      <div className="mt-6 border-t border-[#CECECE] pt-5">
        <p className="text-[13px] text-[#1E1E1E]">[ how selling works ]</p>
        <dl className="mt-3 flex flex-wrap gap-x-[26px] gap-y-3">
          {[
            ["fee", "10 percent of every fill"],
            ["payouts", "daily, 00:00 UTC"],
            ["credentials", "sealed AES-256-GCM, opened per request"],
            ["rule", "one human, one seller"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className={`text-[13px] ${MUTED}`}>{label}</dt>
              <dd className="text-[13px] text-[#1E1E1E]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-5 grid gap-[17px] lg:grid-cols-[1fr_300px]">
        <div className="border border-[#CECECE] bg-[#EBEBEB] p-4">
          <p className="text-[13px] text-[#1E1E1E]">[ seller gate ]</p>
          <h2 className="mt-2 font-serif text-[22px] leading-tight text-[#1E1E1E]">
            Prove first, then list.
          </h2>

          <ol className="mt-4 border-t border-[#D9D9D9]">
            <li className="flex items-baseline gap-3 border-b border-[#D9D9D9] py-4">
              <span className="font-serif text-[22px] leading-none text-[#A3A3A3]">1</span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[#1E1E1E]">Connect your wallet</p>
                <p className={`mt-1 text-[13px] leading-5 ${MUTED}`}>
                  Privy embedded or an external wallet. The address becomes the seller identity —
                  payouts land on it.
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-2 border border-[#CECECE] bg-white px-3 py-1.5 text-[13px] text-[#C9C9C9]"
                >
                  Connect wallet
                </button>
                <p className={`mt-1.5 text-[12px] ${MUTED}`}>
                  {privyReady
                    ? "Privy is configured; the provider mount lands with the seller API."
                    : "needs NEXT_PUBLIC_PRIVY_APP_ID before the provider can mount."}
                </p>
              </div>
            </li>

            <li className="flex items-baseline gap-3 border-b border-[#D9D9D9] py-4">
              <span className="font-serif text-[22px] leading-none text-[#A3A3A3]">2</span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[#1E1E1E]">Verify once with World ID</p>
                <p className={`mt-1 text-[13px] leading-5 ${MUTED}`}>
                  One proof, bound to that wallet. A duplicate nullifier comes back 409 — one human,
                  one seller.
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-2 border border-[#CECECE] bg-white px-3 py-1.5 text-[13px] text-[#C9C9C9]"
                >
                  Verify with World ID
                </button>
                <p className={`mt-1.5 text-[12px] ${MUTED}`}>
                  waits on /api/sellers/verify — the server check is written, the route is not.
                </p>
              </div>
            </li>

            <li className="flex items-baseline gap-3 border-b border-[#D9D9D9] py-4">
              <span className="font-serif text-[22px] leading-none text-[#A3A3A3]">3</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[#1E1E1E]">Pick your rail</p>
                <p className={`mt-1 text-[13px] leading-5 ${MUTED}`}>
                  The rail decides the capping story and whether listing at market is allowed.
                </p>
                <div className="mt-3">
                  {RAILS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setRail(item.id)}
                      aria-pressed={rail === item.id}
                      className={`flex w-full items-start justify-between gap-4 border-t border-[#D9D9D9] py-3 text-left ${
                        rail === item.id ? "text-[#1E1E1E]" : "text-[#757575] hover:text-[#1E1E1E]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex items-baseline gap-2">
                          <span className="text-[14px] font-semibold">{item.label}</span>
                          <span className="text-[12px] text-[#757575]">{item.id}</span>
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-5 text-[#757575]">
                          {item.story}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full ${
                          rail === item.id ? "bg-[#1743FF]" : "bg-[#C9C9C9]"
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <p className={`mt-3 text-[13px] leading-5 ${MUTED}`}>
                  OAuth rails — Claude Code and Codex — are flagged off. The endpoint probes the key
                  once, free of charge: a bad key never lists.
                </p>
              </div>
            </li>
          </ol>
        </div>
