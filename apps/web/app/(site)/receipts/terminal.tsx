"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clockFormat, formatMtok, formatUsd } from "../../../lib/price.ts";
import {
  HEARTBEAT_S,
  MAX_MOVE_BPS,
  POST_MOVE_BPS,
  minuteOf,
  readRollups,
  recomputeIndex,
  type PublishedRollup,
} from "../../../lib/rollup.ts";
import type { MarketIndex, ModelRow, ReceiptsConfig } from "../../../lib/types";

const ROWS = 20;

const MUTED = "text-[#757575]";

const minuteFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

const LINK = "text-[#1743FF] hover:underline";

export function Receipts({
  initialModel,
  config,
  latest,
  markets,
  windowMin,
}: {
  initialModel: string;
  config: ReceiptsConfig;
  latest: MarketIndex[];
  markets: string[];
  windowMin: number;
}) {
  const router = useRouter();
  const [model, setModel] = useState(initialModel);
  const [rollups, setRollups] = useState<PublishedRollup[] | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setClock(clockFormat.format(new Date())), 1000);
    setClock(clockFormat.format(new Date()));
    return () => window.clearInterval(id);
  }, []);

  const recompute = useCallback(async () => {
    if (!config.ok) return;
    setRecomputing(true);
    try {
      const [published, body] = await Promise.all([
        readRollups({
          mirrorUrl: config.mirrorUrl,
          topicId: config.topicId,
          payer: config.payer,
          sinceMinute: minuteOf(Date.now()) - windowMin,
        }),
        fetch("/api/v1/models").then((res) =>
          res.ok ? (res.json() as Promise<{ data: ModelRow[] }>) : Promise.reject(new Error(`${res.status}`)),
        ),
      ]);
      setRollups(published);
      setModels(body.data);
      setProblem(null);
    } catch {
      setProblem("the public log did not answer — retry");
    } finally {
      setRecomputing(false);
    }
  }, [config, windowMin]);

  useEffect(() => {
    void recompute();
  }, [recompute]);

  const hashscan = config.ok ? `https://hashscan.io/${config.network}` : null;
  const mirror = config.ok ? `${config.mirrorUrl}/api/v1/topics/${config.topicId}/messages` : null;

  const shown = useMemo(
    () => [...(rollups ?? [])].sort((a, b) => b.seq - a.seq).slice(0, ROWS),
    [rollups],
  );
  const mine = useMemo(() => (rollups ?? []).filter((row) => row.rollup.model === model), [rollups, model]);
  const reference = useMemo(
    () => models.find((row) => row.id === model)?.reference_blended_micro_per_mtok ?? null,
    [models, model],
  );
  const onChain = useMemo(
    () => latest.find((row) => row.model === model)?.priceMicroPerMtok ?? null,
    [latest, model],
  );

  const verdict = useMemo(() => {
    if (rollups === null || reference === null) return null;
    return recomputeIndex({
      rollups: mine.map((row) => row.rollup),
      reference: BigInt(reference),
      latest: BigInt(onChain ?? "0"),
    });
  }, [rollups, reference, mine, onChain]);

  const average = verdict && verdict.state !== "no-input" ? verdict.twap : null;
  const band = verdict && "band" in verdict ? verdict.band : null;
  const next = verdict?.state === "sync" || verdict?.state === "pending" ? verdict.next : null;

  const verdictLine = (() => {
    if (problem) return <span className="text-[#F6465D]">{problem}</span>;
    if (!config.ok) return <span className="text-[#F6465D]">recompute is offline: {config.reason}</span>;
    if (verdict === null) return <span className={MUTED}>reading the public log…</span>;
    if (verdict.state === "no-input")
      return <span className={MUTED}>no rollups for {model} in the last {windowMin} min — nothing to recompute yet</span>;
    if (verdict.state === "no-post") return <span className={MUTED}>waiting for the first index post</span>;
    if (verdict.state === "sync")
      return (
        <span className="text-[#2EBD85]">
          ✓ in sync · 0 bps — the chain already shows what the public log computes
        </span>
      );
    return (
      <span className="text-[#1E1E1E]">
        {verdict.next > verdict.latest ? "↑" : "↓"} the next post moves {verdict.diffBps.toString()} bps to{" "}
        {formatUsd(verdict.next)} — posts when the move clears {POST_MOVE_BPS.toString()} bps or after{" "}
        {Number(HEARTBEAT_S) / 60} minutes
      </span>
    );
  })();

  return (
    <section>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[6px] border border-[#CECECE] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-5 text-[14px]">
          {markets.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setModel(id)}
              aria-pressed={id === model}
              className={`${
                id === model
                  ? "font-semibold text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-4"
                  : "text-[#757575] hover:text-[#1E1E1E]"
              }`}
            >
              {id}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
          <Stat label="TWAP, window" value={average === null ? "—" : formatUsd(average)} />
          <Stat label="Clamp band" value={band === null ? "—" : `${formatUsd(band[0])} – ${formatUsd(band[1])}`} />
          <Stat label="Keeper next" value={next === null ? "—" : formatUsd(next)} />
          <Stat label="On chain" value={onChain === null ? "—" : formatUsd(BigInt(onChain))} />
        </div>

        <div className="ml-auto flex items-center gap-5 text-[13px]">
          <button type="button" onClick={() => router.refresh()} className={LINK}>
            refresh page data
          </button>
          <span className={`tabular-nums ${MUTED}`}>{clock ?? "--:--:--"} UTC</span>
        </div>
      </div>

      <div className="mt-5 rounded-[6px] border border-[#CECECE] bg-white">
        <div className="flex flex-wrap items-center gap-4 border-b border-[#D9D9D9] px-4 py-2.5">
          <button
            type="button"
            onClick={() => void recompute()}
            disabled={!config.ok || recomputing}
            className="rounded-[6px] bg-black px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40"
          >
            {recomputing ? "recomputing…" : "Recompute from the public log"}
          </button>
          <span className={`text-[13px] ${MUTED}`}>
            {config.ok === false
              ? "recompute is offline"
              : problem !== null
                ? "the public log is unreachable"
                : rollups === null
                  ? "reading the public log…"
                  : `${mine.length} rollups for ${model} in the last ${windowMin} min`}
          </span>
        </div>

        <p aria-live="polite" className="px-4 py-3 text-[13px] leading-[18px]">
          {verdictLine}
        </p>

        <details className="border-t border-[#D9D9D9] px-4 py-2.5">
          <summary className={`cursor-pointer text-[13px] ${LINK}`}>raw inputs</summary>
          <pre className="mt-2 overflow-x-auto rounded-[6px] border border-[#CECECE] bg-white p-3 text-[12px] leading-[16px] text-[#1E1E1E]">
            {JSON.stringify(
              {
                model,
                windowMinutes: windowMin,
                referenceBlendedMicroPerMtok: reference,
                onChainPriceMicroPerMtok: onChain,
                rollups: mine.map(({ seq, rollup }) => ({ seq, ...rollup })),
                constants: {
                  maxMoveBps: MAX_MOVE_BPS.toString(),
                  postMoveBps: POST_MOVE_BPS.toString(),
                  heartbeatSeconds: HEARTBEAT_S.toString(),
                },
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>

      <div className="mt-5 overflow-hidden rounded-[6px] border border-[#CECECE] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D9D9D9] px-4 py-2.5">
          <p className="text-[14px] font-semibold text-[#1E1E1E]">Minute rollups</p>
          {mirror ? (
            <a href={mirror} target="_blank" rel="noreferrer" className={`text-[13px] ${LINK}`}>
              source: mirror ↗
            </a>
          ) : null}
        </div>
        <div className="overflow-x-auto px-4">
          <table className="w-full whitespace-nowrap text-left text-[13px] [&_td]:pr-4 [&_th]:pr-4">
            <thead>
              <tr className={MUTED}>
                <th scope="col" className="py-1.5 text-[11px] font-normal">UTC</th>
                <th scope="col" className="py-1.5 text-[11px] font-normal">model</th>
                <th scope="col" className="py-1.5 text-[11px] font-normal">fills</th>
                <th scope="col" className="py-1.5 text-[11px] font-normal">MTok</th>
                <th scope="col" className="py-1.5 text-[11px] font-normal">VWAP</th>
                <th scope="col" className="py-1.5 text-[11px] font-normal">charge</th>
                <th scope="col" className="py-1.5 text-[11px] font-normal">seq</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ seq, rollup }) => (
                <tr key={seq} id={`r-${rollup.minute}-${rollup.model}`} className="border-t border-[#D9D9D9]">
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">
                    {minuteFormat.format(new Date(rollup.minute * 60_000))}
                  </td>
                  <td className="py-2.5 text-[#1E1E1E]">{rollup.model}</td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">{rollup.fills}</td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">
                    {formatMtok(BigInt(rollup.mixed_tokens))} MTok
                  </td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">{formatUsd(BigInt(rollup.vwap_micro_per_mtok))}</td>
                  <td className="py-2.5 tabular-nums text-[#1E1E1E]">{formatUsd(BigInt(rollup.charge_usd_micro))}</td>
                  <td className="py-2.5 text-[#1E1E1E]">
                    {hashscan && config.ok ? (
                      <a href={`${hashscan}/topic/${config.topicId}`} target="_blank" rel="noreferrer" className={LINK}>
                        {seq} ↗
                      </a>
                    ) : (
                      <span className="tabular-nums">{seq}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {config.ok === false ? (
            <p className="py-6 text-center text-[13px] text-[#757575]">
              the public log is not configured on this deployment
            </p>
          ) : rollups === null && problem === null ? (
            <p className="py-6 text-center text-[13px] text-[#757575]">reading the public log…</p>
          ) : null}
          {rollups !== null && shown.length === 0 && !problem ? (
            <p className="py-6 text-center text-[13px] text-[#757575]">
              the keeper publishes a rollup for each minute with fills. nothing yet.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] leading-4 text-[#757575]">{label}</p>
      <p className="text-[14px] font-semibold tabular-nums text-[#1E1E1E]">{value}</p>
    </div>
  );
}
