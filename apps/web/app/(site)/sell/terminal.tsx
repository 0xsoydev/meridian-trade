"use client";

import { usePrivy } from "@privy-io/react-auth";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult } from "@worldcoin/idkit";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { z } from "zod";
import { charge, formatMicroPerMtok, formatMtok, formatUsd, parseMtok, parseUsd, sellerEarning } from "../../../lib/price";
import { CTA, CORNERS } from "../../../components/landing/hero";
import { useModels } from "../models";

const TAKE_BPS = 1000n;
const MUTED = "text-[#757575]";

const PRESETS = [
  { label: "10", value: "10" },
  { label: "100", value: "100" },
  { label: "1K", value: "1000" },
];

const RAILS = [
  { id: "0g", label: "iAI", story: "daily credits reset at 00:00 UTC", market: true, logo: "/images/rails/0g.svg", wide: true },
  { id: "anthropic", label: "Anthropic", story: "Console workspace key with a spend limit", market: false, logo: "/images/rails/anthropic.svg", wide: false },
  { id: "openai", label: "OpenAI", story: "project key with a budget", market: false, logo: "/images/rails/openai.svg", wide: false },
  { id: "openrouter", label: "OpenRouter", story: "the gateway's own spend limit — the probe shows credits left", market: false, logo: "/images/rails/openrouter.svg", wide: false },
  { id: "commandcode", label: "Command Code", story: "the gateway's own spend limit · OpenAI chat, max_completion_tokens", market: false, logo: "/images/rails/commandcode.svg", wide: false },
  { id: "zen", label: "OpenCode Zen", story: "the gateway's own spend limit", market: false, logo: "/images/rails/opencode.svg", wide: false },
  { id: "opencode-go", label: "OpenCode Go", story: "the gateway's own spend limit", market: false, logo: "/images/rails/opencode.svg", wide: false },
] as const;

type RailId = (typeof RAILS)[number]["id"];

const worldSchema = z.object({
  sig: z.string(),
  nonce: z.string(),
  created_at: z.number(),
  expires_at: z.number(),
  rp_id: z.string(),
  app_id: z.custom<`app_${string}`>((value) => typeof value === "string" && value.startsWith("app_")),
  environment: z.enum(["production", "staging", "sandbox"]),
  action: z.string(),
});
const listedSchema = z.object({ listing_id: z.string() });
const failureSchema = z.object({ error: z.object({ message: z.string() }) });
const mineSchema = z.object({
  listings: z.array(
    z.object({
      listing_id: z.string(),
      rail: z.string(),
      model: z.string(),
      price_micro_per_mtok: z.string().nullable(),
      capacity_tokens: z.string(),
      used_tokens: z.string(),
      reserved_tokens: z.string(),
      status: z.string(),
    }),
  ),
});
const payoutsSchema = z.object({
  network: z.string(),
  unpaid_usd_micro: z.string(),
  data: z.array(
    z.object({ day: z.string(), amount_usd_micro: z.string(), schedule_id: z.string().nullable(), status: z.string() }),
  ),
});
const WORLD_BYPASS = process.env.NEXT_PUBLIC_WORLD_BYPASS === "true" && process.env.NODE_ENV !== "production";

type Envelope = { address: string; message: string; signature: string };

