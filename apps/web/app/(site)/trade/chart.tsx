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
} from "lightweight-charts";
import { candlesFromPoints, type CandlePoint, type ChartPoint } from "../../../lib/price";

export type ScaleMode = "linear" | "log" | "percent";

export const INTERVALS = [
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
] as const;

const BAR = "rgba(23, 67, 255, 0.25)";

export function FillsChart({
  points,
  bucket,
  scale,
  emptyNote = "no fills yet — the first trade prints here",
  className = "h-[360px]",
}: {
  points: ChartPoint[];
  bucket: number;
  scale: ScaleMode;
  emptyNote?: string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const drawn = useRef<ChartPoint[]>([]);
  const drawnBucket = useRef(bucket);
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
        vertLines: { color: "rgba(30, 30, 30, 0.06)" },
        horzLines: { color: "rgba(30, 30, 30, 0.06)" },
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
    const next = candlesFromPoints(points, bucket);
    const shaped =
      drawn.current.length === 0 ||
      drawnBucket.current !== bucket ||
      points.length < drawn.current.length ||
      drawn.current[0]?.time !== points[0]?.time;
    drawnBucket.current = bucket;

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
  }, [points, bucket]);

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
    <div className={`relative w-full ${className}`}>
      <div ref={host} className="absolute inset-0" />
      {points.length === 0 ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[14px] text-[#757575]">
          {emptyNote}
        </p>
      ) : null}
    </div>
  );
}
