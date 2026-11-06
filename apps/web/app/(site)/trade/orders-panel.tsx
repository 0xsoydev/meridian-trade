"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BaseError } from "viem";
import { useConnection, useSignMessage } from "wagmi";
import { z } from "zod";
import { charge, formatMicroPerMtok, formatMtok, formatUsd, parseUsd, stampFormat } from "../../../lib/price.ts";
import type { Balance, BookFill } from "../../../lib/types";

const MUTED = "text-[#757575]";
const POLL_MS = 15_000;
const TABS = ["Balances", "Open Orders", "Trade History", "Venue Fills"] as const;
const ROW = "grid grid-cols-3 gap-x-3 gap-y-1 border-t border-[#E4E4E4] px-4 py-3 text-[13px] tabular-nums text-[#1E1E1E] md:grid-cols-6";
const SCROLL = "max-h-[225px] overflow-y-auto";
const HEAD = `hidden border-y border-[#E4E4E4] px-4 py-2 text-[11px] md:grid md:grid-cols-6 md:gap-x-3 ${MUTED}`;
const INPUT = "h-[26px] w-20 rounded-[6px] border border-[#E4E4E4] bg-white px-1.5 text-right outline-none focus:border-[#1743FF]";

const text = z.string();
const holdingsSchema = z.object({
  data: z.array(z.object({ prepaid_id: text, model: text, rail: text, tokens: text, expires_at: text.nullable() })),
});
const bidsSchema = z.object({
  data: z.array(z.object({ bid_id: text, model: text, tokens: text, price_micro_per_mtok: text, hold_usd_micro: text })),
});
const offersSchema = z.object({
  data: z.array(z.object({ offer_id: text, model: text, tokens: text, price_micro_per_mtok: text, expires_at: text.nullable() })),
});
const fillsSchema = z.object({
  data: z.array(
    z.object({ at: text, model: text, side: z.enum(["buy", "sell"]), tokens: text, price_micro_per_mtok: text, amount_usd_micro: text }),
  ),
});
const listingsSchema = z.object({
  listings: z.array(
    z.object({
      listing_id: text,
      rail: text,
      model: text,
      price_micro_per_mtok: text.nullable(),
      capacity_tokens: text,
      used_tokens: text,
      reserved_tokens: text,
      status: text,
    }),
  ),
});
const failureSchema = z.object({ error: z.object({ message: text }) });

type Listing = z.infer<typeof listingsSchema>["listings"][number];

async function getJson<T>(url: string, schema: z.ZodType<T>, routerKey: string | null): Promise<T | null> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: routerKey ? { authorization: `Bearer ${routerKey}` } : {},
  }).catch(() => null);
  const parsed = schema.safeParse(res?.ok ? await res.json().catch(() => null) : null);
  return parsed.success ? parsed.data : null;
}

function expiry(iso: string | null): string {
  return iso === null ? "no expiry" : `expires ${stampFormat.format(new Date(iso))}`;
}

