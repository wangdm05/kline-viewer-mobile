import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import KlineChart from "./components/KlineChart";
import DayKChart from "./components/DayKChart";
import { tradingDayKey, tradingDayOrder } from "./utils/tradingDay";
import { parseCsvFile, type ParseResult, type KlineRow } from "./utils/parseCsv";
import { formatDateTimeSeconds, toLocalDateTimeInput } from "./utils/time";

import { loadBuiltinManifest, loadBuiltinMonth, type BuiltinManifest } from "./utils/builtinData";

type Theme = "light" | "dark";

const setHtmlTheme = (theme: Theme) => {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
};

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("kline-theme");
    return stored === "dark" ? "dark" : "light";
  });
  const [data, setData] = useState<KlineRow[]>([]);
  const [hoverRow, setHoverRow] = useState<KlineRow | undefined>(undefined);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showVolume, setShowVolume] = useState(true);
  const [showOpenInterest, setShowOpenInterest] = useState(true);
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [drawMode, setDrawMode] = useState<"select" | "trend" | "horiz" | "rect">("select");
  const [drawColor, setDrawColor] = useState("#111827");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [builtinManifest, setBuiltinManifest] = useState<BuiltinManifest | null>(null);
  const [builtinMonth, setBuiltinMonth] = useState("");
  const [source, setSource] = useState<"builtin" | "upload">("builtin");
  const [loadKind, setLoadKind] = useState<"builtin" | "upload">("builtin");
  const [sourceInfo, setSourceInfo] = useState("");
  const requestId = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setHtmlTheme(theme);
    localStorage.setItem("kline-theme", theme);
  }, [theme]);

  const tradingDays = useMemo(() => tradingDayOrder(data), [data]);

  const dates = useMemo(() => {
    const set = new Set<string>();
    data.forEach((row) => set.add(row.dayKey));
    return Array.from(set).sort();
  }, [data]);

  useEffect(() => {
    if (dates.length && !selectedDate) {
      setSelectedDate(dates[0]);
    }
  }, [dates, selectedDate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!dates.length) return;
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const idx = dates.indexOf(selectedDate);
      if (idx === -1) return;
      const next = event.key === "ArrowLeft" ? Math.max(idx - 1, 0) : Math.min(idx + 1, dates.length - 1);
      const nextDate = dates[next];
      setSelectedDate(nextDate);
      const [y, m, d] = nextDate.split("-").map(Number);
      const start = new Date(y, m - 1, d, 0, 0, 0);
      const end = new Date(y, m - 1, d, 23, 59, 59);
      setRangeStart(toLocalDateTimeInput(start));
      setRangeEnd(toLocalDateTimeInput(end));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dates, selectedDate]);

  const filteredData = useMemo(() => {
    if (!data.length) return [];
    const start = rangeStart ? new Date(rangeStart).getTime() / 1000 : null;
    const end = rangeEnd ? new Date(rangeEnd).getTime() / 1000 : null;
    return data.filter((row) => {
      if (start && row.time < start) return false;
      if (end && row.time > end) return false;
      return true;
    });
  }, [data, rangeStart, rangeEnd]);

  useEffect(() => { setHoverRow(undefined); }, [filteredData]);

  const beginLoad = useCallback((kind: "builtin" | "upload") => {
    const id = ++requestId.current;
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    setLoadKind(kind);
    setLoading(true);
    setProgress(0);
    setError(null);
    setErrorDetails([]);
    setWarnings([]);
    setHoverRow(undefined);
    return { id, controller };
  }, []);

  const applyResult = useCallback((result: ParseResult, kind: "builtin" | "upload", info: string) => {
    if (!result.ok) {
      setError(result.error);
      setErrorDetails(result.details);
      return;
    }
    setData(result.data);
    setSource(kind);
    setSourceInfo(info);
    setWarnings(result.warnings);
    const first = new Date(result.data[0].time * 1000);
    const last = new Date(result.data[result.data.length - 1].time * 1000);
    setRangeStart(toLocalDateTimeInput(first));
    setRangeEnd(toLocalDateTimeInput(last));
    setSelectedDate(result.data[0].dayKey);
  }, []);

  const restoreBuiltin = useCallback(async (monthKey?: string) => {
    const { id, controller } = beginLoad("builtin");
    try {
      const manifest = await loadBuiltinManifest(controller.signal);
      if (id !== requestId.current) return;
      setBuiltinManifest(manifest);
      const month = manifest.months.find(item => item.month === (monthKey ?? manifest.defaultMonth));
      if (!month) throw new Error("未找到该月份的内置数据");
      setBuiltinMonth(month.month);
      const result = await loadBuiltinMonth(month, value => {
        if (id === requestId.current) setProgress(value);
      }, controller.signal);
      if (id !== requestId.current) return;
      applyResult(result, "builtin", `内置 OI_Full · ${month.month} · ${month.rows.toLocaleString()} 条分钟数据`);
    } catch (error) {
      if (id !== requestId.current || controller.signal.aborted) return;
      setError("内置数据加载失败");
      setErrorDetails([error instanceof Error ? error.message : String(error), "可以重试加载，或使用上传 CSV 查看自己的数据。"]);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [beginLoad, applyResult]);

  useEffect(() => {
    void restoreBuiltin();
    return () => { requestId.current++; requestAbort.current?.abort(); };
  }, [restoreBuiltin]);

  const handleFile = async (file?: File) => {
    if (!file) return;
    const { id } = beginLoad("upload");
    try {
      const result = await parseCsvFile(file, value => {
        if (id === requestId.current) setProgress(value);
      });
      if (id === requestId.current) applyResult(result, "upload", `上传文件：${file.name}`);
    } catch (error) {
      if (id === requestId.current) {
        setError("文件解析失败");
        setErrorDetails([error instanceof Error ? error.message : String(error)]);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const clearRange = () => {
    if (!data.length) return;
    const first = new Date(data[0].time * 1000);
    const last = new Date(data[data.length - 1].time * 1000);
    setRangeStart(toLocalDateTimeInput(first));
    setRangeEnd(toLocalDateTimeInput(last));
  };

  const selectDate = (value: string) => {
    setSelectedDate(value);
    const [y, m, d] = value.split("-").map(Number);
    setRangeStart(toLocalDateTimeInput(new Date(y, m - 1, d, 0, 0, 0)));
    setRangeEnd(toLocalDateTimeInput(new Date(y, m - 1, d, 23, 59, 59)));
  };
  const dateIndex = dates.indexOf(selectedDate);

  const panelRow = hoverRow ?? filteredData[filteredData.length - 1];
  const panelIndex = panelRow ? filteredData.findIndex((row) => row.time === panelRow.time) : -1;
  const prevClose = panelIndex > 0 ? filteredData[panelIndex - 1].close : panelRow?.open ?? 0;
  const change = panelRow ? panelRow.close - prevClose : 0;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  const focusRow = hoverRow ?? filteredData[0];
  const activeDay = focusRow ? tradingDayKey(new Date(focusRow.time * 1000)) : undefined;

  return (
    <div className="kline-app min-h-full w-full px-6 py-6 text-ink-900 dark:text-mist-50">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-ink-500 dark:text-mist-200">
            K线查看器 v1.4
          </p>
          <h1 className="text-3xl font-display font-semibold"><span className="hidden sm:inline">本地 CSV 期货 / 股票 1分钟 K线可视化</span><span className="sm:hidden">OI 行情与图表打标</span></h1>
          <p className="desktop-only mt-2 hidden text-sm text-ink-500 dark:text-mist-200 sm:block">
            已内置 OI 历史数据 · 按月查看 · 支持上传 50MB 内 CSV
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-full border border-ink-200/60 bg-white px-4 py-2 text-sm font-semibold dark:border-ink-700 dark:bg-ink-800"
            onClick={() => void restoreBuiltin()}
          >恢复内置数据</button>
          <button
            className="rounded-full border border-ink-200/60 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:-translate-y-[1px] hover:shadow-lg dark:border-ink-700 dark:bg-ink-800"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "切换亮色" : "切换暗色"}
          </button>
          <button
            className="rounded-full bg-ink-900 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-[1px] dark:bg-mist-50 dark:text-ink-900"
            onClick={() => fileInputRef.current?.click()}
          >
            上传 CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void handleFile(file);
            }}
          />
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-600 dark:text-mist-200">
        <span role="status">{loading ? (loadKind === "builtin" ? "正在加载内置数据…" : "正在解析上传文件…") : sourceInfo}</span>
        {builtinManifest && source === "builtin" && <>
          <label className="flex items-center gap-2">内置月份
            <select aria-label="内置数据月份" value={builtinMonth} disabled={loading} onChange={event => void restoreBuiltin(event.target.value)}
              className="rounded-full border border-ink-200 bg-white px-3 py-2 dark:border-ink-700 dark:bg-ink-900">
              {[...builtinManifest.months].reverse().map(month => <option key={month.month} value={month.month}>{month.month}</option>)}
            </select>
          </label>
          <span className="hidden text-xs sm:inline">完整数据 {builtinManifest.first.slice(0, 10)} 至 {builtinManifest.last.slice(0, 10)} · 共 {builtinManifest.rows.toLocaleString()} 条 · 日K包含历史月份</span>
        </>}
      </div>

      <section className="chart-layout mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,4fr)_minmax(220px,1fr)]">
        <div className="chart-card min-w-0 rounded-3xl border border-ink-200/60 bg-white/70 p-5 shadow-lg backdrop-blur dark:border-ink-700 dark:bg-ink-800/80">
          <div className="flex flex-wrap items-center gap-4">
            <div className="date-navigation flex flex-wrap items-center gap-2">
              <label className="text-xs uppercase tracking-[0.25em] text-ink-500 dark:text-mist-200">
                日期定位
              </label>
              <button type="button" aria-label="上一天" disabled={loading || dateIndex <= 0}
                className="rounded-full border border-ink-200 px-3 py-2 disabled:opacity-30 dark:border-ink-700"
                onClick={() => selectDate(dates[dateIndex - 1])}>‹</button>
              <select aria-label="日期定位" disabled={loading}
                value={selectedDate}
                onChange={(event) => {
                  selectDate(event.target.value);
                }}
                className="rounded-full border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              >
                {dates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="下一天" disabled={loading || dateIndex < 0 || dateIndex >= dates.length - 1}
                className="rounded-full border border-ink-200 px-3 py-2 disabled:opacity-30 dark:border-ink-700"
                onClick={() => selectDate(dates[dateIndex + 1])}>›</button>
              <span className="desktop-only hidden text-xs text-ink-500 dark:text-mist-200 sm:inline">← → 键切换</span>
              <button type="button" aria-expanded={settingsOpen} aria-controls="chart-settings"
                className="mobile-settings-toggle rounded-full border border-ink-200 px-3 py-2 text-xs dark:border-ink-700 sm:hidden"
                onClick={() => setSettingsOpen(value => !value)}>设置</button>
            </div>
            <div id="chart-settings" className={`${settingsOpen ? "flex" : "hidden"} chart-settings w-full flex-wrap items-center gap-4 sm:flex`}>
            <div className="time-inputs flex flex-wrap items-center gap-3">
              <label className="text-xs uppercase tracking-[0.25em] text-ink-500 dark:text-mist-200">
                时间段
              </label>
              <input
                type="datetime-local"
                aria-label="开始时间"
                value={rangeStart}
                onChange={(event) => setRangeStart(event.target.value)}
                className="rounded-full border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              />
              <span className="text-xs text-ink-500">至</span>
              <input
                type="datetime-local"
                aria-label="结束时间"
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value)}
                className="rounded-full border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              />
              <button
                className="rounded-full border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 dark:border-ink-700 dark:text-mist-200"
                onClick={clearRange}
              >
                全量
              </button>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs uppercase tracking-[0.25em] text-ink-500 dark:text-mist-200">
                显示
              </label>
              <button
                className={`rounded-full px-3 py-2 text-xs font-semibold ${
                  showVolume
                    ? "bg-tealish-500 text-white"
                    : "border border-ink-200 text-ink-500 dark:border-ink-700 dark:text-mist-200"
                }`}
                onClick={() => setShowVolume((prev) => !prev)}
              >
                成交量
              </button>
              <button
                className={`rounded-full px-3 py-2 text-xs font-semibold ${
                  showOpenInterest
                    ? "bg-ember-500 text-white"
                    : "border border-ink-200 text-ink-500 dark:border-ink-700 dark:text-mist-200"
                }`}
                onClick={() => setShowOpenInterest((prev) => !prev)}
              >
                持仓量
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs uppercase tracking-[0.25em] text-ink-500 dark:text-mist-200">
                画线
              </label>
              {[
                ["select", "选择"],
                ["trend", "趋势线"],
                ["horiz", "水平线"],
                ["rect", "矩形打标"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded-full px-3 py-2 text-xs font-semibold ${
                    drawMode === value
                      ? "bg-ink-900 text-white dark:bg-mist-50 dark:text-ink-900"
                      : "border border-ink-200 text-ink-500 dark:border-ink-700 dark:text-mist-200"
                  }`}
                  onClick={() => setDrawMode(value as typeof drawMode)}
                >
                  {label}
                </button>
              ))}
              <input
                type="color"
                value={drawColor}
                onChange={(event) => setDrawColor(event.target.value)}
                className="h-8 w-8 cursor-pointer rounded-full border border-ink-200 p-1 dark:border-ink-700"
                title="线条颜色"
              />
            </div>
            </div>
          </div>

          <p className="desktop-only mt-3 hidden text-xs text-ink-500 dark:text-mist-200 sm:block">
            背景按交易日交替 · 成交量：柱形图 · 持仓量：黄色线（独立刻度） · 转折点价格随可见范围更新，文字自动避让
            {data.length > 0 && !filteredData.some(row => Number.isFinite(row.openInterest)) && " · 当前区间无持仓量数据"}
          </p>
          <p className="mobile-chart-hint mt-3 text-xs text-ink-500 dark:text-mist-200 sm:hidden">左右滑动浏览 · 双指缩放 · 长按查看价格 · 横屏看更多K线</p>
          <div className="chart-frame mt-4 h-[60vh] min-h-[600px] rounded-2xl border border-ink-200/60 bg-ink-900/5 p-3 dark:border-ink-700 dark:bg-ink-900">
            {loading ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-ink-500 dark:text-mist-200">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-ink-200 border-t-tealish-500" />
                <div className="text-sm">{loadKind === "builtin" ? "加载内置数据" : "解析 CSV"} {Math.round(progress * 100)}%</div>
                <div className="h-1 w-2/3 overflow-hidden rounded-full bg-ink-200/60 dark:bg-ink-700">
                  <div
                    className="h-full bg-tealish-500 transition-all"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>
            ) : filteredData.length ? (
              <KlineChart
                data={filteredData}
                tradingDays={tradingDays}
                showVolume={showVolume}
                showOpenInterest={showOpenInterest}
                theme={theme}
                drawMode={drawMode}
                onDrawModeChange={setDrawMode}
                drawColor={drawColor}
                onHover={(row) => setHoverRow(row)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-ink-500 dark:text-mist-200">
                <p className="text-lg font-semibold">上传 CSV 后开始查看 K 线</p>
                <p className="mt-2 text-sm">支持 1 分钟数据 · datetime 格式 YYYY-MM-DD HH:mm:ss</p>
              </div>
            )}
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="min-w-0 rounded-3xl border border-ink-200/60 bg-white/70 p-5 shadow-lg backdrop-blur dark:border-ink-700 dark:bg-ink-800/80">
            <h2 className="text-sm uppercase tracking-[0.25em] text-ink-500 dark:text-mist-200">
              日K 预览
            </h2>
            <div className="mt-4 h-[220px] rounded-2xl border border-ink-200/60 bg-ink-900/5 p-2 dark:border-ink-700 dark:bg-ink-900">
              {data.length ? (
                <DayKChart data={data} selectedDay={activeDay} theme={theme} presetDaily={source === "builtin" ? builtinManifest?.daily : undefined} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-ink-500 dark:text-mist-200">
                  暂无日K数据
                </div>
              )}
            </div>
            {activeDay ? (
              <div className="mt-3 space-y-1 text-xs text-ink-500 dark:text-mist-200" aria-live="polite">
                <p>对应交易日：<strong>{activeDay}</strong></p>
                <p>{hoverRow ? "定位时间" : "区间起点"}：{focusRow?.rawTime}</p>
              </div>
            ) : null}
          </div>
          <div className="min-w-0 rounded-3xl border border-ink-200/60 bg-white/70 p-5 shadow-lg backdrop-blur dark:border-ink-700 dark:bg-ink-800/80">
            <h2 className="text-sm uppercase tracking-[0.25em] text-ink-500 dark:text-mist-200">
              实时数据面板
            </h2>
            {panelRow ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-2xl border border-ink-200/60 bg-white px-4 py-3 shadow-sm dark:border-ink-700 dark:bg-ink-900">
                  <p className="text-xs text-ink-500 dark:text-mist-200">时间</p>
                  <p className="font-mono text-base">{panelRow.rawTime}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["开盘", panelRow.open],
                    ["最高", panelRow.high],
                    ["最低", panelRow.low],
                    ["收盘", panelRow.close],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-ink-200/60 bg-white px-4 py-3 shadow-sm dark:border-ink-700 dark:bg-ink-900"
                    >
                      <p className="text-xs text-ink-500 dark:text-mist-200">{label}</p>
                      <p className="text-base font-semibold">{Number(value).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-ink-200/60 bg-white px-4 py-3 shadow-sm dark:border-ink-700 dark:bg-ink-900">
                    <p className="text-xs text-ink-500 dark:text-mist-200">成交量</p>
                    <p className="text-base font-semibold">{panelRow.volume.toLocaleString()}</p>
                  </div>
                  <div className="rounded-2xl border border-ink-200/60 bg-white px-4 py-3 shadow-sm dark:border-ink-700 dark:bg-ink-900">
                    <p className="text-xs text-ink-500 dark:text-mist-200">持仓量</p>
                    <p className="text-base font-semibold">{panelRow.openInterest?.toLocaleString() ?? "无数据"}</p>
                  </div>
                  <div className="rounded-2xl border border-ink-200/60 bg-white px-4 py-3 shadow-sm dark:border-ink-700 dark:bg-ink-900">
                    <p className="text-xs text-ink-500 dark:text-mist-200">涨跌幅</p>
                    <p
                      className={`text-base font-semibold ${
                        change >= 0 ? "text-limeish-500" : "text-roseish-500"
                      }`}
                    >
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(2)} ({changePct.toFixed(2)}%)
                    </p>
                  </div>
                  <div className="rounded-2xl border border-ink-200/60 bg-white px-4 py-3 shadow-sm dark:border-ink-700 dark:bg-ink-900">
                    <p className="text-xs text-ink-500 dark:text-mist-200">区间定位</p>
                    <p className="text-sm">
                      {panelIndex >= 0 ? `${panelIndex + 1} / ${filteredData.length}` : "--"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-500 dark:text-mist-200">等待数据载入…</p>
            )}
          </div>

          <div className="min-w-0 rounded-3xl border border-ink-200/60 bg-white/70 p-5 shadow-lg backdrop-blur dark:border-ink-700 dark:bg-ink-800/80">
            <h2 className="text-sm uppercase tracking-[0.25em] text-ink-500 dark:text-mist-200">
              解析状态
            </h2>
            {error ? (
              <div className="mt-4 space-y-2 text-sm text-roseish-500">
                <p className="text-base font-semibold">{error}</p>
                {errorDetails.map((detail) => (
                  <p key={detail}>{detail}</p>
                ))}
                <button
                  className="mt-2 rounded-full bg-roseish-500 px-4 py-2 text-xs font-semibold text-white"
                  onClick={() => loadKind === "builtin" ? void restoreBuiltin(builtinMonth || undefined) : fileInputRef.current?.click()}
                >
                  一键重试
                </button>
              </div>
            ) : warnings.length ? (
              <div className="mt-4 space-y-2 text-sm text-ink-500 dark:text-mist-200">
                {warnings.map((warn) => (
                  <p key={warn}>{warn}</p>
                ))}
                {data.length ? (
                  <p>最近更新时间：{formatDateTimeSeconds(new Date(data[data.length - 1].time * 1000))}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-500 dark:text-mist-200">暂无解析日志</p>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
