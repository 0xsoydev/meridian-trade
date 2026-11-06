"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError } from "viem";
import { useConnection, useSignMessage } from "wagmi";
import { z } from "zod";
import { CORNERS, CTA } from "../../../components/landing/hero";
import { formatMicroPerMtok, formatUsd, parseUsd, stampFormat, TOPUP_MAX_MICRO } from "../../../lib/price";
import type { ApprovalStart, Balance, DepositResult, RouterError } from "../../../lib/types";
import { useModels } from "../models";
import { useWalletDeposit } from "../wallet-deposit";

const KEY_STORAGE = "router_key";
const MUTED = "text-[#757575]";
const TOPUP_PRESETS = ["0.50", "1.00", "5.00"];

const maskKey = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;
const createdSchema = z.object({ key: z.string().startsWith("rk_"), key_id: z.string() });
const failureSchema = z.object({ error: z.object({ message: z.string() }) });
const usageSchema = z.object({
  data: z.array(
    z.object({
      at: z.string(),
      model: z.string(),
      rail: z.string(),
      status: z.string(),
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      charge_usd_micro: z.string(),
      paid_from: z.enum(["prepaid", "balance"]),
    }),
  ),
});

const COLUMN = "flex flex-col self-start border border-[#CECECE] bg-white lg:h-[calc(100svh-277px)] lg:min-h-[423px]";
const TAB_ROW = "flex shrink-0 items-center gap-5 border-b border-[#D9D9D9] px-4 py-2.5 text-[14px]";
const INPUT =
  "h-[34px] w-full border border-[#CECECE] bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF]";
const BUTTON =
  "h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white";
const KEY_CTA = `${CTA} relative flex h-[34px] w-full items-center justify-center text-[14px] font-semibold text-white disabled:pointer-events-none disabled:bg-[#D4D4D4]`;

const tabClass = (active: boolean) =>
  active ? "font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4" : "text-[#757575] hover:text-[#1E1E1E]";