export function OrdersPanel({
  routerKey,
  model,
  venueFills,
  account,
  version,
  onChange,
}: {
  routerKey: string | null;
  model: string;
  venueFills: BookFill[];
  account: Balance | null;
  version: number;
  onChange: () => void;
}) {
  const { address } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Open Orders");
  const [holdings, setHoldings] = useState<z.infer<typeof holdingsSchema>["data"]>([]);
  const [bids, setBids] = useState<z.infer<typeof bidsSchema>["data"]>([]);
  const [offers, setOffers] = useState<z.infer<typeof offersSchema>["data"]>([]);
  const [history, setHistory] = useState<z.infer<typeof fillsSchema>["data"]>([]);
  const [asks, setAsks] = useState<Listing[]>([]);
  const [amending, setAmending] = useState<string | null>(null);
  const [amendPrice, setAmendPrice] = useState("");
  const [amendCapacity, setAmendCapacity] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (routerKey) {
      const [held, open, resting, fills] = await Promise.all([
        getJson("/api/v1/holdings", holdingsSchema, routerKey),
        getJson("/api/v1/bids", bidsSchema, routerKey),
        getJson("/api/v1/offers", offersSchema, routerKey),
        getJson("/api/v1/fills", fillsSchema, routerKey),
      ]);
      setHoldings(held?.data ?? []);
      setBids(open?.data ?? []);
      setOffers(resting?.data ?? []);
      setHistory(fills?.data ?? []);
    }
    if (address) {
      const mine = await getJson(`/api/listings?seller=${address}`, listingsSchema, null);
      setAsks(mine?.listings.filter((row) => row.status !== "cancelled" && row.status !== "invalid") ?? []);
    }
  }, [routerKey, address]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load, version]);

  const run = async (id: string, done: string, call: () => Promise<Response>) => {
    setBusy(id);
    setNotice(null);
    try {
      const res = await call();
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        throw new Error(failureSchema.safeParse(body).data?.error.message ?? `request failed (${res.status})`);
      }
      setNotice({ ok: true, text: done });
      setAmending(null);
      await load();
      onChange();
    } catch (cause) {
      setNotice({
        ok: false,
        text: cause instanceof BaseError ? cause.shortMessage : cause instanceof Error ? cause.message : "the request failed",
      });
    } finally {
      setBusy(null);
    }
  };

  const withKey = (url: string) => () =>
    fetch(url, { method: "DELETE", headers: routerKey ? { authorization: `Bearer ${routerKey}` } : {} });

  const signed = (url: string, method: "PATCH" | "DELETE", fields: Record<string, string>) => async () => {
    if (!address) throw new Error("connect the seller wallet to change this ask");
    const message = JSON.stringify({
      domain: window.location.host,
      issued_at: new Date().toISOString(),
      client_nonce: crypto.randomUUID(),
      ...fields,
    });
    const signature = await signMessage({ message });
    return fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed: { address, message, signature } }),
    });
  };

  const amendPriceMicro = parseUsd(amendPrice);
  const amendValid = amendPriceMicro !== null && amendPriceMicro > 0n && /^[1-9]\d{0,12}$/.test(amendCapacity.trim());
  const orders = bids.length + offers.length + asks.length;
  const counts: Record<(typeof TABS)[number], string> = {
    Balances: `${holdings.length} holding${holdings.length === 1 ? "" : "s"}`,
    "Open Orders": `${orders} open`,
    "Trade History": `${history.length} fills`,
    "Venue Fills": `${venueFills.length} on ${model}`,
  };
  const needsKey = routerKey === null && tab !== "Venue Fills" && !(tab === "Open Orders" && asks.length > 0);

  return (
    <div id="orders" className="mt-5 rounded-[6px] border border-[#E4E4E4] bg-white">
      <div className="flex flex-wrap items-center gap-5 border-b border-[#ECECEC] px-4 py-2.5 text-[14px]">
        {TABS.map((item) => (
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
        <span className={`ml-auto text-[13px] ${MUTED}`}>{counts[tab]}</span>
      </div>

      {notice ? (
        <p className={`px-4 py-2 text-[13px] ${notice.ok ? "text-[#2EBD85]" : "text-[#F6465D]"}`}>{notice.text}</p>
      ) : null}

      <div>
        {needsKey ? (
          <p className="border-t border-[#E4E4E4] px-4 py-5 text-[14px] text-[#757575]">
            This needs a router key in this browser.{" "}
            <Link href="/keys" className="text-[#1743FF] hover:underline">
              Create one on Keys
            </Link>
            .
          </p>
        ) : null}

        {tab === "Balances" && !needsKey ? (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-[#E4E4E4] px-4 py-3 text-[13px] md:grid-cols-5">
              {(account
                ? [
                    ["Balance", formatUsd(BigInt(account.balance_usd_micro))],
                    ["Reserved", formatUsd(BigInt(account.reserved_usd_micro))],
                    ["Topped up today", formatUsd(BigInt(account.topped_up_today_usd_micro))],
                    ["Daily cap", formatUsd(BigInt(account.daily_topup_cap_usd_micro))],
                    ["Auto top-up", formatUsd(BigInt(account.auto_topup_usd_micro))],
                  ]
                : []
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className={MUTED}>{label}</dt>
                  <dd className="tabular-nums text-[#1E1E1E]">{value}</dd>
                </div>
              ))}
            </dl>
            <div className={HEAD}>
              {["Market", "Rail", "MTokens", "Expiry", "", ""].map((head, i) => (
                <span key={`${head}${i}`}>{head}</span>
              ))}
            </div>
            {holdings.length === 0 ? (
              <p className="border-t border-[#E4E4E4] px-4 py-5 text-[14px] text-[#757575] md:border-t-0">
                No MTokens held. Buy on the ticket above; what you hold can be spent on inference or sold.
              </p>
            ) : (
              <div className={SCROLL}>
                {holdings.map((row) => (
                  <div key={row.prepaid_id} className={ROW}>
                    <span>{row.model}</span>
                    <span className={MUTED}>{row.rail}</span>
                    <span>{formatMtok(BigInt(row.tokens))}</span>
                    <span className={`md:col-span-3 ${MUTED}`}>{expiry(row.expires_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === "Open Orders" && !needsKey ? (
          <>
            <div className={HEAD}>
              {["Side", "Market", "Price, USD / MTok", "Size, MTok", "Detail", ""].map((head, i) => (
                <span key={`${head}${i}`} className={i === 5 ? "text-right" : ""}>
                  {head}
                </span>
              ))}
            </div>
            {orders === 0 ? (
              <p className="border-t border-[#E4E4E4] px-4 py-5 text-[14px] text-[#757575] md:border-t-0">
                No open orders. A limit below the best ask rests as a bid; a limit sell above the best bid rests as an ask.
              </p>
            ) : null}
            <div className={SCROLL}>
              {bids.map((row) => (
                <div key={row.bid_id} className={ROW}>
                  <span className="text-[#2EBD85]">Bid</span>
                  <span>{row.model}</span>
                  <span>{formatMicroPerMtok(BigInt(row.price_micro_per_mtok))}</span>
                  <span>{formatMtok(BigInt(row.tokens))}</span>
                  <span className={MUTED}>holds {formatUsd(BigInt(row.hold_usd_micro))}</span>
                  <span className="text-right">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void run(row.bid_id, "bid cancelled; its hold is back in the balance", withKey(`/api/v1/bids/${row.bid_id}`))}
                      className="text-[#F6465D] hover:underline disabled:text-[#C9C9C9]"
                    >
                      {busy === row.bid_id ? "cancelling…" : "cancel"}
                    </button>
                  </span>
                </div>
              ))}
              {offers.map((row) => (
                <div key={row.offer_id} className={ROW}>
                  <span className="text-[#F6465D]">Ask · resale</span>
                  <span>{row.model}</span>
                  <span>{formatMicroPerMtok(BigInt(row.price_micro_per_mtok))}</span>
                  <span>{formatMtok(BigInt(row.tokens))}</span>
                  <span className={MUTED}>{expiry(row.expires_at)}</span>
                  <span className="text-right">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void run(row.offer_id, "ask cancelled; its MTokens are back in your holdings", withKey(`/api/v1/offers/${row.offer_id}`))}
                      className="text-[#F6465D] hover:underline disabled:text-[#C9C9C9]"
                    >
                      {busy === row.offer_id ? "cancelling…" : "cancel"}
                    </button>
                  </span>
                </div>
              ))}
              {asks.map((row) => {
                const capacity = BigInt(row.capacity_tokens);
                const left = capacity - BigInt(row.used_tokens) - BigInt(row.reserved_tokens);
                return (
                  <div key={row.listing_id} className={ROW}>
                    <span className="text-[#F6465D]">Ask · {row.rail} key</span>
                    <span>{row.model}</span>
                    {amending === row.listing_id ? (
                      <>
                        <input
                          value={amendPrice}
                          onChange={(event) => setAmendPrice(event.target.value)}
                          inputMode="decimal"
                          aria-label="new price, USD per MTok"
                          className={INPUT}
                        />
                        <input
                          value={amendCapacity}
                          onChange={(event) => setAmendCapacity(event.target.value)}
                          inputMode="numeric"
                          aria-label="new total capacity, MTok"
                          className={INPUT}
                        />
                        <span className={MUTED}>total capacity, MTok</span>
                        <span className="flex justify-end gap-3">
                          <button
                            type="button"
                            disabled={busy !== null || !amendValid || amendPriceMicro === null}
                            onClick={() => {
                              if (amendPriceMicro === null) return;
                              void run(
                                row.listing_id,
                                "ask updated",
                                signed(`/api/listings/${row.listing_id}`, "PATCH", {
                                  action: "amend",
                                  listing_id: row.listing_id,
                                  price_micro_per_mtok: amendPriceMicro.toString(),
                                  capacity_mtok: amendCapacity.trim(),
                                }),
                              );
                            }}
                            className="text-[#1743FF] hover:underline disabled:text-[#C9C9C9]"
                          >
                            {busy === row.listing_id ? "signing…" : "save"}
                          </button>
                          <button type="button" onClick={() => setAmending(null)} className={`${MUTED} hover:underline`}>
                            keep
                          </button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span>{row.price_micro_per_mtok === null ? "market" : formatMicroPerMtok(BigInt(row.price_micro_per_mtok))}</span>
                        <span>
                          {formatMtok(left)} of {formatMtok(capacity)}
                        </span>
                        <span className={MUTED}>{row.status}</span>
                        <span className="flex justify-end gap-3">
                          <button
                            type="button"
                            disabled={busy !== null || !address}
                            onClick={() => {
                              setAmending(row.listing_id);
                              setAmendPrice(row.price_micro_per_mtok === null ? "" : formatMicroPerMtok(BigInt(row.price_micro_per_mtok)));
                              setAmendCapacity((capacity / 1_000_000n).toString());
                              setNotice(null);
                            }}
                            className="text-[#1743FF] hover:underline disabled:text-[#C9C9C9]"
                          >
                            amend
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null || !address}
                            onClick={() =>
                              void run(
                                row.listing_id,
                                "ask cancelled",
                                signed(`/api/listings/${row.listing_id}`, "DELETE", { action: "cancel", listing_id: row.listing_id }),
                              )
                            }
                            className="text-[#F6465D] hover:underline disabled:text-[#C9C9C9]"
                          >
                            {busy === row.listing_id ? "signing…" : "cancel"}
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {!address ? (
              <p className={`border-t border-[#E4E4E4] px-4 py-3 text-[13px] ${MUTED}`}>
                Connect your seller wallet to see and change the asks your provider keys post.
              </p>
            ) : null}
          </>
        ) : null}

        {tab === "Trade History" && !needsKey ? (
          <>
            <div className={HEAD}>
              {["Time, UTC", "Market", "Side", "Price, USD / MTok", "Size, MTok", "Paid or received"].map((head) => (
                <span key={head}>{head}</span>
              ))}
            </div>
            {history.length === 0 ? (
              <p className="border-t border-[#E4E4E4] px-4 py-5 text-[14px] text-[#757575] md:border-t-0">No fills on this key yet.</p>
            ) : (
              <div className={SCROLL}>
                {history.map((row, index) => (
                  <div key={`${row.at}-${index}`} className={ROW}>
                    <span className={MUTED}>{stampFormat.format(new Date(row.at))}</span>
                    <span>{row.model}</span>
                    <span className={row.side === "buy" ? "text-[#2EBD85]" : "text-[#F6465D]"}>{row.side === "buy" ? "Buy" : "Sell"}</span>
                    <span>{formatMicroPerMtok(BigInt(row.price_micro_per_mtok))}</span>
                    <span>{formatMtok(BigInt(row.tokens))}</span>
                    <span>
                      {row.side === "buy" ? "paid " : "received "}
                      {formatUsd(BigInt(row.amount_usd_micro))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === "Venue Fills" ? (
          venueFills.length === 0 ? (
            <p className="border-t border-[#E4E4E4] px-4 py-5 text-[14px] text-[#757575]">The venue has not printed a fill for {model} yet.</p>
          ) : (
            <div className={SCROLL}>
              {venueFills.map((fill) => (
                <div key={`${fill.listing_id}-${fill.created_at}`} className={ROW}>
                  <span className={MUTED}>{stampFormat.format(new Date(fill.created_at))}</span>
                  <span>{model}</span>
                  <span>{formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}</span>
                  <span>{formatMtok(BigInt(fill.tokens))}</span>
                  <span className="md:col-span-2">{formatUsd(charge(BigInt(fill.tokens), BigInt(fill.price_micro_per_mtok)))}</span>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
