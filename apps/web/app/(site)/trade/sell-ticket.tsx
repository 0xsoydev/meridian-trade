"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BaseError } from "viem";
import { useConnection, useSignMessage } from "wagmi";
import { z } from "zod";
import { formatMicroPerMtok, formatMtok, parseUsd } from "../../../lib/price.ts";

const MUTED = "text-[#757575]";
const BUTTON =
  "flex h-[34px] w-full items-center justify-center bg-black text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4] disabled:text-white";
const INPUT =
  "h-[34px] w-full border border-[#CECECE] bg-white px-2.5 text-[14px] tabular-nums text-[#1E1E1E] outline-none focus:border-[#1743FF]";

const listingSchema = z.object({
  listing_id: z.string(),
  rail: z.string(),
  model: z.string(),
  price_micro_per_mtok: z.string().nullable(),
  capacity_tokens: z.string(),
  used_tokens: z.string(),
  reserved_tokens: z.string(),
  status: z.string(),
});
const mineSchema = z.object({ verified: z.boolean(), listings: z.array(listingSchema) });
const failureSchema = z.object({ error: z.object({ message: z.string() }) });

type Listing = z.infer<typeof listingSchema>;

export function SellTicket({ model, rails, onChange }: { model: string; rails: string[]; onChange: () => void }) {
  const { ready, authenticated, login } = usePrivy();
  const { address } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  const [mine, setMine] = useState<z.infer<typeof mineSchema> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [rail, setRail] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [capacity, setCapacity] = useState("10");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    const res = await fetch(`/api/listings?seller=${address}`, { cache: "no-store" }).catch(() => null);
    const parsed = mineSchema.safeParse(res?.ok ? await res.json().catch(() => null) : null);
    if (parsed.success) setMine(parsed.data);
    else setNotice({ ok: false, text: "your listings did not load; reload to retry" });
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  const listings = mine?.listings ?? [];
  const sources = new Map<string, string>();
  for (const row of listings) {
    if (row.status !== "invalid" && rails.includes(row.rail) && !sources.has(row.rail)) sources.set(row.rail, row.listing_id);
  }
  const chosen = rail !== null && sources.has(rail) ? rail : ([...sources.keys()][0] ?? null);
  const asks = listings.filter((row) => row.model === model && row.status !== "cancelled");
  const priceMicro = parseUsd(price);
  const valid = priceMicro !== null && priceMicro > 0n && /^[1-9]\d{0,12}$/.test(capacity.trim());

  const submit = async (method: "POST" | "PATCH" | "DELETE", url: string, fields: Record<string, string | null>, credential?: unknown) => {
    if (!address || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const message = JSON.stringify({
        domain: window.location.host,
        issued_at: new Date().toISOString(),
        client_nonce: crypto.randomUUID(),
        ...fields,
      });
      const signed = { address, message, signature: await signMessage({ message }) };
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential === undefined ? { signed } : { signed, credential }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(failureSchema.safeParse(body).data?.error.message ?? `request failed (${res.status})`);
      setNotice({ ok: true, text: method === "DELETE" ? "ask cancelled" : method === "PATCH" ? "ask updated" : "ask placed" });
      setEditing(null);
      await load();
      onChange();
    } catch (cause) {
      setNotice({
        ok: false,
        text: cause instanceof BaseError ? cause.shortMessage : cause instanceof Error ? cause.message : "the request failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const place = () => {
    if (!valid || priceMicro === null) return;
    if (editing) {
      void submit("PATCH", `/api/listings/${editing}`, {
        action: "amend",
        listing_id: editing,
        price_micro_per_mtok: priceMicro.toString(),
        capacity_mtok: capacity.trim(),
      });
      return;
    }
    if (chosen === null) return;
    void submit(
      "POST",
      "/api/listings",
      { action: "list", rail: chosen, model, capacity_mtok: capacity.trim(), price_micro_per_mtok: priceMicro.toString() },
      { kind: "stored", listing_id: sources.get(chosen) },
    );
  };

  const edit = (row: Listing) => {
    setEditing(row.listing_id);
    setPrice(row.price_micro_per_mtok === null ? "" : formatMicroPerMtok(BigInt(row.price_micro_per_mtok)));
    setCapacity((BigInt(row.capacity_tokens) / 1_000_000n).toString());
    setNotice(null);
  };

  if (!authenticated || !address) {
    return (
      <div className="mt-4 space-y-3">
        <p className={`text-[13px] leading-5 ${MUTED}`}>
          Selling places an ask from your seller wallet, using a key you already stored on Sell.
        </p>
        <button type="button" disabled={!ready} onClick={() => login()} className={BUTTON}>
          Connect wallet
        </button>
      </div>
    );
  }

  if (mine === null || rails.length === 0) {
    return <p className={`mt-4 text-[13px] ${notice ? "text-[#F6465D]" : MUTED}`}>{notice?.text ?? "Loading your listings…"}</p>;
  }

  if (!mine.verified || sources.size === 0) {
    return (
      <div className="mt-4 space-y-3">
        <p className="text-[14px] leading-5 text-[#1E1E1E]">
          {mine.verified ? `None of your stored keys can serve ${model}.` : "This wallet is not a verified seller yet."}
        </p>
        <p className={`text-[13px] leading-5 ${MUTED}`}>
          {mine.verified
            ? `Add a ${rails.join(", ")} key on Sell once; after that you sell ${model} from here.`
            : "Verify once on Sell, add a key, and sell from here after that."}
        </p>
        <Link href="/sell" className={BUTTON}>
          {mine.verified ? "Add a key on Sell" : "Verify on Sell"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {asks.length > 0 ? (
        <div>
          <p className="text-[13px] text-[#1E1E1E]">[ your asks on {model} ]</p>
          {asks.map((row) => (
            <div
              key={row.listing_id}
              className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[#D9D9D9] py-2 text-[13px] ${editing === row.listing_id ? "bg-white" : ""}`}
            >
              <span className="tabular-nums text-[#1E1E1E]">
                {row.price_micro_per_mtok === null ? "market" : formatMicroPerMtok(BigInt(row.price_micro_per_mtok))}
              </span>
              <span className={`tabular-nums ${MUTED}`}>
                {formatMtok(BigInt(row.capacity_tokens) - BigInt(row.used_tokens) - BigInt(row.reserved_tokens))} of{" "}
                {formatMtok(BigInt(row.capacity_tokens))} MTok left · {row.status}
              </span>
              <span className="flex gap-3">
                <button type="button" disabled={busy} onClick={() => edit(row)} className="text-[#1743FF] hover:underline">
                  amend
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void submit("DELETE", `/api/listings/${row.listing_id}`, { action: "cancel", listing_id: row.listing_id })
                  }
                  className="text-[#F6465D] hover:underline"
                >
                  cancel
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {editing === null && sources.size > 1 ? (
        <label className="block">
          <span className={`mb-1 block text-[13px] ${MUTED}`}>Sell with your stored key on</span>
          <select value={chosen ?? ""} onChange={(event) => setRail(event.target.value)} className={INPUT}>
            {[...sources.keys()].map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block">
        <span className={`mb-1 block text-[13px] ${MUTED}`}>Limit price, USD per MTok</span>
        <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="0.05" className={INPUT} />
      </label>

      <label className="block">
        <span className={`mb-1 block text-[13px] ${MUTED}`}>{editing ? "Total capacity, MTok" : "Size, MTok"}</span>
        <input value={capacity} onChange={(event) => setCapacity(event.target.value)} inputMode="numeric" className={INPUT} />
      </label>

      <button type="button" onClick={place} disabled={busy || !valid} className={BUTTON}>
        {busy ? "Waiting for the signature…" : editing ? "Save the ask" : `Place a sell order with your ${chosen} key`}
      </button>
      {editing ? (
        <button type="button" onClick={() => setEditing(null)} className={`w-full text-center text-[13px] ${MUTED} underline`}>
          stop amending
        </button>
      ) : null}

      <p className={`text-[13px] leading-5 ${notice ? (notice.ok ? "text-[#2EBD85]" : "text-[#F6465D]") : MUTED}`}>
        {notice?.text ??
          "Your ask waits on the book at this price until a buyer takes it. It must sit at or below the rail's list price."}
      </p>
    </div>
  );
}
