"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { formatMicroPerMtok, formatMtok } from "../lib/price";

const POLL_MS = 30_000;
const STALE_S = 600;

const statusSchema = z.object({
  keeper_last_post_s: z.number().nullable(),
  markets: z.array(z.object({ model: z.string(), index_micro_per_mtok: z.string().nullable(), open: z.boolean() })),
  payouts: z.object({ pending: z.number(), scheduled: z.number() }),
  venue: z.object({ fills_24h: z.number(), volume_24h_tokens: z.string(), open_asks: z.number() }),
});

function ago(seconds: number): string {
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}

export function LiveStrip() {
  const [status, setStatus] = useState<z.infer<typeof statusSchema> | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/v1/status", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => {
          if (!alive) return;
          const parsed = statusSchema.safeParse(body);
          setStatus(parsed.success ? parsed.data : null);
          setDown(!parsed.success);
        })
        .catch(() => {
          if (alive) setDown(true);
        });
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const lastPost = status?.keeper_last_post_s ?? null;
  const keeperUp = lastPost !== null && lastPost <= STALE_S;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 py-2 text-[12px] tabular-nums text-[#757575]">
      <span className="flex items-center gap-1.5 text-[#1E1E1E]">
        <span aria-hidden className={`inline-block h-[7px] w-[7px] rounded-full ${keeperUp ? "bg-[#2EBD85]" : "bg-[#F6465D]"}`} />
        {status === null
          ? down
            ? "venue status unreachable"
            : "reading the venue…"
          : keeperUp && lastPost !== null
            ? `keeper posted ${ago(lastPost)} ago`
            : "keeper quiet: no fresh index"}
      </span>
      {status?.markets.map((market) => (
        <span key={market.model}>
          {market.model}{" "}
          <span className={market.open ? "text-[#1E1E1E]" : ""}>
            {market.index_micro_per_mtok ? formatMicroPerMtok(BigInt(market.index_micro_per_mtok)) : "—"}
          </span>
          {market.open ? "" : " · closed"}
        </span>
      ))}
      {status ? (
        <span>
          {status.venue.fills_24h} fills, {formatMtok(BigInt(status.venue.volume_24h_tokens))} MTok in 24h · {status.venue.open_asks} asks
        </span>
      ) : null}
      {status ? (
        <span>
          payouts {status.payouts.scheduled} scheduled, {status.payouts.pending} pending
        </span>
      ) : null}
    </div>
  );
}
