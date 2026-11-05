"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatMicroPerMtok, parseUsd } from "../../../lib/price";
import type { Balance, DepositResult, ModelRow, RouterError } from "../../../lib/types";

const KEY_STORAGE = "router_key";
const MUTED = "text-[#757575]";
const TOPUP_PRESETS = ["0.50", "1.00", "5.00"];

const usd = (micro: bigint) => `$${formatMicroPerMtok(micro)}`;

const maskKey = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;

export function Keys({ privyReady }: { privyReady: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [accountError, setAccountError] = useState<"rejected" | "down" | null>(null);
  const [version, setVersion] = useState(0);

  const [models, setModels] = useState<ModelRow[]>([]);
  const [autoTopup, setAutoTopup] = useState("");
  const [dailyCap, setDailyCap] = useState("");
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [depositTx, setDepositTx] = useState("");
  const [depositResult, setDepositResult] = useState<{ ok: true; result: DepositResult } | { ok: false; message: string } | null>(null);
  const [depositing, setDepositing] = useState(false);

  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const modelPicker = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    setKey(window.localStorage.getItem(KEY_STORAGE));
    setOrigin(window.location.origin);
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
          setSaveError("router key rejected — paste it again");
        } else {
          setSaveError(body?.error?.message ?? `save failed (${res.status})`);
        }
        return;
      }
      setBalance((await res.json()) as Balance);
      setSaved(true);
    } catch {
      setSaveError("the settings route is unreachable; retry in a moment");
    } finally {
      setSaving(false);
    }
  };

  const stats = [
    { label: "balance", value: balance ? usd(BigInt(balance.balance_usd_micro)) : "—" },
    { label: "reserved", value: balance ? usd(BigInt(balance.reserved_usd_micro)) : "—" },
    { label: "topped up today", value: balance ? usd(BigInt(balance.topped_up_today_usd_micro)) : "—" },
    { label: "daily cap", value: balance ? usd(BigInt(balance.daily_topup_cap_usd_micro)) : "—" },
    { label: "auto top-up", value: balance ? usd(BigInt(balance.auto_topup_usd_micro)) : "—" },
  ];

  const snippets = [
    { id: "base", label: "base URL", text: `${origin}/api/v1` },
    { id: "auth", label: "auth header", text: `Authorization: Bearer ${key ?? "rk_…"}` },
    { id: "chat", label: "chat call", text: `POST ${origin}/api/v1/chat/completions` },
    { id: "topup", label: "top-up call", text: `POST ${origin}/api/v1/topup?usd=1.00` },
  ];

  return (
    <section>
      <h1 className="font-serif text-[50px] leading-[1.05] text-[#1E1E1E]">
        Fund what <span className="text-[#A3A3A3]">expires</span>
      </h1>
      <p className="mt-4 max-w-[425px] text-[14px] leading-[18px] text-black">
        One router key holds the balance, spends it at the ask, and tops up when it thins. Paste a
        key once; Trade and Perps read the same one from this browser.
      </p>

      <div className="mt-6 border-t border-[#CECECE] pt-5">
        <p className="text-[13px] text-[#1E1E1E]">[ key account ]</p>
        <dl className="mt-3 flex flex-wrap gap-x-[26px] gap-y-3">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className={`text-[13px] ${MUTED}`}>{stat.label}</dt>
              <dd className="text-[13px] tabular-nums text-[#1E1E1E]">{stat.value}</dd>
            </div>
          ))}
        </dl>
        {accountError === "rejected" ? (
          <p className="mt-2 text-[13px] text-[#F6465D]">router key rejected — paste it again</p>
        ) : accountError === "down" ? (
          <p className="mt-2 text-[13px] text-[#F6465D]">the account feed is unreachable; retry in a moment</p>
        ) : !key ? (
          <p className={`mt-2 text-[13px] ${MUTED}`}>paste a key below to wake the account</p>
        ) : null}
      </div>

      <div className="mt-5 grid gap-[17px] lg:grid-cols-[1fr_300px]">
        <div className="border border-[#CECECE] bg-[#EBEBEB] p-4">
          <p className="text-[13px] text-[#1E1E1E]">[ account ]</p>
          <h2 className="mt-2 font-serif text-[22px] leading-tight text-[#1E1E1E]">
            One key, one balance.
          </h2>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Router key</span>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="rk_…"
                className="h-[34px] w-full border border-[#CECECE] bg-white px-2.5 text-[14px] text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF]"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveKey}
                disabled={!draft.trim().startsWith("rk_") || draft.trim().length < 8}
                className="h-[34px] bg-black px-4 text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
              >
                Save key
              </button>
              {key ? (
                <button
                  type="button"
                  onClick={clearKey}
                  className="h-[34px] border border-[#CECECE] bg-white px-4 text-[14px] text-[#1E1E1E] hover:border-[#1743FF]"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <p className={`text-[13px] leading-5 ${MUTED}`}>
              Stays in this browser, never in a URL. Currently saved:{" "}
              <span className="tabular-nums text-[#1E1E1E]">{key ? maskKey(key) : "nothing"}</span>
            </p>
          </div>

          <dl className="mt-5 border-t border-[#D9D9D9]">
            {[
              ["Balance", balance ? usd(BigInt(balance.balance_usd_micro)) : "—"],
              ["Reserved", balance ? usd(BigInt(balance.reserved_usd_micro)) : "—"],
              ["Topped up today", balance ? usd(BigInt(balance.topped_up_today_usd_micro)) : "—"],
              ["Daily cap", balance ? usd(BigInt(balance.daily_topup_cap_usd_micro)) : "—"],
              ["Auto top-up", balance ? usd(BigInt(balance.auto_topup_usd_micro)) : "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-[#D9D9D9] py-2 text-[14px]">
                <dt className={MUTED}>{label}</dt>
                <dd className="tabular-nums text-[#1E1E1E]">{value}</dd>
              </div>
            ))}
            <div className="flex justify-between py-2 text-[14px]">
              <dt className={MUTED}>Human link</dt>
              <dd className="flex items-center gap-2 tabular-nums text-[#1E1E1E]">
                <span
                  aria-hidden
                  className={`h-[7px] w-[7px] rounded-full ${balance?.human_linked ? "bg-[#2EBD85]" : "bg-[#C9C9C9]"}`}
                />
                {balance ? (balance.human_linked ? "linked" : "not linked") : "—"}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-[#D9D9D9] pt-4">
            <p className="text-[13px] text-[#1E1E1E]">[ deposit ]</p>
            <p className={`mt-2 text-[13px] leading-5 ${MUTED}`}>
              Send USDC to the venue treasury on Hedera, then paste the transaction id. The mirror
              verifies the transfer before it credits.
            </p>
            <label className="mt-3 block">
              <span className={`mb-1 block text-[13px] ${MUTED}`}>Hedera transaction id</span>
              <input
                value={depositTx}
                onChange={(event) => setDepositTx(event.target.value)}
                placeholder="0.0.12345@1700000000.000000000"
                className="h-[34px] w-full border border-[#CECECE] bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF]"
              />
            </label>
            <button
              type="button"
              onClick={() => void deposit()}
              disabled={!key || !depositTx.trim() || depositing}
              className="mt-2 h-[34px] w-full bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
            >
              {depositing ? "Verifying…" : "Deposit"}
            </button>
            {depositResult ? (
              depositResult.ok ? (
                <p className="mt-2 text-[13px] leading-5 text-[#2EBD85]">
                  credited {usd(BigInt(depositResult.result.amount_usd_micro))} — balance{" "}
                  {usd(BigInt(depositResult.result.balance_usd_micro))}
                </p>
              ) : (
                <p className="mt-2 text-[13px] leading-5 text-[#F6465D]">{depositResult.message}</p>
              )
            ) : null}
          </div>

          <div className="mt-5 border-t border-[#D9D9D9] pt-4">
            <p className="text-[13px] text-[#1E1E1E]">[ top up from the agent ]</p>
            <p className={`mt-2 text-[13px] leading-5 ${MUTED}`}>
              Your agent pays the x402 quote. With your key attached the credit lands here; with no
              key the call mints a fresh funded key.
            </p>
            <button
              type="button"
              onClick={() => void copy("topup", `POST ${origin}/api/v1/topup?usd=1.00`)}
              className="mt-2 w-full border border-[#CECECE] bg-white px-3 py-2 text-left text-[13px] tabular-nums text-[#1E1E1E] hover:border-[#1743FF]"
            >
              {copied === "topup" ? "Copied — run it from your agent." : "Copy top-up call"}
            </button>
          </div>

          <div className="mt-5 border-t border-[#D9D9D9] pt-4">
            <p className="text-[13px] text-[#1E1E1E]">[ wallet ]</p>
            <button
              type="button"
              disabled
              className="mt-2 h-[34px] w-full border border-[#CECECE] bg-white text-[14px] text-[#C9C9C9]"
            >
              Create a key with your wallet
            </button>
            <p className={`mt-1.5 text-[13px] leading-5 ${MUTED}`}>
              {privyReady
                ? "Privy is configured; the provider mount lands next."
                : "needs NEXT_PUBLIC_PRIVY_APP_ID before the provider can mount."}
            </p>
            <button
              type="button"
              disabled
              className="mt-3 h-[34px] w-full border border-[#CECECE] bg-white text-[14px] text-[#C9C9C9]"
            >
              Raise the daily cap with World
            </button>
            <p className={`mt-1.5 text-[13px] leading-5 ${MUTED}`}>
              waits on /api/v1/approvals — the device-code flow is written, the route is not.
            </p>
          </div>
        </div>

        <div className="border border-[#CECECE] bg-[#EBEBEB] p-4">
          <div className="bg-black py-2 text-center text-[14px] font-semibold text-white">Settings</div>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className={`mb-1 flex items-baseline justify-between gap-2 text-[13px] ${MUTED}`}>
                <span>Auto top-up, USD</span>
                <span className="text-[12px]">0.10 – 20.00</span>
              </span>
              <input
                value={autoTopup}
                onChange={(event) => setAutoTopup(event.target.value)}
                inputMode="decimal"
                placeholder="0.50"
                className="h-[34px] w-full border border-[#CECECE] bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF]"
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
                className="h-[34px] w-full border border-[#CECECE] bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none placeholder:text-[#C9C9C9] focus:border-[#1743FF]"
              />
            </label>
            <p className={`text-[13px] leading-5 ${MUTED}`}>
              Lowering is free. Raising needs a World approval — the route lands next.
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

            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={!key || saving}
              className="h-[34px] w-full bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>

            {!key ? (
              <p className={`text-center text-[13px] ${MUTED}`}>paste a key first</p>
            ) : saved ? (
              <p className="text-center text-[13px] text-[#2EBD85]">Saved.</p>
            ) : saveError ? (
              <p className="text-center text-[13px] leading-5 text-[#F6465D]">{saveError}</p>
            ) : (
              <p className={`text-center text-[13px] ${MUTED}`}>saves with the key above</p>
            )}

            <div className="border border-[#CECECE] bg-white px-3 py-3">
              <p className="text-[14px] text-[#1E1E1E]">Spends settle off the same ledger.</p>
              <p className="mt-1 text-[13px] leading-5 text-[#757575]">
                Every call reserves at the ask, settles on usage, and releases the rest. Receipts
                back the public log.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 border-t border-[#CECECE] pt-8">
        <p className="text-[13px] text-[#1E1E1E]">[ the router ]</p>
        <h2 className="mt-3 font-serif text-[32px] leading-[1.1] text-[#1E1E1E]">
          Point your agent at the router.
        </h2>
        <p className={`mt-3 max-w-[560px] text-[14px] leading-5 ${MUTED}`}>
          OpenAI-compatible chat, one bearer token. The key stays in the header; every call prices
          itself at the cheapest ask and settles once.
        </p>

        <div className="mt-4 border-t border-[#CECECE]">
          {snippets.map((snippet) => (
            <div
              key={snippet.id}
              className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[#CECECE] py-4"
            >
              <span className={`text-[13px] ${MUTED}`}>{snippet.label}</span>
              <code className="min-w-0 flex-1 truncate text-[13px] tabular-nums text-[#1E1E1E]">
                {snippet.text}
              </code>
              <button
                type="button"
                onClick={() => void copy(snippet.id, snippet.text)}
                className="text-[14px] text-[#1743FF] hover:underline"
              >
                {copied === snippet.id ? "copied" : "copy"}
              </button>
            </div>
          ))}
        </div>

        <p className={`mt-4 text-[13px] leading-5 ${MUTED}`}>
          A top-up with no Authorization header mints a fresh funded key; with one, it credits that
          key. Deposits are credited only after the Hedera mirror confirms the transfer.
        </p>
      </div>
    </section>
  );
}
