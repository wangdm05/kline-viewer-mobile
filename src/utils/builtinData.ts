import { parseCsvFile } from "./parseCsv";
import type { DailyRow } from "./tradingDay";

export type BuiltinMonth = { month: string; file: string; rows: number; first: string; last: string };
export type BuiltinManifest = {
  version: number; name: string; sourceFile: string; rows: number;
  first: string; last: string; defaultMonth: string; months: BuiltinMonth[]; daily: DailyRow[];
};
const root = `${import.meta.env.BASE_URL}data/oi-full/`;

// Cache the first visit too, before the service worker controls the page.
async function fetchHistory(url: string, signal: AbortSignal): Promise<Response> {
  let cache: Cache | undefined;
  if (window.isSecureContext && "caches" in window) {
    try { cache = await caches.open("kline-history-v1"); } catch { /* Private browsing may disallow storage. */ }
  }
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`历史数据加载失败（${response.status}）`);
    if (cache) {
      try { await cache.put(url, response.clone()); } catch { /* Online viewing still works if storage is full. */ }
    }
    return response;
  } catch (error) {
    signal.throwIfAborted();
    const stored = await cache?.match(url);
    if (stored) return stored;
    throw error;
  }
}

export async function loadBuiltinManifest(signal: AbortSignal): Promise<BuiltinManifest> {
  const response = await fetchHistory(`${root}index.json`, signal);
  if (!response.ok) throw new Error(`内置数据索引加载失败（${response.status}）`);
  const manifest = await response.json() as BuiltinManifest;
  if (manifest.version !== 1 || !manifest.months?.length || !Array.isArray(manifest.daily)) {
    throw new Error("内置数据索引无效");
  }
  return manifest;
}

export async function loadBuiltinMonth(month: BuiltinMonth, onProgress: (progress: number) => void, signal: AbortSignal) {
  const response = await fetchHistory(`${root}${encodeURIComponent(month.file)}`, signal);
  if (!response.ok) throw new Error(`内置月份加载失败（${response.status}）`);
  const blob = await response.blob();
  signal.throwIfAborted();
  const result = await parseCsvFile(new File([blob], month.file, { type: "text/csv" }), onProgress);
  signal.throwIfAborted();
  if (result.ok && result.data.length !== month.rows) throw new Error("内置月份数据不完整，请重试加载");
  return result;
}
