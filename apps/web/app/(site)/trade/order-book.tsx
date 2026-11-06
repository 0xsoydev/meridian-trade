"use client";

import { useState } from "react";
import { charge, clockFormat, formatMicroPerMtok, formatMtok, formatUsd } from "../../../lib/price.ts";
import type { Book } from "../../../lib/types";

const MUTED = "text-[#757575]";

export function OrderBook({ book, model, listPrice }: { book: Book | null; model: string; listPrice: bigint | null }) {
  const [pane, setPane] = useState<"book" | "tape">("book");
  const asks = book?.asks ?? [];
  const bidLevels = book?.bids ?? [];
  const venueFills = book?.fills ?? [];
  const bestAsk = asks[0] ? BigInt(asks[0].price_micro_per_mtok) : null;
  const depth = asks.reduce((total, ask) => total + BigInt(ask.tokens_left), 0n);
  const bidDepth = bidLevels.reduce((total, level) => total + BigInt(level.tokens), 0n);
  const widest = [...asks.map((ask) => BigInt(ask.tokens_left)), ...bidLevels.map((level) => BigInt(level.tokens))].reduce(
    (max, size) => (size > max ? size : max),
    0n,
  );

  return (
    <div className="flex flex-col self-start rounded-[6px] border border-[#E4E4E4] bg-white lg:h-[calc(100svh-277px)] lg:min-h-[423px]">
      <div className="flex items-center gap-5 border-b border-[#ECECEC] px-4 py-2.5 text-[14px]">
        {(["book", "tape"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setPane(item)}
            aria-pressed={pane === item}
            className={`${
              pane === item
                ? "font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                : "text-[#757575] hover:text-[#1E1E1E]"
            }`}
          >
            {item === "book" ? "Order book" : "Trades"}
          </button>
        ))}
        <span className={`ml-auto text-[12px] ${MUTED}`}>
          {pane === "book" ? `${asks.length} asks` : `${venueFills.length} prints`}
        </span>
      </div>

      {pane === "book" ? (
        <>
          <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-[#757575]">
            <span>Price</span>
            <span>Size (MTok)</span>
            <span>Total</span>
          </div>
          <div className="max-h-[420px] min-h-0 flex-1 overflow-auto lg:max-h-none">
            {[...asks].reverse().map((ask) => (
              <div
                key={ask.offer_id ?? ask.listing_id}
                title={`${ask.kind === "resale" ? "resale, " : ""}${ask.rail}${ask.verifiable ? ", TEE" : ""}`}
                className="flex items-center justify-between gap-3 px-4 py-[5px] text-[13px] tabular-nums"
                style={{
                  background: `linear-gradient(90deg, rgba(246, 70, 93, ${widest === 0n ? 0 : (Number(BigInt(ask.tokens_left)) / Number(widest)) * 0.12}), rgba(246, 70, 93, 0) 100%)`,
                }}
              >
                <span className="text-[#F6465D]">{formatMicroPerMtok(BigInt(ask.price_micro_per_mtok))}</span>
                <span className="text-[#1E1E1E]">{formatMtok(BigInt(ask.tokens_left))}</span>
                <span className={MUTED}>
                  {formatUsd(charge(BigInt(ask.tokens_left), BigInt(ask.price_micro_per_mtok)))}
                </span>
              </div>
            ))}
            {asks.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[#757575]">no asks yet for {model}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-y border-[#ECECEC] px-4 py-2 text-[13px]">
            <span className={MUTED}>Best ask</span>
            <span className="tabular-nums text-[#1E1E1E]">
              {bestAsk !== null ? formatMicroPerMtok(bestAsk) : "—"}
            </span>
            <span className="tabular-nums text-[#F6465D]">
              {bestAsk !== null && listPrice !== null && listPrice > 0n
                ? `${(Number(((listPrice - bestAsk) * 10_000n) / listPrice) / 100).toFixed(2)}% under list`
                : ""}
            </span>
          </div>

          {bidLevels.map((level) => (
            <div
              key={level.price_micro_per_mtok}
              className="flex items-center justify-between gap-3 px-4 py-[5px] text-[13px] tabular-nums"
              style={{
                background: `linear-gradient(90deg, rgba(46, 189, 133, ${widest === 0n ? 0 : (Number(BigInt(level.tokens)) / Number(widest)) * 0.16}), rgba(46, 189, 133, 0) 100%)`,
              }}
            >
              <span className="text-[#2EBD85]">{formatMicroPerMtok(BigInt(level.price_micro_per_mtok))}</span>
              <span className="text-[#1E1E1E]">{formatMtok(BigInt(level.tokens))}</span>
              <span className={MUTED}>
                {formatUsd(charge(BigInt(level.tokens), BigInt(level.price_micro_per_mtok)))}
              </span>
            </div>
          ))}

          <p className="px-4 py-2 text-[12px] text-[#757575]">
            asks: {formatMtok(depth)} MTok · bids: {bidLevels.length === 0 ? "none yet; place a limit buy below the best ask" : `${formatMtok(bidDepth)} MTok`}
          </p>
        </>
      ) : (
        <div className="max-h-[420px] min-h-0 flex-1 overflow-auto lg:max-h-none">
          {venueFills.slice(0, 40).map((fill, index) => {
            const next = venueFills[index + 1];
            const up = next === undefined || BigInt(fill.price_micro_per_mtok) >= BigInt(next.price_micro_per_mtok);
            return (
              <div key={`${fill.listing_id}-${fill.created_at}`} className="flex items-center justify-between gap-3 border-t border-[#ECECEC] px-4 py-[5px] text-[13px] tabular-nums">
                <span className={MUTED}>{timeShort(fill.created_at)}</span>
                <span className={up ? "text-[#2EBD85]" : "text-[#F6465D]"}>
                  {formatMicroPerMtok(BigInt(fill.price_micro_per_mtok))}
                </span>
                <span className={MUTED}>{formatMtok(BigInt(fill.tokens))} MTok</span>
              </div>
            );
          })}
          {venueFills.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-[#757575]">
              the venue has not printed a fill for {model} yet
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function timeShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return clockFormat.format(date);
}
