"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
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
};

export const CANDLE_BUCKET = 60;

export type CandlePoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
  for (const second of [...bySecond.keys()].sort((a, b) => a - b)) {
    const point = bySecond.get(second);
    if (!point) continue;
    points.push({
      time: second as UTCTimestamp,
      value: point.value,
      volume: point.volume,
    });
  }
  return points;
}

export function candlesFromPoints(points: ChartPoint[]): CandlePoint[] {
  const candles: CandlePoint[] = [];
  for (const point of points) {
    const time = (Math.floor(point.time / CANDLE_BUCKET) * CANDLE_BUCKET) as UTCTimestamp;
    const last = candles.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, point.value);
      last.low = Math.min(last.low, point.value);
      last.close = point.value;
      last.volume += point.volume;
    } else {
      candles.push({ time, open: point.value, high: point.value, low: point.value, close: point.value, volume: point.volume });
    }
  }
  return candles;
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
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const drawn = useRef<ChartPoint[]>([]);
  const drawnCandles = useRef<CandlePoint[]>([]);

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
    const series = created.addSeries(CandlestickSeries, {
      upColor: "#2EBD85",
      downColor: "#F6465D",
      wickUpColor: "#2EBD85",
      wickDownColor: "#F6465D",
      borderVisible: false,
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
    candles.current = series;
    volume.current = bars;
    drawn.current = [];
    drawnCandles.current = [];
    return () => {
      created.remove();
      chart.current = null;
      candles.current = null;
      volume.current = null;
    };
  }, []);

  useEffect(() => {
    const series = candles.current;
    const bars = volume.current;
    if (!series || !bars) return;
    const next = candlesFromPoints(points);
    const shaped =
      drawn.current.length === 0 ||
      points.length < drawn.current.length ||
      drawn.current[0]?.time !== points[0]?.time;

    if (shaped) {
      series.setData(next.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      bars.setData(next.map((candle) => ({ time: candle.time, value: candle.volume, color: BAR })));
      drawn.current = points;
      drawnCandles.current = next;
      return;
    }

    const previous = drawnCandles.current;
    let start = 0;
    while (start < previous.length && start < next.length) {
      const before = previous[start];
      const after = next[start];
      if (
        !before ||
        !after ||
        before.time !== after.time ||
        before.open !== after.open ||
        before.high !== after.high ||
        before.low !== after.low ||
        before.close !== after.close ||
        before.volume !== after.volume
      ) {
        break;
      }
      start += 1;
    }
    if (start >= previous.length - 1) {
      for (let i = start; i < next.length; i += 1) {
        const candle = next[i];
        if (!candle) continue;
        series.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
        bars.update({ time: candle.time, value: candle.volume, color: BAR });
      }
    } else {
      series.setData(next.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      bars.setData(next.map((candle) => ({ time: candle.time, value: candle.volume, color: BAR })));
    }
    drawn.current = points;
    drawnCandles.current = next;
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
