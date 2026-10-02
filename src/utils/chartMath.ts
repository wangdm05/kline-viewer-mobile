import type { KlineRow } from "./parseCsv";

// A viewport is expressed in bar indices, so overnight/weekend gaps do not
// distort either the extrema or a drawing dragged across a session boundary.
export function visibleExtrema(data: KlineRow[], range: { from: number; to: number } | null) {
  if (!range || !data.length) return null;
  const from = Math.max(0, Math.ceil(range.from));
  const to = Math.min(data.length - 1, Math.floor(range.to));
  if (from > to) return null;
  let high = data[from];
  let low = high;
  for (let i = from + 1; i <= to; i++) {
    if (data[i].high > high.high) high = data[i];
    if (data[i].low < low.low) low = data[i];
  }
  return { high, low };
}

export function barIndex(data: KlineRow[], time: number) {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, data.length - 1);
}

export function moveDrawingTimes(data: KlineRow[], t1: number, t2: number, delta: number) {
  const i1 = barIndex(data, t1);
  const i2 = barIndex(data, t2);
  const shift = Math.max(-Math.min(i1, i2), Math.min(delta, data.length - 1 - Math.max(i1, i2)));
  return [data[i1 + shift].time, data[i2 + shift].time];
}

export const openInterestData = (data: KlineRow[]) => data.map(row =>
  Number.isFinite(row.openInterest)
    ? { time: row.time, value: row.openInterest! }
    : { time: row.time }
);
