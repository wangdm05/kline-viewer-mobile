import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  type IChartApi,
  type Logical,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { KlineRow } from "../utils/parseCsv";
import TagEditor from "./TagEditor";
import { createId } from "../utils/id";
import { tradingDayKey, tradingDaySegments } from "../utils/tradingDay";
import { drawingStorageKey, templateStorageKey, normalizeTitle, parseDrawings, parseTemplates,
  rectangleBounds, resizeDrawing, type Drawing as Line, type DrawingPoint as LinePoint,
  type DrawingHandle, type TagTemplate } from "../utils/drawings";
import { barIndex, moveDrawingTimes, openInterestData, visibleExtrema } from "../utils/chartMath";
import { visibleSwingPoints, placeSwingLabels, type LabelBox, type LabelSegment } from "../utils/swingPoints";

type Props = {
  data: KlineRow[];
  tradingDays: string[];
  showVolume: boolean;
  showOpenInterest: boolean;
  theme: "light" | "dark";
  drawMode: "select" | "trend" | "horiz" | "rect";
  onDrawModeChange: (mode: Props["drawMode"]) => void;
  drawColor: string;
  onHover: (row?: KlineRow) => void;
};

const candleColors = {
  light: {
    up: "#1a9a8f",
    down: "#e06533",
    nightUp: "#23b4a7",
    nightDown: "#f07a49",
    wick: "#25314d",
  },
  dark: {
    up: "#79d36f",
    down: "#f05d6b",
    nightUp: "#7ee5d7",
    nightDown: "#ff8a9a",
    wick: "#c9d1ff",
  },
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatTick = (
  time: Time,
  type: TickMarkType,
  dayOpenSet: Set<string>
) => {
  const date = new Date((time as number) * 1000);
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  const tDayKey = tradingDayKey(date);
  const isNineOpen = date.getHours() === 9 && date.getMinutes() === 0;
  const isNightOpen = date.getHours() === 21 && date.getMinutes() === 0;
  const hasNightOpen = dayOpenSet.has(tDayKey);
  const showOpenDate =
    (isNightOpen && hasNightOpen) ||
    (isNineOpen && !hasNightOpen);
  switch (type) {
    case TickMarkType.Year:
      return `${y}`;
    case TickMarkType.Month:
      return `${y}-${m}`;
    case TickMarkType.DayOfMonth:
      return `${m}-${d}`;
    case TickMarkType.Time:
      return showOpenDate ? `${m}-${d} ${hh}:${mm}` : `${hh}:${mm}`;
    case TickMarkType.TimeWithSeconds:
      return showOpenDate ? `${m}-${d} ${hh}:${mm}` : `${hh}:${mm}:${ss}`;
    default:
      return showOpenDate ? `${m}-${d} ${hh}:${mm}` : `${hh}:${mm}`;
  }
};

const formatCrosshairTime = (time: Time) => {
  const date = new Date((time as number) * 1000);
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
};

type DragState =
  | { id: string; kind: "move"; startTime: UTCTimestamp; startPrice: number; start: Line }
  | { id: string; kind: DrawingHandle };

const readLines = (): Line[] => {
  try { return parseDrawings(localStorage.getItem(drawingStorageKey)); }
  catch { return []; }
};
const readTemplates = (): TagTemplate[] => {
  try { return parseTemplates(localStorage.getItem(templateStorageKey)); }
  catch { return []; }
};

export default function KlineChart({
  data,
  tradingDays,
  showVolume,
  showOpenInterest,
  theme,
  drawMode,
  drawColor,
  onDrawModeChange,
  onHover,
}: Props) {
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const topChartRef = useRef<IChartApi | null>(null);
  const bottomChartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const oiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fittedDataRef = useRef<KlineRow[] | null>(null);
  const dataRef = useRef<KlineRow[]>(data);
  const stripes = useMemo(() => tradingDaySegments(data, tradingDays), [data, tradingDays]);
  const stripesRef = useRef(stripes);
  const dayOpenRef = useRef<Set<string>>(new Set());
  const themeRef = useRef(theme);
  const onHoverRef = useRef(onHover);
  const drawStripesRef = useRef<(() => void) | null>(null);
  useEffect(() => { stripesRef.current = stripes; drawStripesRef.current?.(); }, [stripes]);
  const [lines, setLines] = useState<Line[]>(readLines);
  const [tagTitle, setTagTitle] = useState("震荡整理");
  const [tagColor, setTagColor] = useState("#3b82f6");
  const [templates, setTemplates] = useState<TagTemplate[]>(readTemplates);
  const [templateSaveError, setTemplateSaveError] = useState(false);
  const [tagNotice, setTagNotice] = useState("");
  const tagStyleRef = useRef({ title: tagTitle, color: tagColor });
  const [extrema, setExtrema] = useState<ReturnType<typeof visibleExtrema>>(null);
  const [swingInfo, setSwingInfo] = useState({ labels: 0, details: [] as string[] });
  const [saveError, setSaveError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftLine, setDraftLine] = useState<Line | null>(null);
  const linesRef = useRef<Line[]>([]);
  const selectedRef = useRef<string | null>(null);
  const draftRef = useRef<Line | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const drawModeRef = useRef(drawMode);
  const drawColorRef = useRef(drawColor);
  const dataMap = useMemo(() => {
    const map = new Map<number, KlineRow>();
    data.forEach((row) => map.set(row.time, row));
    return map;
  }, [data]);
  const dataMapRef = useRef(dataMap);

  useEffect(() => {
    linesRef.current = lines;
    try {
      localStorage.setItem(drawingStorageKey, JSON.stringify(lines));
      setSaveError(false);
    } catch { setSaveError(true); }
  }, [lines]);

  useEffect(() => {
    tagStyleRef.current = { title: tagTitle, color: tagColor };
  }, [tagTitle, tagColor]);

  useEffect(() => {
    try {
      localStorage.setItem(templateStorageKey, JSON.stringify(templates));
      setTemplateSaveError(false);
    } catch { setTemplateSaveError(true); }
  }, [templates]);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    draftRef.current = draftLine;
  }, [draftLine]);

  useEffect(() => {
    dataRef.current = data;
    const dayOpen = new Set<string>();
    for (const row of data) {
      const date = new Date(row.time * 1000);
      if (date.getHours() === 21 && date.getMinutes() === 0) {
        dayOpen.add(tradingDayKey(date));
      }
    }
    dayOpenRef.current = dayOpen;
  }, [data]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    drawModeRef.current = drawMode;
    setDraftLine(null);
    if (drawMode !== "select") setSelectedId(null);
    dragRef.current = null;
  }, [drawMode]);

  useEffect(() => {
    drawColorRef.current = drawColor;
    setLines(prev => prev.map(line => line.id === selectedRef.current ? { ...line, color: drawColor } : line));
    setDraftLine(prev => prev ? { ...prev, color: drawColor } : prev);
  }, [drawColor]);

  useEffect(() => {
    dataMapRef.current = dataMap;
  }, [dataMap]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape") {
        setDraftLine(null);
        setSelectedId(null);
        onDrawModeChange("select");
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedRef.current) return;
        event.preventDefault();
        setLines((prev) => prev.filter((line) => line.id !== selectedRef.current));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    drawStripesRef.current?.();
  }, [lines, draftLine, selectedId]);

  const screenToPoint = (x: number, y: number): LinePoint | null => {
    if (!topChartRef.current || !candleRef.current) return null;
    const scale = topChartRef.current.timeScale();
    if (x < 0 || x > scale.width() || y < 0 || y > topChartRef.current.panes()[0].getHeight()) return null;
    const logical = scale.coordinateToLogical(x);
    if (logical === null || !dataRef.current.length) return null;
    const index = Math.max(0, Math.min(dataRef.current.length - 1, Math.round(logical)));
    const time = dataRef.current[index].time;
    const price = candleRef.current.coordinateToPrice(y);
    if (price === null) return null;
    return { time: time as UTCTimestamp, price };
  };

  const pointToScreen = (point: LinePoint) => {
    if (!topChartRef.current || !candleRef.current) return null;
    const scale = topChartRef.current.timeScale();
    const x = scale.timeToCoordinate(point.time) ?? (dataRef.current.length
      ? scale.logicalToCoordinate(barIndex(dataRef.current, point.time) as Logical) : null);
    const y = candleRef.current.priceToCoordinate(point.price);
    if (x === null || y === null) return null;
    return { x, y };
  };

  const rectLabel = (line: Line, p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    const bounds = rectangleBounds(p1, p2);
    const plotWidth = topChartRef.current!.timeScale().width();
    const plotHeight = topChartRef.current!.panes()[0].getHeight();
    if (bounds.left > plotWidth || bounds.left + bounds.width < 0 || bounds.top > plotHeight || bounds.top + bounds.height < 0) return null;
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return null;
    ctx.font = "600 12px system-ui, sans-serif";
    const title = normalizeTitle(line.title ?? "");
    const width = Math.min(plotWidth - 4, ctx.measureText(title).width + 16);
    return { title, width, height: 24, x: Math.max(2, Math.min(plotWidth - width - 2, bounds.left)),
      y: Math.max(2, Math.min(plotHeight - 26, bounds.top - 26)) };
  };

  const drawingInData = (line: Line) => line.type !== "rect" || (dataRef.current.length > 0 &&
    Math.max(line.p1.time, line.p2.time) >= dataRef.current[0].time &&
    Math.min(line.p1.time, line.p2.time) <= dataRef.current[dataRef.current.length - 1].time);

  const projectDrawings = () => {
    const localLines = linesRef.current;
    const localDraft = draftRef.current;
    const allLines = localDraft ? localLines.concat(localDraft) : localLines;
    return allLines.flatMap(line => {
      if (!drawingInData(line)) return [];
      const p1 = line.type === "horiz"
        ? { x: 0, y: candleRef.current?.priceToCoordinate(line.p1.price) ?? -1000 }
        : pointToScreen(line.p1);
      if (!p1) return [];
      const p2 = line.type === "horiz"
        ? { x: topChartRef.current!.timeScale().width(), y: p1.y }
        : pointToScreen(line.p2);
      if (!p2) return [];
      return [{ line, p1, p2, label: line.type === "rect" ? rectLabel(line, p1, p2) : null }];
    });
  };

  const clipPriceText = (ctx: CanvasRenderingContext2D, labels: LabelBox[]) => {
    ctx.beginPath();
    ctx.rect(0, 0, topChartRef.current!.timeScale().width(), topChartRef.current!.panes()[0].getHeight());
    for (const box of labels) ctx.rect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
    ctx.clip("evenodd");
  };

  const drawLines = (ctx: CanvasRenderingContext2D, drawings: ReturnType<typeof projectDrawings>, priceLabels: LabelBox[]) => {
    const selected = selectedRef.current;
    // Keep the faint fill continuous. Only outlines need gaps under numbers;
    // cutting the fill too would make a visible rectangular price background.
    ctx.save();
    for (const { line, p1, p2 } of drawings) {
      if (line.type !== "rect") continue;
      const bounds = rectangleBounds(p1, p2);
      ctx.globalAlpha = line.id === selected ? 0.07 : themeRef.current === "dark" ? 0.05 : 0.035;
      ctx.fillStyle = line.color;
      ctx.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
    }
    ctx.restore();
    ctx.save();
    clipPriceText(ctx, priceLabels);
    // Keep dark user-selected ink visible without making the entire drawing glow.
    ctx.shadowColor = themeRef.current === "dark" ? "#cbd5e1" : "transparent";
    ctx.shadowBlur = themeRef.current === "dark" ? 1.5 : 0;
    for (const { line, p1, p2, label } of drawings) {
      const active = line.id === selected;
      ctx.lineWidth = active ? 2 : 1.25;
      ctx.globalAlpha = active ? 1 : 0.75;
      ctx.strokeStyle = line.color;
      if (line.type === "rect") {
        const bounds = rectangleBounds(p1, p2);
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = active ? 1 : 0.65;
        ctx.lineWidth = active ? 1.8 : 1;
        ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
        if (label) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = active ? 1.25 : 0.8;
          ctx.fillStyle = themeRef.current === "dark" ? "#111827" : "#ffffff";
          ctx.fillRect(label.x, label.y, label.width, label.height);
          ctx.strokeRect(label.x, label.y, label.width, label.height);
          ctx.fillStyle = themeRef.current === "dark" ? "#f8fafc" : "#111827";
          ctx.font = "600 12px system-ui, sans-serif";
          ctx.save();
          ctx.beginPath();
          ctx.rect(label.x + 5, label.y, label.width - 10, label.height);
          ctx.clip();
          ctx.fillText(label.title, label.x + 8, label.y + 16);
          ctx.restore();
        }
        if (active) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = line.color;
          for (const point of [p1, p2, { x: p1.x, y: p2.y }, { x: p2.x, y: p1.y }]) {
            ctx.fillRect(point.x - 4, point.y - 4, 8, 8);
          }
        }
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      if (active) {
        ctx.fillStyle = line.color;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
        ctx.arc(p2.x, p2.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  const hitTest = (x: number, y: number) => {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const localLines = linesRef.current;
    let best: { id: string; kind: DrawingHandle | "line"; dist: number } | null = null;
    const distToSegment = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => {
      const dx = bx - ax;
      const dy = by - ay;
      if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
      const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      const clamped = Math.max(0, Math.min(1, t));
      const cx = ax + clamped * dx;
      const cy = ay + clamped * dy;
      return Math.hypot(px - cx, py - cy);
    };
    for (const line of [...localLines].reverse()) {
      if (!drawingInData(line)) continue;
      const p1 = line.type === "horiz"
        ? { x: 0, y: candleRef.current?.priceToCoordinate(line.p1.price) ?? -1000 }
        : pointToScreen(line.p1);
      const p2 = line.type === "horiz"
        ? { x: topChartRef.current!.timeScale().width(), y: p1!.y }
        : pointToScreen(line.p2);
      if (!p1 || !p2) continue;
      if (line.type === "rect") {
        const corners: [DrawingHandle, { x: number; y: number }][] = [
          ["p1", p1], ["p2", p2], ["p3", { x: p1.x, y: p2.y }], ["p4", { x: p2.x, y: p1.y }],
        ];
        for (const [kind, corner] of corners) {
          const dist = Math.hypot(x - corner.x, y - corner.y);
          if (dist < (touch ? 18 : 9)) return { id: line.id, kind, dist };
        }
        const b = rectangleBounds(p1, p2);
        const label = rectLabel(line, p1, p2);
        if ((x >= b.left - 4 && x <= b.left + b.width + 4 && y >= b.top - 4 && y <= b.top + b.height + 4) ||
            (label && x >= label.x && x <= label.x + label.width && y >= label.y && y <= label.y + label.height)) {
          return best ?? { id: line.id, kind: "line" as const, dist: 0 };
        }
        continue;
      }
      const d1 = Math.hypot(x - p1.x, y - p1.y);
      const d2 = Math.hypot(x - p2.x, y - p2.y);
      if (d1 < (touch ? 18 : 8) && (!best || best.kind === "line" || d1 < best.dist)) {
        best = { id: line.id, kind: "p1", dist: d1 };
      }
      if (d2 < (touch ? 18 : 8) && (!best || best.kind === "line" || d2 < best.dist)) {
        best = { id: line.id, kind: "p2", dist: d2 };
      }
      const dl = distToSegment(p1.x, p1.y, p2.x, p2.y, x, y);
      if (dl < (touch ? 12 : 5) && (!best || (best.kind === "line" && dl < best.dist))) {
        best = { id: line.id, kind: "line", dist: dl };
      }
    }
    return best;
  };

  useEffect(() => {
    if (!topRef.current || !bottomRef.current) return;

    const topContainer = topRef.current;
    const bottomContainer = bottomRef.current;

    const topRect = topContainer.getBoundingClientRect();
    const bottomRect = bottomContainer.getBoundingClientRect();
    const topChart = createChart(topContainer, {
      width: Math.max(100, Math.floor(topRect.width)),
      height: Math.max(120, Math.floor(topRect.height)),
      layout: {
        background: { type: ColorType.Solid, color: theme === "dark" ? "#0b0f1a" : "#f6f7fb" },
        textColor: theme === "dark" ? "#f6f7fb" : "#0b0f1a",
        fontFamily: "\"Space Grotesk\", system-ui, sans-serif",
      },
      localization: {
        timeFormatter: formatCrosshairTime,
      },
      grid: {
        vertLines: { color: theme === "dark" ? "#1a2540" : "#d8dff0" },
        horzLines: { color: theme === "dark" ? "#1a2540" : "#d8dff0" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      rightPriceScale: { borderVisible: false, minimumWidth: 86 },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        borderVisible: true,
        tickMarkMaxCharacterLength: 16,
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          formatTick(time, type, dayOpenRef.current),
      },
    });

    const bottomChart = createChart(bottomContainer, {
      width: Math.max(100, Math.floor(bottomRect.width)),
      height: Math.max(80, Math.floor(bottomRect.height)),
      layout: {
        background: { type: ColorType.Solid, color: theme === "dark" ? "#0b0f1a" : "#f6f7fb" },
        textColor: theme === "dark" ? "#f6f7fb" : "#0b0f1a",
        fontFamily: "\"Space Grotesk\", system-ui, sans-serif",
      },
      localization: {
        timeFormatter: formatCrosshairTime,
      },
      grid: {
        vertLines: { color: theme === "dark" ? "#1a2540" : "#d8dff0" },
        horzLines: { color: theme === "dark" ? "#1a2540" : "#d8dff0" },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false },
      rightPriceScale: { borderVisible: false, minimumWidth: 86 },
      timeScale: {
        visible: false,
        timeVisible: false,
        secondsVisible: false,
        borderVisible: false,
      },
    });

    const candles = topChart.addSeries(CandlestickSeries, {
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    const volume = bottomChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "right",
      priceLineVisible: false,
      color: theme === "dark" ? "#79d36f" : "#1a9a8f",
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.2, bottom: 0.1 },
      borderVisible: false,
    });

    const openInterest = bottomChart.addSeries(LineSeries, {
      priceScaleId: "oi",
      priceLineVisible: false,
      lastValueVisible: false,
      color: theme === "dark" ? "#f5d24a" : "#e6b800",
      lineWidth: 2,
    });
    openInterest.priceScale().applyOptions({
      visible: false,
      borderVisible: false,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    });

    const handleCrosshair = (param: { time?: Time }) => {
      if (!param?.time) {
        // Keep the last located candle when the cursor leaves the plotting area.
        return;
      }
      const time = param.time as number;
      onHoverRef.current(dataMapRef.current.get(time));
    };
    topChart.subscribeCrosshairMove(handleCrosshair);
    bottomChart.subscribeCrosshairMove(handleCrosshair);

    const syncRange = (range: { from: number; to: number } | null) => {
      if (!range || !bottomChartRef.current) return;
      if (!dataRef.current.length) return;
      bottomChartRef.current.timeScale().setVisibleLogicalRange(range);
      drawStripesRef.current?.();
    };
    topChart.timeScale().subscribeVisibleLogicalRangeChange(syncRange);

    topChartRef.current = topChart;
    bottomChartRef.current = bottomChart;
    candleRef.current = candles;
    volumeRef.current = volume;
    oiRef.current = openInterest;

    const topResize = new ResizeObserver(() => {
      if (!topRef.current) return;
      topChart.applyOptions({
        width: topRef.current.clientWidth,
        height: topRef.current.clientHeight,
      });
      drawStripesRef.current?.();
    });
    const bottomResize = new ResizeObserver(() => {
      if (!bottomRef.current) return;
      bottomChart.applyOptions({
        width: bottomRef.current.clientWidth,
        height: bottomRef.current.clientHeight,
      });
    });

    topResize.observe(topContainer);
    bottomResize.observe(bottomContainer);

    const initialFrame = requestAnimationFrame(() => {
      if (topRef.current) {
        topChart.applyOptions({
          width: topRef.current.clientWidth,
          height: topRef.current.clientHeight,
        });
      }
      if (bottomRef.current) {
        bottomChart.applyOptions({
          width: bottomRef.current.clientWidth,
          height: bottomRef.current.clientHeight,
        });
      }
      drawStripesRef.current?.();
    });

    const preventZoom = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };
    topContainer.addEventListener("wheel", preventZoom, { passive: false });
    bottomContainer.addEventListener("wheel", preventZoom, { passive: false });
    topContainer.addEventListener("gesturestart", preventGesture as EventListener, { passive: false });
    bottomContainer.addEventListener("gesturestart", preventGesture as EventListener, { passive: false });

    const getLocalPos = (event: PointerEvent) => {
      const rect = topContainer.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onMouseDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      const { x, y } = getLocalPos(event);
      const point = screenToPoint(x, y);
      if (!point) return;
      const mode = drawModeRef.current;
      if (mode === "select") {
        const hit = hitTest(x, y);
        if (hit) {
          event.preventDefault();
          event.stopPropagation();
          topContainer.setPointerCapture(event.pointerId);
          setSelectedId(hit.id);
          const line = linesRef.current.find((l) => l.id === hit.id);
          if (line) {
            if (hit.kind === "line") {
              dragRef.current = {
                id: line.id,
                kind: "move",
                startTime: point.time,
                startPrice: point.price,
                start: line,
              };
            } else {
              dragRef.current = { id: line.id, kind: hit.kind };
            }
          }
        } else {
          setSelectedId(null);
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (mode === "horiz") {
        const timeRange = topChartRef.current?.timeScale().getVisibleRange();
        const startTime = (timeRange?.from ?? point.time) as UTCTimestamp;
        const endTime = (timeRange?.to ?? point.time) as UTCTimestamp;
        const id = createId();
        const line: Line = {
          id,
          type: "horiz",
          p1: { time: startTime, price: point.price },
          p2: { time: endTime, price: point.price },
          color: drawColorRef.current,
        };
        setLines((prev) => prev.concat(line));
        setSelectedId(id);
        setDraftLine(null);
        drawStripesRef.current?.();
        return;
      }

      if (!draftRef.current) {
        const id = createId();
        const base: Line = {
          id,
          type: mode,
          p1: point,
          p2: point,
          color: mode === "rect" ? tagStyleRef.current.color : drawColorRef.current,
          title: mode === "rect" ? normalizeTitle(tagStyleRef.current.title) : undefined,
        };
        setTagNotice("");
        setDraftLine(base);
        setSelectedId(id);
      } else {
        const current = draftRef.current;
        if (current.type === "rect" && (current.p1.time === point.time || Math.abs(current.p1.price - point.price) < 0.01)) {
          setTagNotice("请在不同时间和价格处选择对角，让矩形具有宽度与高度。");
          return;
        }
        const finalized: Line = {
          ...current,
          p2: point,
        };
        setLines((prev) => prev.concat(finalized));
        setDraftLine(null);
        setSelectedId(finalized.id);
        if (finalized.type === "rect") onDrawModeChange("select");
      }
    };

    const onMouseMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      const { x, y } = getLocalPos(event);
      if (event.buttons || draftRef.current) drawStripesRef.current?.();
      const drag = dragRef.current;
      const point = screenToPoint(
        drag ? Math.max(0, Math.min(topChart.timeScale().width(), x)) : x,
        drag ? Math.max(0, Math.min(topChart.panes()[0].getHeight(), y)) : y
      );
      if (!point) return;
      const hit = hitTest(x, y);
      topContainer.style.cursor = drawModeRef.current !== "select" ? "crosshair" :
        hit ? hit.kind === "line" ? "move" : "crosshair" : "default";
      if (drag) {
        event.preventDefault();
        event.stopPropagation();
        setLines((prev) =>
          prev.map((line) => {
            if (line.id !== drag.id) return line;
            if (drag.kind === "move") {
              const delta = barIndex(dataRef.current, point.time) - barIndex(dataRef.current, drag.startTime);
              const [t1, t2] = moveDrawingTimes(dataRef.current, drag.start.p1.time, drag.start.p2.time, delta);
              const dp = point.price - drag.startPrice;
              const next = {
                ...line,
                p1: { time: t1 as UTCTimestamp, price: drag.start.p1.price + dp },
                p2: { time: t2 as UTCTimestamp, price: drag.start.p2.price + dp },
              };
              if (line.type === "horiz") {
                return {
                  ...next,
                  p2: { ...next.p2, price: next.p1.price },
                };
              }
              return next;
            }
            return resizeDrawing(line, drag.kind, point);
          })
        );
        drawStripesRef.current?.();
        return;
      }

      if (draftRef.current) {
        setDraftLine((prev) => {
          if (!prev) return prev;
          const nextPoint = prev.type === "horiz" ? { ...point, price: prev.p1.price } : point;
          return { ...prev, p2: nextPoint };
        });
        drawStripesRef.current?.();
      }
    };

    const onMouseUp = (event?: PointerEvent) => {
      dragRef.current = null;
      if (event && topContainer.hasPointerCapture(event.pointerId)) topContainer.releasePointerCapture(event.pointerId);
    };
    const onBlur = () => onMouseUp();
    const onTouch = (event: TouchEvent) => {
      const finger = event.touches[0];
      if (!finger || event.touches.length > 1) return;
      const rect = topContainer.getBoundingClientRect();
      if (drawModeRef.current !== "select" || dragRef.current ||
          (event.type === "touchstart" && hitTest(finger.clientX - rect.left, finger.clientY - rect.top))) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // The overlay is visual only. Capture events before the library consumes
    // them, and block panning only when drawing or dragging an existing line.
    topContainer.addEventListener("pointerdown", onMouseDown, true);
    topContainer.addEventListener("touchstart", onTouch, { capture: true, passive: false });
    topContainer.addEventListener("touchmove", onTouch, { capture: true, passive: false });
    window.addEventListener("pointermove", onMouseMove, { passive: false });
    window.addEventListener("pointerup", onMouseUp);
    window.addEventListener("pointercancel", onMouseUp);
    window.addEventListener("blur", onBlur);
    const scheduleDraw = () => drawStripesRef.current?.();
    topContainer.addEventListener("wheel", scheduleDraw, { passive: true });
    topContainer.addEventListener("dblclick", scheduleDraw);

    const drawStripes = () => {
      if (!overlayRef.current || !topChartRef.current) return;
      const canvas = overlayRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const rect = topContainer.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const plotWidth = topChart.timeScale().width();
      const plotHeight = topChart.panes()[0].getHeight();
      ctx.beginPath();
      ctx.rect(0, 0, plotWidth, plotHeight);
      ctx.clip();
      const localData = dataRef.current;
      const range = topChart.timeScale().getVisibleLogicalRange();
      const nextExtrema = visibleExtrema(localData, range);
      setExtrema(prev => prev?.high === nextExtrema?.high && prev?.low === nextExtrema?.low ? prev : nextExtrema);
      if (!range || !nextExtrema) {
        setSwingInfo(prev => prev.details.length ? { labels: 0, details: [] } : prev);
        return;
      }
      const timeScale = topChart.timeScale();
      const halfBar = ((timeScale.logicalToCoordinate(1 as Logical) ?? 0) -
        (timeScale.logicalToCoordinate(0 as Logical) ?? 0)) / 2;
      for (const segment of stripesRef.current) {
        if (segment.to + 0.5 < range.from || segment.from - 0.5 > range.to) continue;
        // Shade the full candle width, placing boundaries halfway between bars.
        const left = timeScale.logicalToCoordinate(segment.from as Logical);
        const right = timeScale.logicalToCoordinate(segment.to as Logical);
        if (left === null || right === null) continue;
        const x = Math.max(0, left - halfBar);
        const end = Math.min(plotWidth, right + halfBar);
        ctx.fillStyle = segment.colorIndex === 0
          ? themeRef.current === "dark" ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.04)"
          : "rgba(35,180,167,0.08)";
        ctx.fillRect(x, 0, Math.max(0, end - x), plotHeight);
      }

      const drawings = projectDrawings();
      const reserved: LabelBox[] = [];
      const segments: LabelSegment[] = [];
      for (const { line, p1, p2, label } of drawings) {
        if (label) reserved.push({ x: label.x, y: label.y, width: label.width, height: label.height });
        const selected = line.id === selectedRef.current;
        if (line.type === "rect") {
          const corners = [p1, { x: p2.x, y: p1.y }, p2, { x: p1.x, y: p2.y }];
          for (let i = 0; i < 4; i++) {
            segments.push({ p1: corners[i], p2: corners[(i + 1) % 4], width: selected ? 1.8 : 1 });
          }
          if (selected) reserved.push(...corners.map(point => ({ x: point.x - 5, y: point.y - 5, width: 10, height: 10 })));
        } else {
          segments.push({ p1, p2, width: selected ? 2 : 1.25 });
          if (selected) reserved.push(...[p1, p2].map(point => ({ x: point.x - 5, y: point.y - 5, width: 10, height: 10 })));
        }
      }
      // One envelope per screen pixel avoids checking every minute against
      // every text box when a full month is compressed into this viewport.
      const candleBins = new Map<number, LabelBox>();
      for (let i = Math.max(0, Math.ceil(range.from)); i <= Math.min(localData.length - 1, Math.floor(range.to)); i++) {
        const x = timeScale.logicalToCoordinate(i as Logical);
        const highY = candles.priceToCoordinate(localData[i].high);
        const lowY = candles.priceToCoordinate(localData[i].low);
        if (x === null || highY === null || lowY === null) continue;
        const halfWidth = Math.max(0.5, Math.abs(halfBar) * 0.8);
        const box = { x: x - halfWidth, y: Math.min(highY, lowY), width: halfWidth * 2, height: Math.max(1, Math.abs(lowY - highY)) };
        const key = Math.floor(x);
        const prev = candleBins.get(key);
        if (prev) {
          const right = Math.max(prev.x + prev.width, box.x + box.width);
          const bottom = Math.max(prev.y + prev.height, box.y + box.height);
          prev.x = Math.min(prev.x, box.x);
          prev.y = Math.min(prev.y, box.y);
          prev.width = right - prev.x;
          prev.height = bottom - prev.y;
        } else candleBins.set(key, box);
      }
      const priceTop = candles.coordinateToPrice(0);
      const priceBottom = candles.coordinateToPrice(plotHeight);
      const pricePerPixel = priceTop === null || priceBottom === null ? 0 : Math.abs(priceTop - priceBottom) / Math.max(1, plotHeight);
      ctx.font = "600 11px system-ui, sans-serif";
      const points = visibleSwingPoints(localData, range, { plotWidth, minimumProminence: pricePerPixel * 8 }).flatMap(point => {
        const x = timeScale.logicalToCoordinate(point.index as Logical);
        const y = candles.priceToCoordinate(point.price);
        if (x === null || y === null) return [];
        const text = point.price.toFixed(2);
        return [{ ...point, x, y, text, labelWidth: ctx.measureText(text).width + 12 }];
      });
      const markers = placeSwingLabels(points, { width: plotWidth, height: plotHeight }, [...candleBins.values()], reserved, segments);
      const priceLabels = markers.flatMap(marker => marker.label ? [marker.label] : []);
      drawLines(ctx, drawings, priceLabels);
      const details = markers.map(marker => `${marker.price.toFixed(2)}，${localData[marker.index].rawTime}`);
      const nextSwingInfo = { labels: markers.filter(marker => marker.label).length, details };
      setSwingInfo(prev => prev.labels === nextSwingInfo.labels && prev.details.join("|") === details.join("|") ? prev : nextSwingInfo);
      // Paint connectors first, then dots and text, so a later connector never
      // crosses an earlier label. Labels themselves cannot overlap candles.
      const markerColor = (high: boolean) => themeRef.current === "dark"
        ? (high ? "#ff8a9a" : "#7ee5d7") : (high ? "#c83e46" : "#087f70");
      ctx.save();
      clipPriceText(ctx, priceLabels);
      ctx.lineWidth = 1;
      for (const marker of markers) {
        if (!marker.label) continue;
        const box = marker.label;
        ctx.strokeStyle = markerColor(marker.kind === "high");
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(marker.x, marker.y);
        ctx.lineTo(Math.max(box.x, Math.min(box.x + box.width, marker.x)), marker.kind === "high" ? box.y + box.height : box.y);
        ctx.stroke();
      }
      ctx.restore();
      for (const marker of markers) {
        const color = markerColor(marker.kind === "high");
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, marker.extreme ? 3 : 2.5, 0, Math.PI * 2);
        ctx.fill();
        const box = marker.label;
        if (!box) continue;
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = themeRef.current === "dark" ? "#0b0f1a" : "#f6f7fb";
        ctx.strokeText(marker.text, box.x + 6, box.y + 14);
        ctx.fillStyle = color;
        ctx.fillText(marker.text, box.x + 6, box.y + 14);
        ctx.restore();
      }
    };

    let drawFrame = 0;
    const requestDraw = () => {
      cancelAnimationFrame(drawFrame);
      drawFrame = requestAnimationFrame(drawStripes);
    };
    drawStripesRef.current = requestDraw;
    topChart.timeScale().subscribeVisibleTimeRangeChange(requestDraw);

    return () => {
      topResize.disconnect();
      bottomResize.disconnect();
      topContainer.removeEventListener("wheel", preventZoom);
      bottomContainer.removeEventListener("wheel", preventZoom);
      topContainer.removeEventListener("gesturestart", preventGesture as EventListener);
      bottomContainer.removeEventListener("gesturestart", preventGesture as EventListener);
      cancelAnimationFrame(initialFrame);
      cancelAnimationFrame(drawFrame);
      topContainer.removeEventListener("pointerdown", onMouseDown, true);
      topContainer.removeEventListener("touchstart", onTouch, true);
      topContainer.removeEventListener("touchmove", onTouch, true);
      window.removeEventListener("pointermove", onMouseMove);
      window.removeEventListener("pointerup", onMouseUp);
      window.removeEventListener("pointercancel", onMouseUp);
      window.removeEventListener("blur", onBlur);
      topContainer.removeEventListener("wheel", scheduleDraw);
      topContainer.removeEventListener("dblclick", scheduleDraw);
      topChart.timeScale().unsubscribeVisibleTimeRangeChange(requestDraw);
      topChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncRange);
      drawStripesRef.current = null;
      fittedDataRef.current = null;
      topChart.remove();
      bottomChart.remove();
      topChartRef.current = null;
      bottomChartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!topChartRef.current || !bottomChartRef.current) return;
    const layout = {
      background: { type: ColorType.Solid, color: theme === "dark" ? "#0b0f1a" : "#f6f7fb" },
      textColor: theme === "dark" ? "#f6f7fb" : "#0b0f1a",
      fontFamily: "\"Space Grotesk\", system-ui, sans-serif",
    };
    const grid = {
      vertLines: { color: theme === "dark" ? "#1a2540" : "#d8dff0" },
      horzLines: { color: theme === "dark" ? "#1a2540" : "#d8dff0" },
    };
    topChartRef.current.applyOptions({ layout, grid, localization: { timeFormatter: formatCrosshairTime } });
    bottomChartRef.current.applyOptions({ layout, grid, localization: { timeFormatter: formatCrosshairTime } });
    if (oiRef.current) {
      oiRef.current.applyOptions({
        color: theme === "dark" ? "#f5d24a" : "#e6b800",
      });
    }
  }, [theme]);

  useEffect(() => {
    if (!topChartRef.current || !bottomChartRef.current || !candleRef.current || !volumeRef.current || !oiRef.current) {
      return;
    }
    if (topRef.current) {
      topChartRef.current.applyOptions({
        width: topRef.current.clientWidth,
        height: topRef.current.clientHeight,
      });
    }
    if (bottomRef.current) {
      bottomChartRef.current.applyOptions({
        width: bottomRef.current.clientWidth,
        height: bottomRef.current.clientHeight,
      });
    }
    if (!data.length) {
      candleRef.current.setData([]);
      volumeRef.current.setData([]);
      oiRef.current.setData([]);
      return;
    }
    const colors = candleColors[theme];
    candleRef.current.setData(
      data.map((row) => ({
        time: row.time as UTCTimestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        color: row.close >= row.open ? (row.isNight ? colors.nightUp : colors.up) : row.isNight ? colors.nightDown : colors.down,
        borderColor:
          row.close >= row.open
            ? row.isNight
              ? colors.nightUp
              : colors.up
            : row.isNight
              ? colors.nightDown
              : colors.down,
        wickColor: colors.wick,
      }))
    );

    volumeRef.current.setData(
      data.map((row) => ({
            time: row.time as UTCTimestamp,
            value: row.volume,
            color: row.close >= row.open ? "#1a9a8f" : "#e06533",
          }))
    );

    oiRef.current.setData(openInterestData(data).map(row => ({ ...row, time: row.time as UTCTimestamp })));

    if (fittedDataRef.current !== data) {
      if (window.matchMedia("(max-width: 767px), (max-width: 1023px) and (max-height: 600px)").matches) {
        const count = Math.min(data.length, Math.max(35, Math.floor(topChartRef.current.timeScale().width() / 5)));
        topChartRef.current.timeScale().setVisibleLogicalRange({ from: -2, to: count });
      } else topChartRef.current.timeScale().fitContent();
      fittedDataRef.current = data;
    }
    const frame = requestAnimationFrame(() => {
      const logicalRange = topChartRef.current?.timeScale().getVisibleLogicalRange();
      if (logicalRange && bottomChartRef.current) {
        bottomChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
      }
      drawStripesRef.current?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [data, theme]);

  useEffect(() => {
    volumeRef.current?.applyOptions({ visible: showVolume });
    oiRef.current?.applyOptions({ visible: showOpenInterest });
  }, [showVolume, showOpenInterest]);

  useEffect(() => {
    topChartRef.current?.applyOptions({
      handleScroll: { horzTouchDrag: drawMode === "select", vertTouchDrag: false },
      handleScale: { pinch: drawMode === "select" },
    });
  }, [drawMode]);

  const selectedTag = lines.find(line => line.id === selectedId && line.type === "rect");
  const editTag = (patch: { title?: string; color?: string }) => {
    if (patch.title !== undefined) setTagTitle(patch.title);
    if (patch.color !== undefined) setTagColor(patch.color);
    if (selectedTag) setLines(prev => prev.map(line => line.id === selectedTag.id ? { ...line, ...patch } : line));
    setDraftLine(prev => prev?.type === "rect" ? { ...prev, ...patch } : prev);
    setTagNotice("");
  };
  const copyTag = () => {
    if (!selectedTag || !data.length) return;
    const [t1, t2] = moveDrawingTimes(data, selectedTag.p1.time, selectedTag.p2.time, 5);
    const offset = (selectedTag.p1.price - selectedTag.p2.price) * 0.1;
    const copy: Line = { ...selectedTag, id: createId(),
      p1: { time: t1 as UTCTimestamp, price: selectedTag.p1.price + offset },
      p2: { time: t2 as UTCTimestamp, price: selectedTag.p2.price + offset } };
    setLines(prev => [...prev, copy]);
    setSelectedId(copy.id);
    setTagNotice("已复制，可拖动新标注到目标位置。");
    onDrawModeChange("select");
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col gap-2">
      <div className={`tag-editor-container ${selectedTag || drawMode === "rect" ? "tag-editor-visible" : "hidden sm:block"}`}>
      <TagEditor
        editing={!!selectedTag} title={selectedTag?.title ?? tagTitle} color={selectedTag?.color ?? tagColor}
        templates={templates} notice={tagNotice} onTitle={title => editTag({ title })} onColor={color => editTag({ color })}
        onCopy={copyTag}
        onSaveTemplate={() => {
          const title = normalizeTitle(selectedTag?.title ?? tagTitle);
          const color = selectedTag?.color ?? tagColor;
          if (templates.some(template => template.title === title && template.color === color)) {
            setTagNotice("此标题与颜色已在模板中。");
            return;
          }
          setTemplates(prev => [...prev, { id: createId(), title, color }]);
          setTagNotice("模板已保存，点击模板即可绘制新标注。");
        }}
        onUseTemplate={template => {
          setTagTitle(template.title);
          setTagColor(template.color);
          setSelectedId(null);
          setDraftLine(null);
          setTagNotice("已使用模板，请在图表上点击两个对角。");
          onDrawModeChange("rect");
        }}
        onDeleteTemplate={id => {
          setTemplates(prev => prev.filter(template => template.id !== id));
          setTagNotice("模板已删除，已有标注仍保留。");
        }}
      />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="当前可见区间高低点">
        <span className="text-ink-500 dark:text-mist-200">当前可见区间</span>
        <span className="font-semibold text-red-600 dark:text-rose-300" title={extrema?.high.rawTime}>阶段高点 {extrema?.high.high.toFixed(2) ?? "—"}</span>
        <span className="font-semibold text-teal-600 dark:text-teal-300" title={extrema?.low.rawTime}>阶段低点 {extrema?.low.low.toFixed(2) ?? "—"}</span>
        <span className="text-ink-500 dark:text-mist-200" title="重复震荡价格自动合并，文字数量随窗口宽度控制，优先显示阶段高低点；文字避让K线与绘图，拥挤时保留圆点。">
          价格标注 {swingInfo.labels}（自动避让）
        </span>
      </div>
      <ul className="sr-only" aria-label="当前转折点价格标注">{swingInfo.details.map(detail => <li key={detail}>{detail}</li>)}</ul>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,3fr)_minmax(0,1fr)] gap-2">
        <div className="relative min-h-0 min-w-0 w-full isolate">
          <div ref={topRef} className="h-full w-full" data-testid="minute-chart" />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 z-10" aria-hidden="true" />
        </div>
        <div ref={bottomRef} className="min-h-0 w-full" data-testid="volume-chart" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500 dark:text-mist-200">
        <div className="mobile-chart-zoom flex items-center gap-2 sm:hidden">
          <button type="button" aria-label="放大K线" className="rounded border border-ink-200 px-3 dark:border-ink-700" onClick={() => {
            const scale = topChartRef.current?.timeScale();
            const range = scale?.getVisibleLogicalRange();
            if (scale && range) { const center = (range.from + range.to) / 2; const half = Math.max(6, (range.to - range.from) * 0.35); scale.setVisibleLogicalRange({ from: center - half, to: center + half }); }
          }}>＋</button>
          <button type="button" aria-label="缩小K线" className="rounded border border-ink-200 px-3 dark:border-ink-700" onClick={() => {
            const scale = topChartRef.current?.timeScale();
            const range = scale?.getVisibleLogicalRange();
            if (scale && range) { const center = (range.from + range.to) / 2; const half = Math.min(data.length / 2 + 5, (range.to - range.from) * 0.7); scale.setVisibleLogicalRange({ from: center - half, to: center + half }); }
          }}>−</button>
          <button type="button" aria-label="显示全部K线" className="rounded border border-ink-200 px-3 dark:border-ink-700" onClick={() => topChartRef.current?.timeScale().fitContent()}>全览</button>
        </div>
        <span>{drawMode === "horiz" ? "水平线：单击放置" : drawMode === "trend" ? "趋势线：依次点击起点和终点，Esc 取消" : drawMode === "rect" ? "矩形：依次点击两个对角，Esc 取消" : "选择：拖动标注或线条，拖动角点调整大小"}</span>
        <span>已保存 {lines.length} 条</span>
        <button type="button" disabled={!selectedId || !lines.some(line => line.id === selectedId)}
          className="rounded border border-ink-200 px-2 py-1 disabled:opacity-40 dark:border-ink-700"
          onClick={() => { setLines(prev => prev.filter(line => line.id !== selectedId)); setSelectedId(null); }}>
          删除选中标注
        </button>
        {(saveError || templateSaveError) && <span role="alert">浏览器存储不可用，标注或模板仅在本次查看时保留</span>}
      </div>

    </div>
  );
}
