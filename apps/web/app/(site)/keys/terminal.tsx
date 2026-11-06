"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, erc20Abi, isAddress } from "viem";
import { hederaTestnet } from "viem/chains";
import { useConnection, useDisconnect, useReadContract, useSignMessage } from "wagmi";
import { z } from "zod";
import { CORNERS, CTA } from "../../../components/landing/hero";
import { formatMicroPerMtok, formatUsd, parseUsd, stampFormat, TOPUP_MAX_MICRO } from "../../../lib/price";
import type { ApprovalStart, Balance, DepositResult, RouterError } from "../../../lib/types";
import { useModels } from "../models";
import { useWalletDeposit } from "../wallet-deposit";

const KEY_STORAGE = "router_key";
const KEYS_STORAGE = "router_keys";
const MUTED = "text-[#757575]";
const TOPUP_PRESETS = ["0.50", "1.00", "5.00"];
const DEPOSIT_PRESETS = ["1", "5", "10", "20"];

const maskKey = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;
const entriesSchema = z.array(z.object({ name: z.string(), key: z.string().startsWith("rk_") }));
type Entry = z.infer<typeof entriesSchema>[number];

function storedEntries(): Entry[] {
  try {
    return entriesSchema.parse(JSON.parse(window.localStorage.getItem(KEYS_STORAGE) ?? "[]"));
  } catch {
    return [];
  }
}

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

const COLUMN = "flex flex-col self-start rounded-[6px] border border-[#CECECE] bg-white lg:h-[calc(100svh-277px)] lg:min-h-[423px]";
const TAB_ROW = "flex shrink-0 items-center gap-5 border-b border-[#D9D9D9] px-4 py-2.5 text-[14px]";
const INPUT =
  "h-[34px] w-full rounded-[6px] border border-[#CECECE] bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF]";
const BUTTON =
  "h-[34px] w-full rounded-[6px] bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white";
const KEY_CTA = `${CTA} relative mt-6 inline-flex h-[46px] w-fit items-center px-9 text-[16px] text-white disabled:pointer-events-none disabled:bg-[#D4D4D4]`;

const tabClass = (active: boolean) =>
  active ? "font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4" : "text-[#757575] hover:text-[#1E1E1E]";

