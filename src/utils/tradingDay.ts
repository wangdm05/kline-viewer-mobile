import type { KlineRow } from "./parseCsv";

export type DailyRow = {
  time: string;
  dayKey: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatDayKey = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// 日K 规则：夜盘+日盘。若该交易日有夜盘，则区间为 D-1 21:00 至 D 15:00（含 15:00）
// 若无夜盘，则仅统计 D 09:00 至 D 15:00（含 15:00）
export const tradingDayKey = (date: Date) => {
  if (date.getHours() >= 21) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return formatDayKey(next);
  }
  return formatDayKey(date);
};

export const tradingDayOrder = (data: KlineRow[]) =>
  Array.from(new Set(data.map(row => tradingDayKey(new Date(row.time * 1000)))));

export function tradingDaySegments(data: KlineRow[], dayOrder: string[] = tradingDayOrder(data)) {
  const colors = new Map(dayOrder.map((day, index) => [day, index % 2]));
  const segments: { dayKey: string; from: number; to: number; colorIndex: number }[] = [];
  data.forEach((row, index) => {
    const dayKey = tradingDayKey(new Date(row.time * 1000));
    const previous = segments[segments.length - 1];
    if (previous?.dayKey === dayKey) previous.to = index;
    else segments.push({ dayKey, from: index, to: index, colorIndex: colors.get(dayKey) ?? 0 });
  });
  return segments;
}

const isInSession = (date: Date, hasNight: boolean) => {
  const h = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  const isEnd = h === 15 && m === 0 && s === 0;
  if (hasNight) {
    if (h >= 21) return true;
    if (h < 15) return true;
    return isEnd;
  }
  if (h < 9) return false;
  if (h < 15) return true;
  return isEnd;
};

export const aggregateDaily = (data: KlineRow[]) => {
  const map = new Map<string, DailyRow>();
  const nightMap = new Map<string, boolean>();

  for (const row of data) {
    const date = new Date(row.time * 1000);
    if (date.getHours() >= 21) {
      nightMap.set(tradingDayKey(date), true);
    }
  }

  for (const row of data) {
    const date = new Date(row.time * 1000);
    const key = tradingDayKey(date);
    const hasNight = nightMap.get(key) ?? false;
    if (!isInSession(date, hasNight)) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        dayKey: key,
        time: key,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      });
    } else {
      existing.high = Math.max(existing.high, row.high);
      existing.low = Math.min(existing.low, row.low);
      existing.close = row.close;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
};
