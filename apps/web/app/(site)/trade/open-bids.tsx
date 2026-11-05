"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { formatMicroPerMtok, formatMtok, formatUsd } from "../../../lib/price.ts";

const MUTED = "text-[#757575]";
const POLL_MS = 15_000;

const listSchema = z.object({
  data: z.array(
    z.object({
      bid_id: z.string(),
      model: z.string(),
      tokens: z.string(),
      price_micro_per_mtok: z.string(),
      hold_usd_micro: z.string(),
      created_at: z.string(),
    }),
  ),
});
const failureSchema = z.object({ error: z.object({ message: z.string() }) });

export function OpenBids({
  routerKey,
  model,
  version,
  onChange,
}: {
  routerKey: string;
  model: string;
  version: number;
  onChange: () => void;
}) {
  const [rows, setRows] = useState<z.infer<typeof listSchema>["data"]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/bids?model=${encodeURIComponent(model)}`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${routerKey}` },
    }).catch(() => null);
    const parsed = listSchema.safeParse(res?.ok ? await res.json().catch(() => null) : null);
    if (parsed.success) setRows(parsed.data.data);
  }, [routerKey, model]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load, version]);

  const cancel = async (bidId: string) => {
    setBusy(bidId);
    setFailure(null);
    try {
      const res = await fetch(`/api/v1/bids/${bidId}`, { method: "DELETE", headers: { authorization: `Bearer ${routerKey}` } });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        setFailure(failureSchema.safeParse(body).data?.error.message ?? `cancel failed (${res.status})`);
      }
      await load();
      onChange();
    } catch {
      setFailure("the cancel did not reach the venue; retry");
    } finally {
      setBusy(null);
    }
  };

  if (rows.length === 0 && failure === null) return null;

  return (
    <div className="border-t border-[#D9D9D9] pt-3">
      <p className="text-[13px] text-[#1E1E1E]">[ your bids on {model} ]</p>
      {rows.map((row) => (
        <div key={row.bid_id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[#D9D9D9] py-2 text-[13px]">
          <span className="tabular-nums text-[#2EBD85]">{formatMicroPerMtok(BigInt(row.price_micro_per_mtok))}</span>
          <span className={`tabular-nums ${MUTED}`}>
            {formatMtok(BigInt(row.tokens))} MTok · holds {formatUsd(BigInt(row.hold_usd_micro))}
          </span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void cancel(row.bid_id)}
            className="text-[#F6465D] hover:underline disabled:text-[#C9C9C9]"
          >
            {busy === row.bid_id ? "cancelling…" : "cancel"}
          </button>
        </div>
      ))}
      {failure ? <p className="mt-2 text-[13px] text-[#F6465D]">{failure}</p> : null}
    </div>
  );
}