export function Sell() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  const [world, setWorld] = useState<z.infer<typeof worldSchema> | null>(null);
  const [worldOpen, setWorldOpen] = useState(false);
  const [sellerEnvelope, setSellerEnvelope] = useState<Envelope | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const [credential, setCredential] = useState("");
  const [listed, setListed] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const models = useModels();
  const [model, setModel] = useState<string | null>(null);
  const [rail, setRail] = useState<RailId>("0g");
  const [price, setPrice] = useState("");
  const [marketWanted, setMarketWanted] = useState(false);
  const [capacity, setCapacity] = useState("100");
  const [tab, setTab] = useState<"listings" | "payouts">("listings");
  const [mine, setMine] = useState<z.infer<typeof mineSchema>["listings"]>([]);
  const [paid, setPaid] = useState<z.infer<typeof payoutsSchema> | null>(null);
  const [useStored, setUseStored] = useState(true);
  const picker = useRef<HTMLDetailsElement | null>(null);
  const railPicker = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!address) {
      setMine([]);
      setPaid(null);
      return;
    }
    let alive = true;
    const json = (url: string) =>
      fetch(url, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    void Promise.all([json(`/api/listings?seller=${address}`), json(`/api/v1/payouts?seller=${address}`)]).then(([listings, payouts]) => {
      if (!alive) return;
      setMine(mineSchema.safeParse(listings).data?.listings ?? []);
      setPaid(payoutsSchema.safeParse(payouts).data ?? null);
    });
    return () => {
      alive = false;
    };
  }, [address, listed, verified]);

  const railModels = models.filter((row) => row.rails.includes(rail));
  const selected = railModels.find((row) => row.id === model) ?? railModels[0] ?? null;
  const railConfig = RAILS.find((item) => item.id === rail) ?? RAILS[0];
  const atMarket = marketWanted && railConfig.market;
  const typed = parseUsd(price);
  const blended = selected ? BigInt(selected.reference_blended_micro_per_mtok) : null;
  const marketAnchor = blended !== null ? (blended * 9n) / 10n : null;
  const priceMicro = atMarket ? marketAnchor : typed;
  const capacityTokens = parseMtok(capacity);
  const notional =
    priceMicro !== null && priceMicro > 0n && capacityTokens > 0n ? charge(capacityTokens, priceMicro) : 0n;
  const earning = sellerEarning(notional, TAKE_BPS);
  const fee = notional - earning;
  const stored = mine.find((row) => row.rail === rail && row.status !== "invalid" && row.status !== "pending_auth") ?? null;
  const usingStored = useStored && stored !== null;

  const blocker =
    !authenticated || !address
      ? "connect a wallet first"
      : models.length === 0
        ? "waiting for the model list"
        : railModels.length === 0
          ? "this rail lists no priced models right now"
        : !atMarket && price.trim() !== "" && typed === null
          ? "that price is not a USD amount"
          : atMarket && marketAnchor === null
            ? "market price needs a listing reference for this model"
            : priceMicro === null || priceMicro === 0n
              ? "enter a price, or list at market on a daily rail"
              : !/^\d+$/.test(capacity.trim()) || capacityTokens === 0n
                ? "enter a whole number of MTokens"
                : credential.trim() === "" && !usingStored
                  ? "paste the rail's API key"
                  : null;

  const keyHint = (() => {
    const value = credential.trim();
    const prefixes: Record<RailId, string | null> = {
      "0g": "sk-",
      anthropic: "sk-ant-",
      openai: "sk-",
      openrouter: "sk-or-",
      commandcode: null,
      zen: null,
      "opencode-go": null,
    };
    const prefix = prefixes[rail];
    if (value === "") {
      return { ok: false, text: prefix ? `expected a key starting with ${prefix}…` : "the rail's API key" };
    }
    if (prefix !== null && !value.startsWith(prefix)) {
      return { ok: false, text: `that doesn't look like a ${railConfig.label} key — ${prefix}… expected` };
    }
    return { ok: true, text: `✓ looks like a ${railConfig.label} key` };
  })();

  const signal = (address ?? "").toLowerCase();
  const preset = useMemo(() => proofOfHuman({ signal }), [signal]);

  const sign = async (fields: Record<string, string | null>): Promise<Envelope> => {
    if (!address) throw new Error("connect a wallet first");
    const message = JSON.stringify({ domain: window.location.host, issued_at: new Date().toISOString(), ...fields });
    return { address, message, signature: await signMessage({ message }) };
  };

  const startVerify = async () => {
    setFailure(null);
    try {
      const envelope = await sign({ action: "seller" });
      if (WORLD_BYPASS) {
        await submitSeller(envelope, {});
        return;
      }
      const res = await fetch("/api/sellers/rp-signature", { method: "POST" });
      const config = worldSchema.safeParse(await res.json().catch(() => null));
      if (!res.ok || !config.success) throw new Error("World ID is not configured on the server");
      setSellerEnvelope(envelope);
      setWorld(config.data);
      setWorldOpen(true);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "could not start World ID");
    }
  };

  const submitSeller = async (signed: Envelope | null, idkit: unknown): Promise<void> => {
    const res = await fetch("/api/sellers/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, signed, idkit }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) {
      setVerified(WORLD_BYPASS ? "verified with the test bypass, no World App" : "verified: one human, one seller");
      return;
    }
    if (res.status === 409) {
      setVerified("this human is already a seller");
      return;
    }
    throw new Error(failureSchema.safeParse(body).data?.error.message ?? `verification failed (${res.status})`);
  };

  const list = async () => {
    if (blocker !== null || busy || !selected) return;
    setBusy(true);
    setFailure(null);
    setListed(null);
    try {
      const signed = await sign({
        action: "list",
        rail,
        model: selected.id,
        capacity_mtok: capacity.trim(),
        price_micro_per_mtok: atMarket ? null : (priceMicro?.toString() ?? null),
        client_nonce: crypto.randomUUID(),
      });
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signed,
          credential: usingStored && stored ? { kind: "stored", listing_id: stored.listing_id } : { kind: "key", key: credential.trim() },
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      const created = listedSchema.safeParse(body);
      if (!res.ok || !created.success) {
        throw new Error(failureSchema.safeParse(body).data?.error.message ?? `listing failed (${res.status})`);
      }
      setListed(created.data.listing_id);
      setCredential("");
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "listing failed");
    } finally {
      setBusy(false);
    }
  };

  const pick = (id: string) => {
    setModel(id);
    if (picker.current) picker.current.open = false;
  };

  return (
    <section className="relative lg:px-6">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden w-px bg-[#CECECE] lg:block" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-px bg-[#CECECE] lg:block" />
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-[#D9D9D9] pb-4">
        <Stat label="Fee" value="10 percent of every fill" />
        <Stat label="Payouts" value="daily, paid at 01:00 UTC" />
        <Stat label="Credentials" value="sealed AES-256-GCM, opened per request" />
        <Stat label="Rule" value="one human, one seller" />
      </div>

      <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_400px]">
        <div>
          <div className="flex items-center gap-5 border-b border-[#D9D9D9] pb-2.5 text-[14px]">
            <span className="font-semibold text-[#1E1E1E]">Seller gate</span>
            <span className={MUTED}>prove first, then list</span>
          </div>

          <ol>
            <li className="flex items-baseline gap-3 border-b border-[#D9D9D9] py-6 last:border-b-0">
              <span className="font-serif text-[22px] leading-none text-[#A3A3A3]">1</span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[#1E1E1E]">Connect your wallet</p>
                <p className={`mt-1 text-[13px] leading-5 ${MUTED}`}>
                  Privy embedded or an external wallet. The address becomes the seller identity —
                  payouts land on it.
                </p>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => {
                    if (authenticated) void logout();
                    else login();
                  }}
                  className={`${CTA} relative mt-2 inline-flex h-[46px] items-center px-9 disabled:bg-[#D4D4D4] disabled:text-white`}
                >
                  {CORNERS.map((corner) => (
                    <span key={corner} aria-hidden className={corner} />
                  ))}
                  <span className="text-[16px] text-white">
                    {authenticated && address ? "Disconnect" : "Connect wallet"}
                  </span>
                </button>
                <p className={`mt-1.5 text-[12px] leading-5 ${MUTED}`}>
                  {authenticated && address ? (
                    <>
                      seller identity{" "}
                      <span className="tabular-nums text-[#1E1E1E] break-all">{address}</span>
                    </>
                  ) : (
                    "email gets an embedded wallet; any EVM wallet works"
                  )}
                </p>
              </div>
            </li>

            <li className="flex items-baseline gap-3 border-b border-[#D9D9D9] py-6 last:border-b-0">
              <span className="font-serif text-[22px] leading-none text-[#A3A3A3]">2</span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[#1E1E1E]">Verify once with World ID</p>
                <p className={`mt-1 text-[13px] leading-5 ${MUTED}`}>
                  One proof, bound to that wallet. A duplicate nullifier comes back 409 — one human,
                  one seller.
                </p>
                <button
                  type="button"
                  disabled={!address || verified !== null}
                  onClick={() => void startVerify()}
                  className={`${CTA} relative mt-2 inline-flex h-[46px] items-center px-9 disabled:bg-[#D4D4D4] disabled:text-white`}
                >
                  {CORNERS.map((corner) => (
                    <span key={corner} aria-hidden className={corner} />
                  ))}
                  <span className="text-[16px] text-white">
                    {verified ? "Verified" : "Verify with World ID"}
                  </span>
                </button>
                <p className={`mt-1.5 text-[12px] ${MUTED}`}>
                  {verified ??
                    (address
                      ? WORLD_BYPASS
                        ? "test bypass on: no World App needed"
                        : "World App · Proof of Human, bound to this wallet"
                      : "connect a wallet first")}
                </p>
                {world ? (
                  <IDKitRequestWidget
                    open={worldOpen}
                    onOpenChange={setWorldOpen}
                    app_id={world.app_id}
                    action={world.action}
                    environment={world.environment}
                    rp_context={{
                      rp_id: world.rp_id,
                      nonce: world.nonce,
                      created_at: world.created_at,
                      expires_at: world.expires_at,
                      signature: world.sig,
                    }}
                    allow_legacy_proofs
                    preset={preset}
                    handleVerify={(result: IDKitResult) => submitSeller(sellerEnvelope, result)}
                    onSuccess={() => setWorldOpen(false)}
                    onError={(code) => setFailure(String(code))}
                  />
                ) : null}
              </div>
            </li>

            <li id="gate-rail" className="flex items-baseline gap-3 border-b border-[#D9D9D9] py-6 last:border-b-0">
              <span className="font-serif text-[22px] leading-none text-[#A3A3A3]">3</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[#1E1E1E]">Pick your rail</p>
                <p className={`mt-1 text-[13px] leading-5 ${MUTED}`}>
                  The rail decides the capping story and whether listing at market is allowed.
                </p>
                <div className="mt-3 flex flex-wrap gap-4">
                  {RAILS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setRail(item.id)}
                      aria-pressed={rail === item.id}
                      title={item.story}
                      className={`group relative inline-flex h-[46px] items-center justify-center gap-2.5 px-6 text-[16px] font-semibold transition-transform duration-200 hover:scale-[0.98] ${
                        rail === item.id
                          ? "bg-black text-white"
                          : "rounded-[6px] border border-[#CECECE] bg-white text-[#757575] hover:border-[#1743FF] hover:text-[#1E1E1E]"
                      }`}
                    >
                      {CORNERS.map((corner) => (
                        <span
                          key={corner}
                          aria-hidden
                          className={`${corner} opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100`}
                          style={{ transitionProperty: "opacity, transform" }}
                        />
                      ))}
                      {item.logo ? (
                        <span
                          aria-hidden
                          className={`shrink-0 bg-current ${item.wide ? "h-[18px] w-[38px]" : "h-[18px] w-[18px]"}`}
                          style={{
                            maskImage: `url(${item.logo})`,
                            maskSize: "contain",
                            maskRepeat: "no-repeat",
                            maskPosition: "center",
                            WebkitMaskImage: `url(${item.logo})`,
                            WebkitMaskSize: "contain",
                            WebkitMaskRepeat: "no-repeat",
                            WebkitMaskPosition: "center",
                          }}
                        />
                      ) : null}
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className={`mt-2 text-[13px] leading-5 ${MUTED}`}>{railConfig.story}</p>
                <p className={`mt-3 text-[13px] leading-5 ${MUTED}`}>
                  OAuth rails — Claude Code and Codex — are flagged off. The key is checked once against
                  the model you list, through the provider&apos;s model list or, on Command Code, a 1-token
                  request: a bad key, or one without that model, never lists.
                </p>
              </div>
            </li>
          </ol>
        </div>

        <div className="flex flex-col self-start">
          <div className="flex items-center justify-between gap-4 border-b border-[#D9D9D9] pb-2.5 text-[14px]">
            <span className="font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4">
              List
            </span>
            <Link href="/trade#orders" className="text-[#1743FF] hover:underline">
              Amend →
            </Link>
          </div>

          <div className="space-y-6 pt-4">
            <div>
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Model</span>
              <details ref={picker} className="relative">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[6px] border border-[#CECECE] bg-white px-2.5 py-2 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-[#1E1E1E]">
                      {selected?.id ?? "loading models…"}
                    </span>
                    <span className="block text-[12px] text-[#757575]">
                      {blended !== null ? `ref ${formatMicroPerMtok(blended)} USD / MTok` : "no reference yet"}
                    </span>
                  </span>
                  <span aria-hidden className="text-[#757575]">⌄</span>
                </summary>
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-[6px] border border-[#CECECE] bg-white py-1">
                  {railModels.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => pick(row.id)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-[#F5F5F5] ${
                          row.id === selected?.id ? "text-[#1E1E1E]" : "text-[#757575]"
                        }`}
                      >
                        <span className="truncate">{row.id}</span>
                        <span className="shrink-0 tabular-nums text-[12px] text-[#757575]">
                          ref {formatMicroPerMtok(BigInt(row.reference_blended_micro_per_mtok))}
                        </span>
                      </button>
                    </li>
                  ))}
                  {models.length === 0 ? (
                    <li className="px-3 py-2 text-[13px] text-[#757575]">loading models…</li>
                  ) : railModels.length === 0 ? (
                    <li className="px-3 py-2 text-[13px] text-[#757575]">this rail lists no priced models right now</li>
                  ) : null}
                </ul>
              </details>
            </div>

            <div className="flex items-baseline justify-between text-[14px]">
              <span className={MUTED}>Rail</span>
              <span className="flex items-baseline gap-3">
                <span className="tabular-nums text-[#1E1E1E]">
                  {railConfig.label} · {railConfig.id}
                </span>
                <details ref={railPicker} className="relative">
                  <summary className="cursor-pointer list-none text-[13px] text-[#1743FF] hover:underline [&::-webkit-details-marker]:hidden">
                    change
                  </summary>
                  <ul className="absolute right-0 top-full z-20 mt-1 w-52 rounded-[6px] border border-[#CECECE] bg-white py-1">
                    {RAILS.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setRail(item.id);
                            if (railPicker.current) railPicker.current.open = false;
                          }}
                          className={`w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#F5F5F5] ${
                            item.id === rail ? "text-[#1E1E1E]" : "text-[#757575]"
                          }`}
                        >
                          {item.label} · {item.id}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              </span>
            </div>

            <div>
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Price, USD / MTok</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMarketWanted(false)}
                  aria-pressed={!atMarket}
                  className={`h-[34px] flex-1 text-[13px] font-semibold ${
                    atMarket
                      ? "rounded-[6px] border border-[#CECECE] bg-white text-[#757575] hover:text-[#1E1E1E]"
                      : "bg-black text-white"
                  }`}
                >
                  Fixed price
                </button>
                <button
                  type="button"
                  onClick={() => setMarketWanted(true)}
                  disabled={!railConfig.market}
                  aria-pressed={atMarket}
                  title={railConfig.market ? "90% of the blended reference" : "daily rails only"}
                  className={`h-[34px] flex-1 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                    atMarket
                      ? "bg-black text-white"
                      : "rounded-[6px] border border-[#CECECE] bg-white text-[#757575] hover:text-[#1E1E1E]"
                  }`}
                >
                  Market · 90%
                </button>
              </div>
            </div>

            <input
              value={atMarket ? "" : price}
              onChange={(event) => setPrice(event.target.value)}
              disabled={atMarket}
              inputMode="decimal"
              placeholder={blended !== null ? formatMicroPerMtok(blended) : "0.00"}
              aria-label="price in USD per MTok"
              className="h-[34px] w-full rounded-[6px] border border-[#CECECE] bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF] disabled:text-[#C9C9C9]"
            />

            <p className={`text-[13px] leading-5 ${MUTED}`}>
              {atMarket && marketAnchor !== null
                ? `you'll list at ${formatMicroPerMtok(marketAnchor)} USD / MTok — 90% of ${formatMicroPerMtok(blended ?? 0n)}`
                : blended !== null
                  ? `reference ${formatMicroPerMtok(blended)} USD / MTok`
                  : "no reference price for this model yet"}
            </p>

            {!atMarket && price.trim() !== "" && typed === null ? (
              <p className="text-[13px] leading-5 text-[#F6465D]">That price is not a USD amount.</p>
            ) : null}

            <label className="block">
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Capacity, in MTokens</span>
              <span className="flex items-center gap-2 rounded-[6px] border border-[#CECECE] bg-white px-2.5 focus-within:border-[#1743FF]">
                <input
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  inputMode="numeric"
                  placeholder="1000000"
                  className="h-[34px] w-full bg-transparent text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9]"
                />
                <span className={`text-[12px] ${MUTED}`}>MTok</span>
              </span>
            </label>

            <div className="flex gap-5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setCapacity(preset.value)}
                  className={`text-[14px] ${
                    capacity === preset.value
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
                <dt className={MUTED}>Sell value</dt>
                <dd className="tabular-nums text-[#1E1E1E]">{notional > 0n ? formatUsd(notional) : "—"}</dd>
              </div>
              <div className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                <dt className={MUTED}>Venue keeps, 10 percent</dt>
                <dd className="tabular-nums text-[#1E1E1E]">{fee > 0n ? formatUsd(fee) : "—"}</dd>
              </div>
              <div className="flex justify-between py-3">
                <dt className="text-[15px] font-semibold text-[#1E1E1E]">You receive</dt>
                <dd className="text-[18px] font-semibold tabular-nums text-[#1743FF]">
                  {earning > 0n ? formatUsd(earning) : "—"}
                </dd>
              </div>
            </dl>

            <p className={`text-[13px] leading-5 ${MUTED}`}>
              capacity {formatMtok(capacityTokens)} MTok · paid daily at 01:00 UTC
            </p>

            {stored ? (
              <label className="flex items-center gap-2 text-[14px] text-[#1E1E1E]">
                <input
                  type="checkbox"
                  checked={useStored}
                  onChange={(event) => setUseStored(event.target.checked)}
                  className="accent-[#1743FF]"
                />
                Use the {railConfig.label} key you already stored
              </label>
            ) : null}

            {usingStored ? null : (
              <label className="block">
                <span className={`mb-1 block text-[13px] ${MUTED}`}>Rail API key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={credential}
                  onChange={(event) => setCredential(event.target.value)}
                  placeholder={rail === "0g" ? "sk-… from pc.testnet.0g.ai" : "the rail's API key"}
                  className="h-[34px] w-full rounded-[6px] border border-[#CECECE] bg-white px-2.5 text-[14px] text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF]"
                />
                <span
                  className={`mt-1 block text-[12px] leading-4 ${keyHint.ok ? "text-[#2EBD85]" : MUTED}`}
                >
                  {keyHint.text}
                </span>
                <span className={`mt-0.5 block text-[12px] leading-4 ${MUTED}`}>
                  probed once, then sealed with AES-256-GCM — it never leaves the server
                </span>
              </label>
            )}

            <button
              type="button"
              disabled={blocker !== null || busy}
              onClick={() => void list()}
              className="h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
            >
              {busy ? "Probing the key…" : "List capacity"}
            </button>
            <p className={`text-center text-[13px] leading-5 ${MUTED}`}>
              {failure ?? (listed ? `listed ${listed.slice(0, 8)}…, live in the book` : (blocker ?? "the key is probed once, then sealed"))}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center gap-5 border-b border-[#D9D9D9] pb-2.5 text-[14px]">
          {(["listings", "payouts"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              aria-pressed={tab === item}
              className={`${
                tab === item
                  ? "font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                  : "text-[#757575] hover:text-[#1E1E1E]"
              }`}
            >
              {item}
            </button>
          ))}
          <span className={`ml-auto text-[13px] ${MUTED}`}>
            {tab === "listings"
              ? `${mine.length} listed`
              : `${formatUsd(BigInt(paid?.unpaid_usd_micro ?? "0"))} earned and unpaid · paid daily, 01:00 UTC`}
          </span>
        </div>

        {tab === "listings" ? (
          <>
            <div className={`hidden gap-x-3 py-1.5 text-[11px] md:grid md:grid-cols-5 ${MUTED}`}>
              {["Market", "Rail", "Price", "Left", "Status"].map((head, i) => (
                <span key={head} className={i === 0 ? "pr-2" : "text-right"}>
                  {head}
                </span>
              ))}
            </div>
            {mine.length === 0 ? (
              <p className="border-t border-[#D9D9D9] py-5 text-[13px] text-[#757575] md:border-t-0">
                {address ? "Nothing listed for this seller yet." : "Connect the seller wallet to see its listings."}
              </p>
            ) : (
              mine.map((row) => {
                const total = BigInt(row.capacity_tokens);
                const left = total - BigInt(row.used_tokens) - BigInt(row.reserved_tokens);
                return (
                  <div
                    key={row.listing_id}
                    className="grid grid-cols-3 gap-x-3 gap-y-1 border-t border-[#D9D9D9] py-2.5 text-[13px] tabular-nums text-[#1E1E1E] md:grid-cols-5"
                  >
                    <span className="pr-2">{row.model}</span>
                    <span className="text-right">{row.rail}</span>
                    <span className="text-right">
                      {row.price_micro_per_mtok === null ? "market" : formatMicroPerMtok(BigInt(row.price_micro_per_mtok))}
                    </span>
                    <span className="text-right">
                      {formatMtok(left)} of {formatMtok(total)} MTok
                    </span>
                    <span className={`text-right ${row.status === "active" ? "text-[#2EBD85]" : MUTED}`}>{row.status}</span>
                  </div>
                );
              })
            )}
            {mine.length > 0 ? (
              <p className={`border-t border-[#D9D9D9] py-2 text-[12px] ${MUTED}`}>
                Amend or cancel an ask under Open Orders on{" "}
                <Link href="/trade" className="text-[#1743FF] hover:underline">
                  Trade
                </Link>
                .
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className={`hidden gap-x-3 py-1.5 text-[11px] md:grid md:grid-cols-4 ${MUTED}`}>
              {["Day", "Amount", "Schedule", "Status"].map((head, i) => (
                <span key={head} className={i === 0 ? "pr-2" : "text-right"}>
                  {head}
                </span>
              ))}
            </div>
            {!paid || paid.data.length === 0 ? (
              <p className="border-t border-[#D9D9D9] py-5 text-[13px] text-[#757575] md:border-t-0">
                No payouts yet. The keeper closes the day at 00:00 UTC; schedules land by 01:00.
              </p>
            ) : (
              paid.data.map((row) => (
                <div
                  key={row.day}
                  className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[#D9D9D9] py-2.5 text-[13px] tabular-nums text-[#1E1E1E] md:grid-cols-4"
                >
                  <span className="pr-2">{row.day}</span>
                  <span className="text-right">{formatUsd(BigInt(row.amount_usd_micro))}</span>
                  <span className="text-right">
                    {row.schedule_id ? (
                      <a
                        href={`https://hashscan.io/${paid.network}/schedule/${row.schedule_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#1743FF] hover:underline"
                      >
                        {row.schedule_id}
                      </a>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span className={`text-right ${row.status === "executed" ? "text-[#2EBD85]" : MUTED}`}>{row.status}</span>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] leading-4 text-[#757575]">{label}</p>
      <p className="text-[14px] font-semibold text-[#1E1E1E]">{value}</p>
    </div>
  );
}