export function Keys() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalStart | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [accountError, setAccountError] = useState<"rejected" | "down" | null>(null);
  const [version, setVersion] = useState(0);
  const [pane, setPane] = useState<"connect" | "usage">("connect");
  const [keyTab, setKeyTab] = useState<"create" | "paste">("create");
  const [fundTab, setFundTab] = useState<"wallet" | "transfer" | "agent">("wallet");

  const models = useModels();
  const [autoTopup, setAutoTopup] = useState("");
  const [dailyCap, setDailyCap] = useState("");
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const walletDeposit = useWalletDeposit();
  const [walletAmount, setWalletAmount] = useState("1.00");
  const [walletPaying, setWalletPaying] = useState(false);
  const [depositTx, setDepositTx] = useState("");
  const [depositResult, setDepositResult] = useState<{ ok: true; result: DepositResult } | { ok: false; message: string } | null>(null);
  const [depositing, setDepositing] = useState(false);

  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [calls, setCalls] = useState<z.infer<typeof usageSchema>["data"]>([]);
  const modelPicker = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!key) {
      setCalls([]);
      return;
    }
    let alive = true;
    fetch("/api/v1/usage", { cache: "no-store", headers: { authorization: `Bearer ${key}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (alive) setCalls(usageSchema.safeParse(body).data?.data ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, version]);

  useEffect(() => {
    setKey(window.localStorage.getItem(KEY_STORAGE));
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!key) {
      setBalance(null);
      setAccountError(null);
      return;
    }
    let alive = true;
    fetch("/api/v1/balance", {
      cache: "no-store",
      headers: { authorization: `Bearer ${key}` },
    })
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 401) {
          setAccountError("rejected");
          setBalance(null);
          return;
        }
        if (!res.ok) {
          setAccountError("down");
          return;
        }
        const body = (await res.json()) as Balance;
        setBalance(body);
        setAccountError(null);
      })
      .catch(() => {
        if (alive) setAccountError("down");
      });
    return () => {
      alive = false;
    };
  }, [key, version]);

  useEffect(() => {
    if (!balance) return;
    setAutoTopup(formatMicroPerMtok(BigInt(balance.auto_topup_usd_micro)));
    setDailyCap(formatMicroPerMtok(BigInt(balance.daily_topup_cap_usd_micro)));
    setDefaultModel(balance.default_model);
  }, [balance, key]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  const saveKey = () => {
    const next = draft.trim();
    if (!next.startsWith("rk_") || next.length < 8) return;
    window.localStorage.setItem(KEY_STORAGE, next);
    setKey(next);
    setDraft("");
    setDepositResult(null);
    setSaveError(null);
    setSaved(false);
  };

  const clearKey = () => {
    window.localStorage.removeItem(KEY_STORAGE);
    setKey(null);
    setBalance(null);
    setAccountError(null);
    setDepositResult(null);
    setSaveError(null);
    setSaved(false);
  };

  const createKey = async () => {
    if (!address || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const message = JSON.stringify({ domain: window.location.host, action: "create_key", issued_at: new Date().toISOString() });
      const signature = await signMessage({ message });
      const res = await fetch("/api/v1/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, message, signature }),
      });
      const body: unknown = await res.json().catch(() => null);
      const created = createdSchema.safeParse(body);
      if (!res.ok || !created.success) {
        setCreateError(failureSchema.safeParse(body).data?.error.message ?? `create failed (${res.status})`);
        return;
      }
      window.localStorage.setItem(KEY_STORAGE, created.data.key);
      setKey(created.data.key);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "the wallet did not sign");
    } finally {
      setCreating(false);
    }
  };

  const deposit = async () => {
    if (!key || depositing) return;
    const tx = depositTx.trim();
    if (!tx) return;
    setDepositing(true);
    setDepositResult(null);
    try {
      const res = await fetch("/api/v1/keys/deposit", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ tx_id: tx }),
      });
      const body = (await res.json().catch(() => null)) as DepositResult | RouterError | null;
      if (!res.ok) {
        const message = body && "error" in body ? body.error.message : `deposit failed (${res.status})`;
        if (res.status === 401) setAccountError("rejected");
        setDepositResult({ ok: false, message });
        return;
      }
      setDepositResult({ ok: true, result: body as DepositResult });
      setDepositTx("");
      refresh();
    } catch {
      setDepositResult({ ok: false, message: "the deposit route is unreachable; retry in a moment" });
    } finally {
      setDepositing(false);
    }
  };

  const depositFromWallet = async () => {
    const amount = parseUsd(walletAmount);
    if (!key || walletPaying || amount === null || amount <= 0n) return;
    setWalletPaying(true);
    setDepositResult(null);
    try {
      const result = await walletDeposit(key, amount, balance);
      setDepositResult({ ok: true, result });
      refresh();
    } catch (cause) {
      setDepositResult({
        ok: false,
        message: cause instanceof BaseError ? cause.shortMessage : cause instanceof Error ? cause.message : "the wallet deposit failed",
      });
    } finally {
      setWalletPaying(false);
    }
  };

  const saveSettings = async () => {
    if (!key || saving) return;
    const autoMicro = parseUsd(autoTopup);
    const capMicro = parseUsd(dailyCap);
    if (autoMicro === null) {
      setSaveError("auto top-up is not a USD amount");
      setSaved(false);
      return;
    }
    if (capMicro === null) {
      setSaveError("daily cap is not a USD amount");
      setSaved(false);
      return;
    }
    if (capMicro <= 0n) {
      setSaveError("daily cap must be above zero");
      setSaved(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/keys/settings", {
        method: "PATCH",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          auto_topup_usd_micro: autoMicro.toString(),
          daily_topup_cap_usd_micro: capMicro.toString(),
          default_model: defaultModel,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as RouterError | null;
        if (res.status === 401) {
          setAccountError("rejected");
          setSaveError("Router key rejected. Paste it again.");
        } else {
          setApproval(body?.approval ?? null);
          setSaveError(body?.error?.message ?? `save failed (${res.status})`);
        }
        return;
      }
      setApproval(null);
      setBalance((await res.json()) as Balance);
      setSaved(true);
    } catch {
      setSaveError("the settings route is unreachable; retry in a moment");
    } finally {
      setSaving(false);
    }
  };

  const stats: { label: string; value: string; tone?: "up" | undefined }[] = [
    { label: "Balance", value: balance ? formatUsd(BigInt(balance.balance_usd_micro)) : "—" },
    { label: "Reserved", value: balance ? formatUsd(BigInt(balance.reserved_usd_micro)) : "—" },
    { label: "Topped up today", value: balance ? formatUsd(BigInt(balance.topped_up_today_usd_micro)) : "—" },
    { label: "Daily cap", value: balance ? formatUsd(BigInt(balance.daily_topup_cap_usd_micro)) : "—" },
    { label: "Auto top-up", value: balance ? formatUsd(BigInt(balance.auto_topup_usd_micro)) : "—" },
    {
      label: "Human link",
      value: balance ? (balance.human_linked ? "linked" : "not linked") : "—",
      tone: balance?.human_linked ? "up" : undefined,
    },
  ];

  const snippets = [
    { id: "base", label: "Base URL", text: `${origin}/api/v1` },
    { id: "auth", label: "Auth header", text: `Authorization: Bearer ${key ?? "rk_…"}` },
    { id: "chat", label: "Chat call", text: `POST ${origin}/api/v1/chat/completions` },
    { id: "topup", label: "Top-up call", text: `POST ${origin}/api/v1/topup?usd=1.00` },
  ];

  const keyState = !key
    ? "none"
    : accountError === "rejected"
      ? "rejected"
      : accountError === "down"
        ? "offline"
        : balance
          ? "live"
          : "checking";
  const wallet = balance?.wallet ?? null;
  const walletShort = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "";

  return (
    <section>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border border-[#CECECE] bg-white px-4 py-3">
        <div className="flex w-64 items-center gap-2.5 p-2 pr-3">
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1E1E1E] text-[11px] font-medium tracking-wide text-white"
          >
            rk
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-semibold leading-5 text-[#1E1E1E]">Router key</span>
            <span className="truncate text-[11px] leading-4 tabular-nums text-[#757575]">
              {key ? maskKey(key) : "none in this browser"}
            </span>
          </span>
          <span
            className={`shrink-0 border border-[#CECECE] px-1.5 py-0.5 text-[11px] leading-none ${
              keyState === "live" ? "text-[#2EBD85]" : keyState === "rejected" ? "text-[#F6465D]" : "text-[#1E1E1E]"
            }`}
          >
            {keyState}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-[11px] leading-4 text-[#757575]">{stat.label}</p>
              <p className={`text-[14px] font-semibold tabular-nums ${stat.tone === "up" ? "text-[#2EBD85]" : "text-[#1E1E1E]"}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="ml-auto text-[14px]">
          {accountError === "rejected" ? (
            <span className="text-[13px] text-[#F6465D]">Router key rejected. Paste it again.</span>
          ) : accountError === "down" ? (
            <span className="text-[13px] text-[#F6465D]">The account feed is unreachable. Retry in a moment.</span>
          ) : address ? (
            <span className="tabular-nums text-[#1E1E1E]">
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-[17px] lg:grid-cols-[minmax(0,1fr)_290px_290px]">
        <div className={COLUMN}>
          <div className={TAB_ROW}>
            {(["connect", "usage"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setPane(item)} aria-pressed={pane === item} className={tabClass(pane === item)}>
                {item === "connect" ? "Connect" : "Usage"}
              </button>
            ))}
            <span className={`ml-auto text-[12px] ${MUTED}`}>
              {calls.length} call{calls.length === 1 ? "" : "s"}
            </span>
          </div>

          {pane === "connect" ? (
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-6">
              <p className="text-[13px] text-[#1E1E1E]">[ the router ]</p>
              <h2 className="mt-3 font-serif text-[32px] leading-[1.1] text-[#1E1E1E]">Point your agent at the router.</h2>
              <p className={`mt-3 max-w-[560px] text-pretty text-[14px] leading-5 ${MUTED}`}>
                OpenAI-compatible chat, one bearer token. The key stays in the header; every call prices itself at
                the cheapest ask and settles once.
              </p>

              <div className="mt-5 border-t border-[#D9D9D9]">
                {snippets.map((snippet) => (
                  <div key={snippet.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#D9D9D9] py-3">
                    <span className={`w-24 shrink-0 text-[13px] ${MUTED}`}>{snippet.label}</span>
                    <code className="min-w-0 flex-1 truncate text-[13px] tabular-nums text-[#1E1E1E]">
                      {snippet.id === "auth" && key ? `Authorization: Bearer ${maskKey(key)}` : snippet.text}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copy(snippet.id, snippet.text)}
                      className="text-[13px] text-[#1743FF] hover:underline"
                    >
                      {copied === snippet.id ? "copied" : "copy"}
                    </button>
                  </div>
                ))}
              </div>

              <p className={`mt-4 max-w-[560px] text-pretty text-[13px] leading-5 ${MUTED}`}>
                A top-up with no Authorization header mints a fresh funded key; with one, it credits that key.
                Deposits are credited only after the Hedera mirror confirms the transfer.
              </p>
            </div>
          ) : (
            <>
              <div className={`hidden px-4 py-1.5 text-[11px] md:grid md:grid-cols-6 md:gap-x-3 ${MUTED}`}>
                {["Time, UTC", "Model", "Rail", "Tokens in / out", "Paid from", "Charge"].map((head) => (
                  <span key={head}>{head}</span>
                ))}
              </div>
              <div className="max-h-[420px] min-h-0 flex-1 overflow-auto lg:max-h-none">
                {!key ? (
                  <p className="px-4 py-6 text-center text-[13px] text-[#757575]">Create or paste a key to see its calls.</p>
                ) : calls.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[13px] text-[#757575]">
                    No calls yet. Point an agent at the router and they show up here.
                  </p>
                ) : (
                  calls.map((call, index) => (
                    <div
                      key={`${call.at}-${index}`}
                      className="grid grid-cols-3 gap-x-3 gap-y-1 border-t border-[#D9D9D9] px-4 py-2 text-[13px] tabular-nums text-[#1E1E1E] md:grid-cols-6"
                    >
                      <span className={MUTED}>{stampFormat.format(new Date(call.at))}</span>
                      <span className="truncate">{call.model}</span>
                      <span className={MUTED}>{call.rail}</span>
                      <span>
                        {call.prompt_tokens.toLocaleString("en-US")} / {call.completion_tokens.toLocaleString("en-US")}
                      </span>
                      <span className={MUTED}>{call.status === "settled" ? call.paid_from : call.status}</span>
                      <span>{call.paid_from === "prepaid" ? "prepaid MTokens" : formatUsd(BigInt(call.charge_usd_micro))}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-[17px] self-start lg:h-[calc(100svh-277px)] lg:min-h-[423px]">
          <div className="shrink-0 border border-[#CECECE] bg-white">
            <div className="flex border-b border-[#D9D9D9]">
              {(["create", "paste"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setKeyTab(item)}
                  aria-pressed={keyTab === item}
                  className={`w-1/2 py-2 text-[14px] font-semibold ${item === "paste" ? "border-l border-[#CECECE]" : ""} ${
                    keyTab === item ? "bg-black text-white" : "text-[#757575] hover:text-[#1E1E1E]"
                  }`}
                >
                  {item === "create" ? "Create" : "Paste"}
                </button>
              ))}
            </div>

            <div className="space-y-3 p-4">
              {keyTab === "create" ? (
                authenticated && address ? (
                  <>
                    <button type="button" onClick={() => void createKey()} disabled={creating} className={KEY_CTA}>
                      {CORNERS.map((corner) => (
                        <span key={corner} aria-hidden className={corner} />
                      ))}
                      {creating ? "Waiting for the signature…" : "Create a key with your wallet"}
                    </button>
                    <p className={`text-[13px] leading-5 ${createError ? "text-[#F6465D]" : MUTED}`}>
                      {createError ?? `${address.slice(0, 6)}…${address.slice(-4)} signs once. The key stays in this browser.`}{" "}
                      <button type="button" onClick={() => void logout()} className="text-[#1743FF] hover:underline">
                        Disconnect
                      </button>
                    </p>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => login()} disabled={!ready} className={KEY_CTA}>
                      {CORNERS.map((corner) => (
                        <span key={corner} aria-hidden className={corner} />
                      ))}
                      Connect wallet
                    </button>
                    <p className={`text-[13px] leading-5 ${MUTED}`}>One wallet signature creates the key.</p>
                  </>
                )
              ) : (
                <>
                  <label className="block">
                    <span className={`mb-1 block text-[13px] ${MUTED}`}>Router key</span>
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="rk_…" className={INPUT} />
                  </label>
                  <button
                    type="button"
                    onClick={saveKey}
                    disabled={!draft.trim().startsWith("rk_") || draft.trim().length < 8}
                    className={BUTTON}
                  >
                    Save key
                  </button>
                  <p className={`text-[13px] leading-5 ${MUTED}`}>Stays in this browser, never in a URL.</p>
                </>
              )}
              {key ? (
                <p className={`border-t border-[#D9D9D9] pt-3 text-[13px] leading-5 ${MUTED}`}>
                  Saved <span className="tabular-nums text-[#1E1E1E]">{maskKey(key)}</span>.{" "}
                  <button type="button" onClick={clearKey} className="text-[#1743FF] hover:underline">
                    Clear
                  </button>
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border border-[#CECECE] bg-white">
            <div className={TAB_ROW}>
              {(["wallet", "transfer", "agent"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFundTab(item)}
                  aria-pressed={fundTab === item}
                  className={tabClass(fundTab === item)}
                >
                  {item === "wallet" ? "Wallet" : item === "transfer" ? "Transfer" : "Agent"}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {fundTab === "agent" ? (
                <>
                  <p className={`text-pretty text-[13px] leading-5 ${MUTED}`}>
                    Your agent pays the x402 quote. With your key attached the credit lands here; with no key the call
                    mints a fresh funded key.
                  </p>
                  <button
                    type="button"
                    onClick={() => void copy("agent", `POST ${origin}/api/v1/topup?usd=1.00`)}
                    className="w-full border border-[#CECECE] bg-white px-3 py-2 text-left text-[13px] tabular-nums text-[#1E1E1E] hover:border-[#1743FF]"
                  >
                    {copied === "agent" ? "Copied. Run it from your agent." : "Copy top-up call"}
                  </button>
                </>
              ) : !key ? (
                <p className={`text-[13px] leading-5 ${MUTED}`}>Create or paste a key first.</p>
              ) : fundTab === "wallet" ? (
                wallet ? (
                  <>
                    <p className={`text-pretty text-[13px] leading-5 ${MUTED}`}>
                      Pay up to {formatUsd(TOPUP_MAX_MICRO)} at a time in Hedera testnet USDC from {walletShort}, the wallet
                      that created this key. The mirror verifies the transfer before it credits.
                    </p>
                    <span className="flex items-center gap-1 border border-[#CECECE] bg-white px-2.5 focus-within:border-[#1743FF]">
                      <span className={`text-[13px] ${MUTED}`}>$</span>
                      <input
                        value={walletAmount}
                        onChange={(event) => setWalletAmount(event.target.value)}
                        inputMode="decimal"
                        aria-label="deposit amount in USD"
                        className="h-[32px] w-full bg-transparent text-[14px] tabular-nums text-[#1E1E1E] outline-none"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => void depositFromWallet()}
                      disabled={
                        walletPaying ||
                        address?.toLowerCase() !== wallet ||
                        (parseUsd(walletAmount) ?? 0n) <= 0n ||
                        (parseUsd(walletAmount) ?? 0n) > TOPUP_MAX_MICRO
                      }
                      className={BUTTON}
                    >
                      {walletPaying
                        ? "Paying from your wallet…"
                        : address?.toLowerCase() === wallet
                          ? "Deposit from wallet"
                          : `Connect ${walletShort} to pay`}
                    </button>
                  </>
                ) : (
                  <p className={`text-pretty text-[13px] leading-5 ${MUTED}`}>
                    {balance
                      ? "No wallet created this key. Send USDC with the memo under Transfer, or top up from your agent."
                      : accountError
                        ? "The key's account did not load. See the note at the top."
                        : "Loading the key's account…"}
                  </p>
                )
              ) : (
                <>
                  <p className={`text-pretty text-[13px] leading-5 ${MUTED}`}>
                    Send USDC to the venue treasury on Hedera with this memo, then paste the transaction id. The mirror
                    verifies the transfer before it credits.
                  </p>
                  {balance ? (
                    <div className="border-t border-[#D9D9D9]">
                      {[
                        { id: "treasury", label: "Treasury", value: balance.treasury ?? "—" },
                        { id: "memo", label: "Memo", value: balance.memo },
                      ].map((row) => (
                        <div key={row.id} className="flex items-baseline gap-3 border-b border-[#D9D9D9] py-2">
                          <span className={`text-[13px] ${MUTED}`}>{row.label}</span>
                          <code className="min-w-0 flex-1 truncate text-right text-[13px] tabular-nums text-[#1E1E1E]">{row.value}</code>
                          {row.value !== "—" ? (
                            <button
                              type="button"
                              onClick={() => void copy(row.id, row.value)}
                              className="text-[13px] text-[#1743FF] hover:underline"
                            >
                              {copied === row.id ? "copied" : "copy"}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <label className="block">
                    <span className={`mb-1 block text-[13px] ${MUTED}`}>Hedera transaction id or EVM hash</span>
                    <input
                      value={depositTx}
                      onChange={(event) => setDepositTx(event.target.value)}
                      placeholder="0.0.12345@1700000000.000000000 or 0x…"
                      className={INPUT}
                    />
                  </label>
                  <button type="button" onClick={() => void deposit()} disabled={!depositTx.trim() || depositing} className={BUTTON}>
                    {depositing ? "Verifying…" : "Deposit"}
                  </button>
                </>
              )}

              {depositResult && fundTab !== "agent" ? (
                depositResult.ok ? (
                  <p className="text-[13px] leading-5 text-[#2EBD85]">
                    Credited {formatUsd(BigInt(depositResult.result.amount_usd_micro))}. Balance{" "}
                    {formatUsd(BigInt(depositResult.result.balance_usd_micro))}.
                  </p>
                ) : (
                  <p className="text-[13px] leading-5 text-[#F6465D]">{depositResult.message}</p>
                )
              ) : null}
            </div>
          </div>
        </div>

        <div className={COLUMN}>
          <div className={TAB_ROW}>
            <span className="font-semibold text-[#1E1E1E]">Settings</span>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
            <label className="block">
              <span className={`mb-1 flex items-baseline justify-between gap-2 text-[13px] ${MUTED}`}>
                <span>Auto top-up, USD</span>
                <span className="text-[12px]">0.10 to 20.00</span>
              </span>
              <input
                value={autoTopup}
                onChange={(event) => setAutoTopup(event.target.value)}
                inputMode="decimal"
                placeholder="0.50"
                className={INPUT}
              />
            </label>
            <div className="flex gap-5">
              {TOPUP_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAutoTopup(preset)}
                  className={`text-[14px] ${
                    autoTopup === preset
                      ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                      : "text-[#757575] hover:text-[#1E1E1E]"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <label className="block">
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Daily cap, USD</span>
              <input
                value={dailyCap}
                onChange={(event) => setDailyCap(event.target.value)}
                inputMode="decimal"
                placeholder="5.00"
                className={INPUT}
              />
            </label>
            <p className={`text-pretty text-[13px] leading-5 ${MUTED}`}>
              Lowering is free. Raising asks for a World ID approval first.
            </p>

            <div>
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Default model</span>
              <details ref={modelPicker} className="relative">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 border border-[#CECECE] bg-white px-2.5 py-2 text-[14px] text-[#1E1E1E] [&::-webkit-details-marker]:hidden">
                  <span className="truncate">{defaultModel ?? "router default"}</span>
                  <span aria-hidden className="text-[#757575]">⌄</span>
                </summary>
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto border border-[#CECECE] bg-white py-1">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setDefaultModel(null);
                        if (modelPicker.current) modelPicker.current.open = false;
                      }}
                      className="w-full px-3 py-2 text-left text-[13px] text-[#757575] hover:bg-[#F5F5F5]"
                    >
                      router default
                    </button>
                  </li>
                  {models.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDefaultModel(row.id);
                          if (modelPicker.current) modelPicker.current.open = false;
                        }}
                        className={`w-full px-3 py-2 text-left text-[13px] hover:bg-[#F5F5F5] ${
                          row.id === defaultModel ? "text-[#1E1E1E]" : "text-[#757575]"
                        }`}
                      >
                        {row.id}
                      </button>
                    </li>
                  ))}
                  {models.length === 0 ? (
                    <li className="px-3 py-2 text-[13px] text-[#757575]">loading models…</li>
                  ) : null}
                </ul>
              </details>
            </div>

            <button type="button" onClick={() => void saveSettings()} disabled={!key || saving} className={BUTTON}>
              {saving ? "Saving…" : "Save settings"}
            </button>

            {!key ? (
              <p className={`text-center text-[13px] ${MUTED}`}>Create or paste a key first.</p>
            ) : saved ? (
              <p className="text-center text-[13px] text-[#2EBD85]">Saved.</p>
            ) : saveError ? (
              <p className="text-center text-[13px] leading-5 text-[#F6465D]">{saveError}</p>
            ) : (
              <p className={`text-center text-[13px] ${MUTED}`}>Saves with the key.</p>
            )}

            {approval ? (
              <>
                <a
                  href={approval.verification_uri_complete}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-[34px] w-full items-center justify-center border border-[#1743FF] bg-white text-[14px] text-[#1743FF] hover:bg-[#1743FF]/5"
                >
                  Approve with World ID: {approval.user_code}
                </a>
                <p className={`text-[13px] leading-5 ${MUTED}`}>Approve in the new tab, then save the settings again.</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
