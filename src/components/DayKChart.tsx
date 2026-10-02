import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time,
} from "lightweight-charts";
import type { KlineRow } from "../utils/parseCsv";
import { aggregateDaily, type DailyRow } from "../utils/tradingDay";

type Props = {
  data: KlineRow[];
  selectedDay?: string;
  presetDaily?: DailyRow[];
  theme: "light" | "dark";
};

export default function DayKChart({ data, selectedDay, theme, presetDaily }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const dailyData = useMemo(() => presetDaily ?? aggregateDaily(data), [data, presetDaily]);

  // Keep the same chart when the minute-chart cursor changes days.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { fontFamily: '"Space Grotesk", system-ui, sans-serif' },
      localization: { locale: "zh-CN", dateFormat: "yyyy-MM-dd" },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: true, timeVisible: false, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      upColor: "#e03a2d", downColor: "#1a9a8f",
      borderUpColor: "#e03a2d", borderDownColor: "#1a9a8f",
      wickUpColor: "#e03a2d", wickDownColor: "#1a9a8f",
      priceLineVisible: false, lastValueVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, [], { zOrder: "top", autoScale: true });
    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      markersRef.current?.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: theme === "dark" ? "#0b0f1a" : "#f6f7fb" },
        textColor: theme === "dark" ? "#f6f7fb" : "#0b0f1a",
      },
      grid: {
        vertLines: { color: theme === "dark" ? "#1a2540" : "#d8dff0" },
        horzLines: { color: theme === "dark" ? "#1a2540" : "#d8dff0" },
      },
    });
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    const markers = markersRef.current;
    const series = seriesRef.current;
    if (!chart || !markers || !series) return;
    const index = dailyData.findIndex(row => row.dayKey === selectedDay);
    markers.setMarkers([]);
    // Limit the preview to the cursor day: logical viewport boundaries alone
    // can expose part of the next candle and include its prices in autoscale.
    // Date strings also avoid converting local midnight into the previous UTC day.
    series.setData(index < 0 ? dailyData : dailyData.slice(0, index + 1));
    if (index < 0) {
      markers.setMarkers([]);
      if (dailyData.length) chart.timeScale().fitContent();
      return;
    }
    markers.setMarkers([{
      time: dailyData[index].time, position: "aboveBar", shape: "arrowDown",
      color: theme === "dark" ? "#f8fafc" : "#0b0f1a", size: 1,
    }]);
    // Only the target day and its history are visible; the next day's bar is excluded.
    chart.timeScale().setVisibleLogicalRange({ from: index - 19, to: index + 1 });
  }, [dailyData, selectedDay, theme]);

  return <div ref={containerRef} className="h-full w-full" data-testid="daily-chart" aria-label={`日K定位：${selectedDay ?? "暂无"}`} />;
}