export function Keys() {
  const { ready, login, logout } = usePrivy();
  const { address } = useConnection();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: signMessage } = useSignMessage();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalStart | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [keyName, setKeyName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ key: string; message: string } | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [accountError, setAccountError] = useState<"rejected" | "down" | null>(null);
  const [version, setVersion] = useState(0);
  const [pane, setPane] = useState<"connect" | "usage">("connect");
  const [fundTab, setFundTab] = useState<"wallet" | "transfer" | "agent">("wallet");

  const models = useModels();
  const [autoTopup, setAutoTopup] = useState("");
  const [dailyCap, setDailyCap] = useState("");
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const walletDeposit = useWalletDeposit();
  const [walletAmount, setWalletAmount] = useState("1");
  const [walletPaying, setWalletPaying] = useState(false);
  const [depositTx, setDepositTx] = useState("");
  const [depositResult, setDepositResult] = useState<{ ok: true; result: DepositResult } | { ok: false; message: string } | null>(null);
  const [depositing, setDepositing] = useState(false);

  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [calls, setCalls] = useState<z.infer<typeof usageSchema>["data"]>([]);
  const modelPicker = useRef<HTMLDetailsElement | null>(null);
  const namer = useRef<HTMLDialogElement | null>(null);

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
    const active = window.localStorage.getItem(KEY_STORAGE);
    const stored = storedEntries();
    setEntries(active && !stored.some((entry) => entry.key === active) ? [{ name: "My key", key: active }, ...stored] : stored);
    setKey(active);
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

  const wallet = balance?.wallet ?? null;
  const walletShort = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "";
  const payer = address !== undefined && address.toLowerCase() === wallet;
  const usdc = balance?.usdc_evm && isAddress(balance.usdc_evm) ? balance.usdc_evm : undefined;
  const depositMicro = parseUsd(walletAmount);
  const depositOk = depositMicro !== null && depositMicro > 0n && depositMicro <= TOPUP_MAX_MICRO;
  const { data: held, refetch: refetchHeld } = useReadContract({
    chainId: hederaTestnet.id,
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: payer && usdc !== undefined },
  });

  const store = (next: Entry[], active: string | null) => {
    window.localStorage.setItem(KEYS_STORAGE, JSON.stringify(next));
    if (active) window.localStorage.setItem(KEY_STORAGE, active);
    else window.localStorage.removeItem(KEY_STORAGE);
    setEntries(next);
    if (active === key) return;
    setKey(active);
    setBalance(null);
    setAccountError(null);
    setDepositResult(null);
    setSaveError(null);
    setSaved(false);
  };

  const remove = async (entry: Entry) => {
    setRemoving(entry.key);
    setRemoveError(null);
    try {
      const res = await fetch("/api/v1/keys", { method: "DELETE", headers: { authorization: `Bearer ${entry.key}` } });
      if (!res.ok && res.status !== 401) {
        const body: unknown = await res.json().catch(() => null);
        setRemoveError({ key: entry.key, message: failureSchema.safeParse(body).data?.error.message ?? `delete failed (${res.status})` });
        return;
      }
      const next = entries.filter((row) => row.key !== entry.key);
      store(next, entry.key === key ? (next[0]?.key ?? null) : key);
      setConfirming(null);
    } catch {
      setRemoveError({ key: entry.key, message: "the keys route is unreachable; retry in a moment" });
    } finally {
      setRemoving(null);
    }
  };

  const createKey = async () => {
    const name = keyName.trim();
    if (!address || creating || !name) return;
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
      store([{ name, key: created.data.key }, ...entries], created.data.key);
      setKeyName("");
      namer.current?.close();
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
      void refetchHeld();
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
          setSaveError("This key was rejected. Delete it and create a new one.");
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
    { label: "balance", value: balance ? formatUsd(BigInt(balance.balance_usd_micro)) : "—" },
    { label: "reserved", value: balance ? formatUsd(BigInt(balance.reserved_usd_micro)) : "—" },
    { label: "topped up today", value: balance ? formatUsd(BigInt(balance.topped_up_today_usd_micro)) : "—" },
    { label: "daily cap", value: balance ? formatUsd(BigInt(balance.daily_topup_cap_usd_micro)) : "—" },
    { label: "auto top-up", value: balance ? formatUsd(BigInt(balance.auto_topup_usd_micro)) : "—" },
    {
      label: "human link",
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

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1">
        <h1 className="text-[28px] font-normal leading-9 text-[#1E1E1E]">API Keys</h1>
        {accountError ? (
          <p className="text-[13px] text-[#F6465D]">
            {accountError === "rejected" ? "This key was rejected. Delete it and create a new one." : "The account feed is unreachable. Retry in a moment."}
          </p>
        ) : null}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-x-12 gap-y-3 px-1">
        {stats.map((stat) => (
          <div key={stat.label}>
            <p className="text-[13px] leading-5 text-[#757575]">[ {stat.label} ]</p>
            <p className={`text-[28px] font-normal leading-9 tabular-nums ${stat.tone === "up" ? "text-[#2EBD85]" : "text-[#1E1E1E]"}`}>{stat.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-[17px] lg:grid-cols-[minmax(0,1fr)_290px_290px]">
        <div className="flex flex-col gap-[17px] self-start lg:h-[calc(100svh-277px)] lg:min-h-[423px]">
          <div className="flex min-h-0 flex-1 flex-col justify-center-safe overflow-auto rounded-[6px] border border-[#CECECE] bg-white px-6 py-6 *:shrink-0">
            <div className="grid items-start gap-6 xl:grid-cols-2 xl:gap-8">
              <div className="flex flex-col">
                <p className="text-[13px] text-[#1E1E1E]">[ api keys ]</p>
                <h2 className="mt-3 font-serif text-[40px] leading-[1.05] text-[#1E1E1E]">One key, one balance.</h2>
                <p className={`mt-3 max-w-[480px] text-pretty text-[14px] leading-5 ${MUTED}`}>
                  Name a key and your wallet signs once to create it. Keys stay in this browser, never in a URL, and Trade
                  spends from the one in use.
                </p>
                {address ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCreateError(null);
                      namer.current?.showModal();
                    }}
                    className={KEY_CTA}
                  >
                    {CORNERS.map((corner) => (
                      <span key={corner} aria-hidden className={corner} />
                    ))}
                    Create API Key
                  </button>
                ) : (
                  <button type="button" onClick={() => login()} disabled={!ready} className={KEY_CTA}>
                    {CORNERS.map((corner) => (
                      <span key={corner} aria-hidden className={corner} />
                    ))}
                    Connect Wallet
                  </button>
                )}
                <p className={`mt-5 text-[13px] leading-5 ${MUTED}`}>
                  {address ? `${address.slice(0, 6)}…${address.slice(-4)} is connected.` : "No wallet connected yet."}
                  {address ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() => void logout().finally(() => disconnect())}
                        className="text-[#1743FF] hover:underline"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : null}
                </p>
              </div>

              {entries.length > 0 ? (
                <ul className="space-y-3">
                  {entries.map((entry) => (
                    <li key={entry.key} className="rounded-[6px] border border-[#CECECE] px-4 py-3 text-[13px]">
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="min-w-0 truncate text-[14px] font-semibold text-[#1E1E1E]">{entry.name}</span>
                        {entry.key === key ? (
                          <span className="shrink-0 text-[#2EBD85]">in use</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => store(entries, entry.key)}
                            className="shrink-0 text-[#1743FF] hover:underline"
                          >
                            use
                          </button>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <code className={`tabular-nums ${MUTED}`}>{maskKey(entry.key)}</code>
                        <span className="flex gap-4">
                          <button type="button" onClick={() => void copy(entry.key, entry.key)} className="text-[#1743FF] hover:underline">
                            {copied === entry.key ? "copied" : "copy"}
                          </button>
                          {confirming === entry.key ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void remove(entry)}
                                disabled={removing !== null}
                                className="text-[#F6465D] hover:underline disabled:text-[#C9C9C9]"
                              >
                                {removing === entry.key ? "deleting…" : "delete for good"}
                              </button>
                              <button type="button" onClick={() => setConfirming(null)} className={`${MUTED} hover:underline`}>
                                keep
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirming(entry.key);
                                setRemoveError(null);
                              }}
                              className="text-[#F6465D] hover:underline"
                            >
                              delete
                            </button>
                          )}
                        </span>
                      </div>
                      {removeError?.key === entry.key ? <p className="mt-1.5 leading-5 text-[#F6465D]">{removeError.message}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col rounded-[6px] border border-[#CECECE] bg-white lg:h-[240px]">
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
              <div className="min-h-0 flex-1 overflow-auto px-4 pb-2 pt-3">
                <p className={`text-pretty text-[13px] leading-5 ${MUTED}`}>
                  OpenAI-compatible chat, one bearer token. Every call prices itself at the cheapest ask and settles once.
                </p>
                <div className="mt-2">
                  {snippets.map((snippet) => (
                    <div key={snippet.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[#D9D9D9] py-2">
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
              </div>
            ) : (
              <>
                <div className={`hidden shrink-0 px-4 py-1.5 text-[11px] md:grid md:grid-cols-6 md:gap-x-3 ${MUTED}`}>
                  {["Time, UTC", "Model", "Rail", "Tokens in / out", "Paid from", "Charge"].map((head) => (
                    <span key={head}>{head}</span>
                  ))}
                </div>
                <div className="max-h-[300px] min-h-0 flex-1 overflow-auto lg:max-h-none">
                  {!key ? (
                    <p className="px-4 py-6 text-center text-[13px] text-[#757575]">Create a key to see its calls.</p>
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
        </div>

        <div className="flex flex-col gap-[17px] self-start lg:h-[calc(100svh-277px)] lg:min-h-[423px]">
          <div className="flex min-h-0 flex-1 flex-col rounded-[6px] border border-[#CECECE] bg-white">
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
                    className="w-full rounded-[6px] border border-[#CECECE] bg-white px-3 py-2 text-left text-[13px] tabular-nums text-[#1E1E1E] hover:border-[#1743FF]"
                  >
                    {copied === "agent" ? "Copied. Run it from your agent." : "Copy top-up call"}
                  </button>
                </>
              ) : !key ? (
                <p className={`text-[13px] leading-5 ${MUTED}`}>Create a key first.</p>
              ) : fundTab === "wallet" ? (
                wallet ? (
                  <>
                    <div className="flex justify-between text-[14px]">
                      <span className={MUTED}>In your wallet</span>
                      <span className="tabular-nums text-[#1E1E1E]">{payer && held !== undefined ? `${formatUsd(held)} USDC` : "—"}</span>
                    </div>
                    <label className="block">
                      <span className={`mb-1 block text-[13px] ${MUTED}`}>Amount, USD</span>
                      <span className="flex items-center gap-2 rounded-[6px] border border-[#CECECE] bg-white px-2.5 focus-within:border-[#1743FF]">
                        <input
                          value={walletAmount}
                          onChange={(event) => setWalletAmount(event.target.value)}
                          inputMode="decimal"
                          placeholder="1"
                          className="h-[34px] w-full bg-transparent text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9]"
                        />
                        <span className={`text-[12px] ${MUTED}`}>USDC</span>
                      </span>
                    </label>
                    <div className="flex gap-5">
                      {DEPOSIT_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setWalletAmount(preset)}
                          className={`text-[14px] ${
                            walletAmount === preset
                              ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                              : "text-[#757575] hover:text-[#1E1E1E]"
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <dl className="border-t border-[#D9D9D9]">
                      <div className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                        <dt className={MUTED}>From</dt>
                        <dd className="tabular-nums text-[#1E1E1E]">{walletShort}</dd>
                      </div>
                      <div className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                        <dt className={MUTED}>Per deposit</dt>
                        <dd className="tabular-nums text-[#1E1E1E]">up to {formatUsd(TOPUP_MAX_MICRO)}</dd>
                      </div>
                      <div className="flex justify-between py-3">
                        <dt className="text-[15px] font-semibold text-[#1E1E1E]">Balance after</dt>
                        <dd className="text-[16px] font-semibold tabular-nums text-[#1E1E1E]">
                          {balance && depositOk ? formatUsd(BigInt(balance.balance_usd_micro) + depositMicro) : "—"}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      onClick={() => void depositFromWallet()}
                      disabled={walletPaying || !payer || !depositOk}
                      className={BUTTON}
                    >
                      {walletPaying
                        ? "Paying from your wallet…"
                        : !payer
                          ? `Connect ${walletShort} to pay`
                          : depositOk
                            ? `Deposit ${formatUsd(depositMicro)}`
                            : `Enter up to ${formatUsd(TOPUP_MAX_MICRO)}`}
                    </button>
                    <p className={`text-center text-[13px] leading-5 ${MUTED}`}>Hedera testnet USDC. Credits once the mirror confirms.</p>
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
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[6px] border border-[#CECECE] bg-white px-2.5 py-2 text-[14px] text-[#1E1E1E] [&::-webkit-details-marker]:hidden">
                  <span className="truncate">{defaultModel ?? "router default"}</span>
                  <span aria-hidden className="text-[#757575]">⌄</span>
                </summary>
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-[6px] border border-[#CECECE] bg-white py-1">
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
              <p className={`text-center text-[13px] ${MUTED}`}>Create a key first.</p>
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
                  className="flex h-[34px] w-full items-center justify-center rounded-[6px] border border-[#1743FF] bg-white text-[14px] text-[#1743FF] hover:bg-[#1743FF]/5"
                >
                  Approve with World ID: {approval.user_code}
                </a>
                <p className={`text-[13px] leading-5 ${MUTED}`}>Approve in the new tab, then save the settings again.</p>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <dialog
        ref={namer}
        aria-labelledby="new-key-title"
        className="m-auto w-[min(400px,calc(100vw-2rem))] rounded-[6px] border border-[#CECECE] bg-white p-6 text-[#1E1E1E] backdrop:bg-[#1E1E1E]/20"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createKey();
          }}
        >
          <p id="new-key-title" className="text-[13px]">
            [ new api key ]
          </p>
          <label className="mt-4 block">
            <span className={`mb-1 block text-[13px] ${MUTED}`}>Name</span>
            <input
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              maxLength={40}
              placeholder="trading agent"
              className={INPUT}
            />
          </label>
          {createError ? <p className="mt-2 text-[13px] leading-5 text-[#F6465D]">{createError}</p> : null}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => namer.current?.close()}
              className="h-[34px] w-full rounded-[6px] border border-[#CECECE] bg-white text-[14px] text-[#1E1E1E] hover:border-[#1743FF]"
            >
              Cancel
            </button>
            <button type="submit" disabled={creating || !keyName.trim()} className={BUTTON}>
              {creating ? "Waiting for the signature…" : "Create API Key"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
