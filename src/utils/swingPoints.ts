import type { KlineRow } from "./parseCsv";

export type SwingPoint = {
  index: number;
  kind: "high" | "low";
  price: number;
  prominence: number;
  extreme: boolean;
};

// Rolling bounds exclude the current bar. Monotonic queues keep work linear
// even when a zoomed-out viewport contains hundreds of thousands of bars.
function sideBounds(values: number[], radius: number, direction: 1 | -1) {
  const min = new Float64Array(values.length);
  const max = new Float64Array(values.length);
  const minQueue = new Int32Array(values.length);
  const maxQueue = new Int32Array(values.length);
  let minHead = 0, minTail = 0, maxHead = 0, maxTail = 0;
  for (let i = direction === 1 ? 0 : values.length - 1; i >= 0 && i < values.length; i += direction) {
    while (minHead < minTail && (i - minQueue[minHead]) * direction > radius) minHead++;
    while (maxHead < maxTail && (i - maxQueue[maxHead]) * direction > radius) maxHead++;
    min[i] = minHead < minTail ? values[minQueue[minHead]] : Infinity;
    max[i] = maxHead < maxTail ? values[maxQueue[maxHead]] : -Infinity;
    while (minHead < minTail && values[minQueue[minTail - 1]] >= values[i]) minTail--;
    while (maxHead < maxTail && values[maxQueue[maxTail - 1]] <= values[i]) maxTail--;
    minQueue[minTail++] = i;
    maxQueue[maxTail++] = i;
  }
  return { min, max };
}

function mergeRepeatedLevels(points: SwingPoint[], barWidth: number, plotWidth: number, tolerance: number) {
  const clusters: { points: SwingPoint[]; min: number; max: number; lastIndex: number }[] = [];
  const maxGap = Math.max(120, plotWidth * 0.3) / barWidth;
  for (const point of [...points].sort((a, b) => a.index - b.index)) {
    const cluster = clusters.find(group => group.points[0].kind === point.kind &&
      point.index - group.lastIndex <= maxGap &&
      Math.max(group.max, point.price) - Math.min(group.min, point.price) <= tolerance);
    if (cluster) {
      cluster.points.push(point);
      cluster.min = Math.min(cluster.min, point.price);
      cluster.max = Math.max(cluster.max, point.price);
      cluster.lastIndex = point.index;
    } else clusters.push({ points: [point], min: point.price, max: point.price, lastIndex: point.index });
  }
  return clusters.flatMap(group => {
    // Two touches can be meaningful turning points. Repeated touches at a
    // stable level are summarized once, rather than labeling every oscillation.
    if (group.points.length < 3) return group.points;
    return [group.points.reduce((best, point) => {
      if (point.extreme) return point;
      if (best.extreme) return best;
      return point.prominence >= best.prominence ? point : best;
    })];
  });
}

export function visibleSwingPoints(
  data: KlineRow[], range: { from: number; to: number } | null,
  options: { plotWidth: number; minimumProminence: number },
): SwingPoint[] {
  if (!range || !data.length || options.plotWidth <= 0) return [];
  const from = Math.max(0, Math.ceil(range.from));
  const to = Math.min(data.length - 1, Math.floor(range.to));
  if (from > to) return [];
  const barWidth = options.plotWidth / Math.max(1, range.to - range.from);
  const radius = Math.max(2, Math.ceil(24 / barWidth));
  const spacing = Math.max(1, Math.ceil(40 / barWidth));
  const candidates: SwingPoint[] = [];
  for (const kind of ["high", "low"] as const) {
    const values = data.slice(from, to + 1).map(row => row[kind]);
    const left = sideBounds(values, radius, 1);
    const right = sideBounds(values, radius, -1);
    let extremeIndex = 0;
    for (let i = 1; i < values.length; i++) {
      if (kind === "high" ? values[i] > values[extremeIndex] : values[i] < values[extremeIndex]) extremeIndex = i;
    }
    candidates.push({ index: from + extremeIndex, kind, price: values[extremeIndex], prominence: Infinity, extreme: true });
    for (let start = 0; start < values.length;) {
      let end = start;
      while (end + 1 < values.length && values[end + 1] === values[start]) end++;
      const price = values[start];
      const isTurn = start > 0 && end < values.length - 1 && (kind === "high"
        ? price > values[start - 1] && price > values[end + 1] && price >= left.max[start] && price >= right.max[end]
        : price < values[start - 1] && price < values[end + 1] && price <= left.min[start] && price <= right.min[end]);
      const prominence = kind === "high"
        ? price - Math.max(left.min[start], right.min[end])
        : Math.min(left.max[start], right.max[end]) - price;
      const index = from + Math.floor((start + end) / 2);
      if (isTurn && (extremeIndex < start || extremeIndex > end) && prominence >= Math.max(0, options.minimumProminence)) {
        candidates.push({ index, kind, price, prominence, extreme: false });
      }
      start = end + 1;
    }
  }
  // Prefer the most distinct turn in each screen neighborhood. Peaks and
  // troughs are thinned separately so both sides of a short swing can survive.
  const selected: SwingPoint[] = [];
  for (const point of candidates.sort((a, b) => Number(b.extreme) - Number(a.extreme) || b.prominence - a.prominence || a.index - b.index)) {
    if (!selected.some(other => other.kind === point.kind && Math.abs(other.index - point.index) < spacing)) selected.push(point);
  }
  const high = candidates.find(point => point.extreme && point.kind === "high")!.price;
  const low = candidates.find(point => point.extreme && point.kind === "low")!.price;
  // Both a screen-based threshold and a fraction of the visible range are
  // needed: auto-scaling can make tiny sideways oscillations look very tall.
  const tolerance = Math.max(options.minimumProminence, (high - low) * 0.035);
  return mergeRepeatedLevels(selected, barWidth, options.plotWidth, tolerance)
    .sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
}

