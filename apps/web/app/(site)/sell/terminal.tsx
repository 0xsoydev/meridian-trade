"use client";

import { usePrivy } from "@privy-io/react-auth";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult } from "@worldcoin/idkit";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { z } from "zod";
import { charge, formatMicroPerMtok, formatMtok, formatUsd, parseMtok, parseUsd, sellerEarning } from "../../../lib/price";
import type { ModelRow } from "../../../lib/types";

const TAKE_BPS = 1000n;
const MUTED = "text-[#757575]";

const PRESETS = [
  { label: "10", value: "10" },
  { label: "100", value: "100" },
  { label: "1K", value: "1000" },
];

const RAILS = [
  { id: "0g", label: "0G iAI", story: "daily credits reset at 00:00 UTC", market: true },
  { id: "anthropic", label: "Anthropic", story: "Console workspace key with a spend limit", market: false },
  { id: "openai", label: "OpenAI", story: "project key with a budget", market: false },
  { id: "openrouter", label: "OpenRouter", story: "the gateway's own spend limit — the probe shows credits left", market: false },
  { id: "commandcode", label: "Command Code", story: "the gateway's own spend limit · OpenAI chat, max_completion_tokens", market: false },
  { id: "zen", label: "OpenCode Zen", story: "the gateway's own spend limit", market: false },
  { id: "opencode-go", label: "OpenCode Go", story: "the gateway's own spend limit", market: false },
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
  const [models, setModels] = useState<ModelRow[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [rail, setRail] = useState<RailId>("0g");
  const [price, setPrice] = useState("");
  const [marketWanted, setMarketWanted] = useState(false);
  const [capacity, setCapacity] = useState("100");
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
  const capacityTokens = parseMtok(capacity);
  const notional =
    priceMicro !== null && priceMicro > 0n && capacityTokens > 0n ? charge(capacityTokens, priceMicro) : 0n;
  const earning = sellerEarning(notional, TAKE_BPS);
  const fee = notional - earning;

  const blocker =
    !authenticated || !address
      ? "connect a wallet first"
      : models.length === 0
        ? "waiting for the model list"
        : !atMarket && price.trim() !== "" && typed === null
          ? "that price is not a USD amount"
          : atMarket && marketAnchor === null
            ? "market price needs a listing reference for this model"
            : priceMicro === null || priceMicro === 0n
              ? "enter a price, or list at market on a daily rail"
              : !/^\d+$/.test(capacity.trim()) || capacityTokens === 0n
                ? "enter a whole number of MTokens"
                : credential.trim() === ""
                  ? "paste the rail's API key"
                  : null;

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
        body: JSON.stringify({ signed, credential: { kind: "key", key: credential.trim() } }),
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
            ["payouts", "daily, paid at 01:00 UTC"],
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
                  disabled={!ready}
                  onClick={() => {
                    if (authenticated) void logout();
                    else login();
                  }}
                  className="mt-2 border border-[#CECECE] bg-white px-3 py-1.5 text-[13px] text-[#1E1E1E] hover:border-[#1743FF] disabled:text-[#C9C9C9]"
                >
                  {authenticated && address ? `${address.slice(0, 6)}…${address.slice(-4)} · disconnect` : "Connect wallet"}
                </button>
                <p className={`mt-1.5 text-[12px] ${MUTED}`}>
                  {authenticated && address
                    ? "this address is your seller identity"
                    : "email gets an embedded wallet; any EVM wallet works"}
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
                  disabled={!address || verified !== null}
                  onClick={() => void startVerify()}
                  className="mt-2 border border-[#CECECE] bg-white px-3 py-1.5 text-[13px] text-[#1E1E1E] hover:border-[#1743FF] disabled:text-[#C9C9C9]"
                >
                  {verified ? "Verified" : WORLD_BYPASS ? "Verify with World ID (test bypass)" : "Verify with World ID"}
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

        <div className="border border-[#CECECE] bg-[#EBEBEB] p-4">
          <div className="flex border border-[#CECECE] bg-white">
            <button
              type="button"
              aria-pressed
              className="w-1/2 bg-black py-2 text-[14px] font-semibold text-white"
            >
              List
            </button>
            <button
              type="button"
              disabled
              title="amend lands with the listings API"
              className="w-1/2 border-l border-[#CECECE] py-2 text-[14px] font-semibold text-[#C9C9C9]"
            >
              Amend
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Model</span>
              <details ref={picker} className="relative">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 border border-[#CECECE] bg-white px-2.5 py-2 [&::-webkit-details-marker]:hidden">
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
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto border border-[#CECECE] bg-white py-1">
                  {models.map((row) => (
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
                  ) : null}
                </ul>
              </details>
            </div>

            <div className="flex justify-between text-[14px]">
              <span className={MUTED}>Rail</span>
              <span className="tabular-nums text-[#1E1E1E]">
                {railConfig.label} · {railConfig.id}
              </span>
            </div>

            <label className="block">
              <span className={`mb-1 flex items-baseline justify-between gap-2 text-[13px] ${MUTED}`}>
                <span>Price, USD / MTok</span>
                {railConfig.market ? <span className="text-[12px] text-[#1743FF]">market allowed</span> : null}
              </span>
              <input
                value={atMarket ? "" : price}
                onChange={(event) => setPrice(event.target.value)}
                disabled={atMarket}
                inputMode="decimal"
                placeholder={blended !== null ? formatMicroPerMtok(blended) : "0.00"}
                className="h-[34px] w-full border border-[#CECECE] bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF] disabled:text-[#C9C9C9]"
              />
            </label>

            <label className="flex items-start gap-2 text-[13px] leading-5">
              <input
                type="checkbox"
                checked={atMarket}
                disabled={!railConfig.market}
                onChange={(event) => setMarketWanted(event.target.checked)}
                className="mt-1 accent-[#1743FF] disabled:opacity-40"
              />
              <span className={railConfig.market ? "text-[#1E1E1E]" : "text-[#C9C9C9]"}>
                list at market — 90% of the blended reference
                {!railConfig.market ? " (daily rails only)" : ""}
              </span>
            </label>

            {!atMarket && price.trim() !== "" && typed === null ? (
              <p className="text-[13px] leading-5 text-[#F6465D]">That price is not a USD amount.</p>
            ) : null}

            <label className="block">
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Capacity, in MTokens</span>
              <span className="flex items-center gap-2 border border-[#CECECE] bg-white px-2.5 focus-within:border-[#1743FF]">
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
                <dd className="text-[16px] font-semibold tabular-nums text-[#1E1E1E]">
                  {earning > 0n ? formatUsd(earning) : "—"}
                </dd>
              </div>
            </dl>

            <p className={`text-[13px] leading-5 ${MUTED}`}>
              {atMarket && marketAnchor !== null
                ? `at market: ${formatMicroPerMtok(marketAnchor)} USD / MTok, 90% of the ${formatMicroPerMtok(blended ?? 0n)} reference`
                : `capacity ${formatMtok(capacityTokens)} MTok · paid daily at 01:00 UTC`}
            </p>

            <label className="block">
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Rail API key</span>
              <input
                type="password"
                autoComplete="off"
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                placeholder={rail === "0g" ? "sk-… from pc.testnet.0g.ai" : "the rail's API key"}
                className="h-[34px] w-full border border-[#CECECE] bg-white px-2.5 text-[14px] text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF]"
              />
            </label>

            <button
              type="button"
              disabled={blocker !== null || busy}
              onClick={() => void list()}
              className="h-[34px] w-full bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
            >
              {busy ? "Probing the key…" : "List capacity"}
            </button>
            <p className={`text-center text-[13px] leading-5 ${MUTED}`}>
              {failure ?? (listed ? `listed ${listed.slice(0, 8)}…, live in the book` : (blocker ?? "the key is probed once, then sealed"))}
            </p>

            <div className="border border-[#CECECE] bg-white px-3 py-3">
              <p className="text-[14px] text-[#1E1E1E]">Your key never leaves the server.</p>
              <p className="mt-1 text-[13px] leading-5 text-[#757575]">
                It is probed once, then sealed with AES-256-GCM and opened only inside the request
                that uses it.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 border-t border-[#CECECE] pt-8">
        <p className="text-[13px] text-[#1E1E1E]">[ your listings ]</p>
        <h2 className="mt-3 font-serif text-[32px] leading-[1.1] text-[#1E1E1E]">
          Capacity, on the record.
        </h2>

        <div className="mt-4 flex items-center gap-5">
          {(["listings", "payouts"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              aria-pressed={tab === item}
              className={`text-[14px] ${
                tab === item
                  ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                  : "text-[#757575] hover:text-[#1E1E1E]"
              }`}
            >
              {item}
            </button>
          ))}
          <span className={`text-[13px] ${MUTED}`}>
            {tab === "listings" ? "0 listed" : "paid daily, 01:00 UTC"}
          </span>
        </div>

        <div className="mt-4">
          {tab === "listings" ? (
            <>
              <div className={`hidden border-y border-[#CECECE] py-2 text-[12px] md:grid md:grid-cols-5 ${MUTED}`}>
                {["Market", "Rail", "Price", "Left", "Status"].map((head, i) => (
                  <span key={head} className={i === 0 ? "pr-2" : "text-right"}>
                    {head}
                  </span>
                ))}
              </div>
              <p className="border-t border-[#CECECE] py-5 text-[14px] text-[#757575] md:border-t-0">
                Nothing listed for this seller yet.
              </p>
            </>
          ) : (
            <>
              <div className={`hidden border-y border-[#CECECE] py-2 text-[12px] md:grid md:grid-cols-4 ${MUTED}`}>
                {["Day", "Amount", "Schedule", "Status"].map((head, i) => (
                  <span key={head} className={i === 0 ? "pr-2" : "text-right"}>
                    {head}
                  </span>
                ))}
              </div>
              <p className="border-t border-[#CECECE] py-5 text-[14px] text-[#757575] md:border-t-0">
                No payouts yet. The keeper closes the day at 00:00 UTC; schedules land by 01:00.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
