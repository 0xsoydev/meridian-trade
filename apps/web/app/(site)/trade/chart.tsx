"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { BookFill } from "../../../lib/types";

export type ScaleMode = "linear" | "log" | "percent";

export type ChartPoint = {
  time: UTCTimestamp;
  value: number;
  volume: number;
  up: boolean;
};

const BAR = "rgba(23, 67, 255, 0.25)";

export function fillsToPoints(
  fills: BookFill[],
  windowMs: number | null,
  nowMs: number,
): ChartPoint[] {
  const cutoff = windowMs === null ? Number.NEGATIVE_INFINITY : nowMs - windowMs;
  const bySecond = new Map<number, { value: number; volume: number }>();
  for (let i = fills.length - 1; i >= 0; i -= 1) {
    const row = fills[i];
    if (!row) continue;
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at) || at < cutoff) continue;
    const second = Math.floor(at / 1000);
    const value = Number(row.price_micro_per_mtok) / 1e6;
    const volume = Number(row.tokens) / 1e6;
    const seen = bySecond.get(second);
    if (seen) {
      seen.value = value;
      seen.volume += volume;
    } else {
      bySecond.set(second, { value, volume });
    }
  }

  const points: ChartPoint[] = [];
  let previous: number | null = null;
  for (const second of [...bySecond.keys()].sort((a, b) => a - b)) {
    const point = bySecond.get(second);
    if (!point) continue;
    points.push({
      time: second as UTCTimestamp,
      value: point.value,
      volume: point.volume,
      up: previous === null || point.value >= previous,
    });
    previous = point.value;
  }
  return points;
}

export function FillsChart({
  points,
  scale,
  emptyNote = "no fills yet — the first trade prints here",
}: {
  points: ChartPoint[];
  scale: ScaleMode;
  emptyNote?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Area"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const drawn = useRef<ChartPoint[]>([]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const created = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#757575",
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#DCDCDC" },
      },
      rightPriceScale: {
        borderColor: "#C9C9C9",
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: "#C9C9C9",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#A3A3A3", labelBackgroundColor: "#FFFFFF" },
        horzLine: { color: "#A3A3A3", labelBackgroundColor: "#FFFFFF" },
      },
    });
    const line = created.addSeries(AreaSeries, {
      lineColor: "#1E1E1E",
      lineWidth: 1,
      topColor: "rgba(23, 67, 255, 0.12)",
      bottomColor: "rgba(23, 67, 255, 0)",
      priceLineColor: "#1743FF",
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1,
      priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
    });
    const bars = created.addSeries(HistogramSeries, {
      priceScaleId: "",
      priceFormat: { type: "volume" },
    });
    created.priceScale("").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

    chart.current = created;
    price.current = line;
    volume.current = bars;
    drawn.current = [];
    return () => {
      created.remove();
      chart.current = null;
      price.current = null;
      volume.current = null;
    };
  }, []);

  useEffect(() => {
    const line = price.current;
    const bars = volume.current;
    if (!line || !bars) return;
    const previous = drawn.current;
    const reshaped =
      previous.length === 0 ||
      points.length < previous.length ||
      previous[0]?.time !== points[0]?.time;

    if (reshaped) {
      line.setData(points.map((point) => ({ time: point.time, value: point.value })));
      bars.setData(
        points.map((point) => ({
          time: point.time,
          value: point.volume,
          color: BAR,
        })),
      );
      drawn.current = points;
      return;
    }

    let start = 0;
    while (start < previous.length) {
      const before = previous[start];
      const after = points[start];
      if (!before || !after || before.time !== after.time || before.value !== after.value || before.volume !== after.volume) break;
      start += 1;
    }
    for (let i = start; i < points.length; i += 1) {
      const point = points[i];
      if (!point) continue;
      line.update({ time: point.time, value: point.value });
      bars.update({ time: point.time, value: point.volume, color: BAR });
    }
    drawn.current = points;
  }, [points]);

  useEffect(() => {
    const current = chart.current;
    if (!current) return;
    const mode =
      scale === "log"
        ? PriceScaleMode.Logarithmic
        : scale === "percent"
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal;
    current.priceScale("right").applyOptions({ mode });
  }, [scale]);

  return (
    <div className="relative h-[360px] w-full">
      <div ref={host} className="absolute inset-0" />
      {points.length === 0 ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[14px] text-[#757575]">
          {emptyNote}
        </p>
      ) : null}
    </div>
  );
}