export type LabelBox = { x: number; y: number; width: number; height: number };
export type ScreenPoint = { x: number; y: number };
export type LabelSegment = { p1: ScreenPoint; p2: ScreenPoint; width: number };
export type ScreenSwingPoint = SwingPoint & { x: number; y: number; labelWidth: number; text: string };
export type SwingMarker = ScreenSwingPoint & { label?: LabelBox };

export const boxesOverlap = (a: LabelBox, b: LabelBox, gap = 0) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

// Intersect the actual segment, rather than its bounding rectangle. A diagonal
// drawing should only reserve the narrow space its stroke occupies.
export function segmentIntersectsBox(segment: LabelSegment, box: LabelBox, gap = 0) {
  const padding = gap + segment.width / 2;
  let from = 0, to = 1;
  for (const [start, delta, min, max] of [
    [segment.p1.x, segment.p2.x - segment.p1.x, box.x - padding, box.x + box.width + padding],
    [segment.p1.y, segment.p2.y - segment.p1.y, box.y - padding, box.y + box.height + padding],
  ]) {
    if (delta === 0) {
      if (start < min || start > max) return false;
      continue;
    }
    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;
    from = Math.max(from, Math.min(t1, t2));
    to = Math.min(to, Math.max(t1, t2));
    if (from > to) return false;
  }
  return true;
}

export function placeSwingLabels(
  points: ScreenSwingPoint[], bounds: { width: number; height: number },
  candles: LabelBox[], reserved: LabelBox[] = [],
  segments: LabelSegment[] = [],
): SwingMarker[] {
  const occupied = [...reserved];
  const result: SwingMarker[] = [];
  const labelBudget = Math.max(2, Math.floor(bounds.width / 100));
  let labelCount = 0;
  for (const point of [...points].sort((a, b) => Number(b.extreme) - Number(a.extreme) || b.prominence - a.prominence || a.index - b.index)) {
    if (point.x < 0 || point.x > bounds.width || point.y < 0 || point.y > bounds.height) continue;
    const marker: SwingMarker = { ...point };
    let fallback: { box: LabelBox; crossings: number } | undefined;
    const width = point.labelWidth;
    const height = 20;
    if (labelCount < labelBudget && width <= bounds.width - 4) {
      for (const dx of [0, -width * 0.6, width * 0.6, -width * 1.1, width * 1.1]) {
        const x = Math.max(2, Math.min(bounds.width - width - 2, point.x - width / 2 + dx));
        let edge = point.y;
        for (const candle of candles) {
          if (candle.x < x + width + 4 && candle.x + candle.width > x - 4) {
            edge = point.kind === "high" ? Math.min(edge, candle.y) : Math.max(edge, candle.y + candle.height);
          }
        }
        for (const offset of [0, 24, 48, 72]) {
          const gap = point.extreme ? 6 : 10;
          const y = point.kind === "high" ? edge - gap - height - offset : edge + gap + offset;
          const box = { x, y, width, height };
          if (y < 2 || y + height > bounds.height - 2) continue;
          if (occupied.some(other => boxesOverlap(box, other, 4)) || candles.some(candle => boxesOverlap(box, candle, 4))) continue;
          const crossings = segments.filter(segment => segmentIntersectsBox(segment, box, 4)).length;
          if (crossings) {
            if (!fallback || crossings < fallback.crossings) fallback = { box, crossings };
            continue;
          }
          marker.label = box;
          break;
        }
        if (marker.label) break;
      }
    }
    // If drawings occupy every safe text position, keep the text and cut a
    // gap in the drawing layer underneath it. Candles and titles stay protected.
    marker.label ??= fallback?.box;
    if (marker.label) {
      occupied.push(marker.label);
      labelCount++;
    }
    // A marker remains at its exact price/time when no safe text position fits.
    result.push(marker);
  }
  return result;
}
