import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleSwingPoints, placeSwingLabels, boxesOverlap, segmentIntersectsBox, type ScreenSwingPoint, type LabelSegment } from "./swingPoints.ts";
import type { KlineRow } from "./parseCsv";

const rows = (values: number[]): KlineRow[] => values.map((value, index) => ({
  time: index * 60, open: value, close: value, high: value + 1, low: value - 1,
  volume: 10, rawTime: String(index), dayKey: "", isNight: false,
}));
const options = { plotWidth: 1000, minimumProminence: 1 };

test("local peaks and troughs are retained alongside the viewport extremes", () => {
  const data = rows([10, 12, 16, 12, 8, 11, 14, 11, 9, 12, 18, 12, 10]);
  const points = visibleSwingPoints(data, { from: 0, to: 12 }, options);
  assert.deepEqual(points.filter(point => point.kind === "high").map(point => point.index), [2, 6, 10]);
  assert.deepEqual(points.filter(point => point.kind === "low").map(point => point.index), [4, 8]);
  assert.deepEqual(points.filter(point => point.extreme).map(point => [point.index, point.price]), [[4, 7], [10, 19]]);
});

test("turns use visible bar indices and never include offscreen data or fractional edge bars", () => {
  const data = rows([100, 10, 13, 10, 8, 10, 15, 10, 9, 10, 100]);
  const points = visibleSwingPoints(data, { from: 1.1, to: 9.9 }, options);
  assert(points.every(point => point.index >= 2 && point.index <= 9));
  assert.equal(points.find(point => point.extreme && point.kind === "high")?.price, 16);
  assert.equal(points.find(point => point.extreme && point.kind === "low")?.price, 7);
  assert.deepEqual(visibleSwingPoints(data, { from: 30, to: 40 }, options), []);
  assert.deepEqual(visibleSwingPoints(data, null, options), []);
  assert.deepEqual(visibleSwingPoints([], { from: 0, to: 1 }, options), []);
});

test("plateaus produce a single turn and a global plateau is not duplicated", () => {
  const data = rows([10, 12, 15, 15, 15, 12, 8, 8, 8, 12, 20, 12, 10]);
  const points = visibleSwingPoints(data, { from: 0, to: 12 }, options);
  assert.deepEqual(points.filter(point => point.kind === "high").map(point => point.index), [3, 10]);
  assert.deepEqual(points.filter(point => point.kind === "low").map(point => point.index), [6]);
});

test("flat, monotonic and single-bar views do not invent local reversals", () => {
  for (const values of [[10, 10, 10, 10], [1, 2, 3, 4, 5], [10]]) {
    const points = visibleSwingPoints(rows(values), { from: 0, to: values.length - 1 }, options);
    assert.equal(points.length, 2);
    assert(points.every(point => point.extreme));
  }
});

test("prominence filters small noise without removing the highest and lowest price", () => {
  const data = rows([10, 12, 16, 12, 8, 11, 11.1, 11, 10.9, 12, 18, 12, 10]);
  const points = visibleSwingPoints(data, { from: 0, to: 12 }, { ...options, minimumProminence: 3 });
  assert(points.some(point => !point.extreme && point.index === 2));
  assert(!points.some(point => !point.extreme && point.index === 6));
  assert.equal(points.filter(point => point.extreme).length, 2);
});

test("a narrower screen thins dense turns and zooming in reveals details", () => {
  const data = rows(Array.from({ length: 400 }, (_, i) => 100 + i * 0.15 + 10 * Math.sin(i * Math.PI / 10)));
  const full = { from: 0, to: 399 };
  const wide = visibleSwingPoints(data, full, options);
  const narrow = visibleSwingPoints(data, full, { ...options, plotWidth: 150 });
  assert(wide.length > narrow.length);
  const zoom = visibleSwingPoints(data, { from: 100, to: 170 }, { ...options, plotWidth: 150 });
  assert(zoom.some(point => !point.extreme));
  assert(zoom.filter(point => !point.extreme).length > narrow.filter(point => !point.extreme && point.index >= 100 && point.index <= 170).length);
});

const screenPoint = (index: number, kind: "high" | "low", x: number, y: number, extreme = false): ScreenSwingPoint => ({
  index, kind, x, y, extreme, prominence: extreme ? Infinity : 10, price: 100, labelWidth: 76, text: "100.00",
});

test("labels avoid candles, rectangle titles and each other, and stay inside the pane", () => {
  const points = [screenPoint(0, "high", 5, 90, true), screenPoint(1, "high", 55, 90),
    screenPoint(2, "low", 55, 140, true), screenPoint(3, "low", 105, 140), screenPoint(4, "high", 235, 90)];
  const candles = [{ x: 0, y: 85, width: 240, height: 60 }];
  const reserved = [{ x: 25, y: 50, width: 100, height: 24 }];
  const markers = placeSwingLabels(points, { width: 240, height: 250 }, candles, reserved);
  const boxes = markers.flatMap(marker => marker.label ? [marker.label] : []);
  assert(boxes.length >= 2);
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    assert(box.x >= 2 && box.x + box.width <= 238 && box.y >= 2 && box.y + box.height <= 248);
    assert(![...candles, ...reserved].some(other => boxesOverlap(box, other, 4)));
    assert(!boxes.slice(i + 1).some(other => boxesOverlap(box, other, 4)));
  }
});

test("crowded text falls back to exact-price dots and extremes receive placement priority", () => {
  const minor = screenPoint(1, "high", 50, 40);
  const extreme = screenPoint(2, "high", 50, 40, true);
  const markers = placeSwingLabels([minor, extreme], { width: 90, height: 85 }, []);
  assert(markers.find(marker => marker.extreme)?.label);
  assert.equal(markers.find(marker => !marker.extreme)?.label, undefined);
  const blocked = placeSwingLabels([minor], { width: 90, height: 85 }, [{ x: 0, y: 0, width: 90, height: 85 }]);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].label, undefined);
  assert.equal(blocked[0].x, minor.x);
  assert.equal(blocked[0].y, minor.y);
});

test("offscreen points are omitted and tiny panes do not clip oversized text", () => {
  const markers = placeSwingLabels([screenPoint(0, "high", -5, 30), screenPoint(1, "low", 20, 30)], { width: 40, height: 60 }, []);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].label, undefined);
});

test("drawing collisions follow the stroke, including reversed, vertical and zero-length segments", () => {
  const diagonal = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 100 }, width: 2 };
  assert(segmentIntersectsBox(diagonal, { x: 40, y: 40, width: 20, height: 20 }));
  assert(!segmentIntersectsBox(diagonal, { x: 10, y: 70, width: 20, height: 20 }));
  assert(segmentIntersectsBox({ ...diagonal, p1: diagonal.p2, p2: diagonal.p1 }, { x: 40, y: 40, width: 20, height: 20 }));
  assert(segmentIntersectsBox({ p1: { x: 50, y: -100 }, p2: { x: 50, y: 200 }, width: 2 }, { x: 40, y: 40, width: 20, height: 20 }));
  assert(!segmentIntersectsBox({ p1: { x: 30, y: -100 }, p2: { x: 30, y: 200 }, width: 2 }, { x: 40, y: 40, width: 20, height: 20 }));
  assert(segmentIntersectsBox({ p1: { x: 39, y: 50 }, p2: { x: 39, y: 50 }, width: 2 }, { x: 40, y: 40, width: 20, height: 20 }));
});

test("price text moves away from horizontal lines while its price anchor remains unchanged", () => {
  const point = screenPoint(1, "high", 100, 90, true);
  const line = { p1: { x: 0, y: 70 }, p2: { x: 220, y: 70 }, width: 2 };
  const marker = placeSwingLabels([point], { width: 220, height: 220 }, [], [], [line])[0];
  assert(marker.label);
  assert(!segmentIntersectsBox(line, marker.label, 4));
  assert.equal(marker.x, point.x);
  assert.equal(marker.y, point.y);
  assert.equal(marker.price, point.price);
});

test("rectangle interiors remain available while text avoids their outlines", () => {
  const edges: LabelSegment[] = [
    { p1: { x: 10, y: 30 }, p2: { x: 190, y: 30 }, width: 1 },
    { p1: { x: 190, y: 30 }, p2: { x: 190, y: 170 }, width: 1 },
    { p1: { x: 190, y: 170 }, p2: { x: 10, y: 170 }, width: 1 },
    { p1: { x: 10, y: 170 }, p2: { x: 10, y: 30 }, width: 1 },
  ];
  const marker = placeSwingLabels([screenPoint(1, "high", 100, 90)], { width: 220, height: 220 }, [], [], edges)[0];
  assert(marker.label);
  assert.equal(marker.label.y, 60);
  assert(!edges.some(edge => segmentIntersectsBox(edge, marker.label!, 4)));
});

test("dense drawings allow a text gap fallback, but candles and titles still cannot be covered", () => {
  const point = screenPoint(1, "high", 100, 100, true);
  const lines = Array.from({ length: 22 }, (_, i) => ({ p1: { x: 0, y: i * 10 }, p2: { x: 220, y: i * 10 }, width: 2 }));
  const marker = placeSwingLabels([point], { width: 220, height: 220 }, [], [], lines)[0];
  assert(marker.label);
  assert(lines.some(line => segmentIntersectsBox(line, marker.label!, 4)));
  const title = { x: 0, y: 0, width: 220, height: 220 };
  assert.equal(placeSwingLabels([point], { width: 220, height: 220 }, [], [title], lines)[0].label, undefined);
  assert.equal(placeSwingLabels([point], { width: 220, height: 220 }, [title], [], lines)[0].label, undefined);
});

test("long sideways oscillations keep one representative at each repeated boundary", () => {
  const data = rows(Array.from({ length: 400 }, (_, i) => 100 + 0.3 * Math.sin(i * Math.PI / 10)));
  const points = visibleSwingPoints(data, { from: 0, to: 399 }, { plotWidth: 1000, minimumProminence: 0.01 });
  assert.equal(points.length, 2);
  assert(points.every(point => point.extreme));
  assert.equal(points.find(point => point.kind === "high")?.price, Math.max(...data.map(row => row.high)));
  assert.equal(points.find(point => point.kind === "low")?.price, Math.min(...data.map(row => row.low)));
});

test("zooming into a short sideways section restores its individual turns", () => {
  const data = rows(Array.from({ length: 400 }, (_, i) => 100 + 0.3 * Math.sin(i * Math.PI / 10)));
  const options = { plotWidth: 1000, minimumProminence: 0.01 };
  const full = visibleSwingPoints(data, { from: 0, to: 399 }, options);
  const zoom = visibleSwingPoints(data, { from: 0, to: 39 }, options);
  assert(zoom.length > full.length);
  assert(zoom.some(point => !point.extreme));
});

test("new consolidation bands after a breakout retain their own price levels", () => {
  const data = rows(Array.from({ length: 400 }, (_, i) => (i < 200 ? 100 : 125) + 0.5 * Math.sin(i * Math.PI / 10)));
  const points = visibleSwingPoints(data, { from: 0, to: 399 }, { plotWidth: 1000, minimumProminence: 0.01 });
  assert(points.some(point => point.kind === "high" && point.price < 110));
  assert(points.some(point => point.kind === "low" && point.price > 110));
  assert.equal(points.filter(point => point.extreme).length, 2);
});

test("the same level in distant trading sections is not collapsed into a stale annotation", () => {
  const data = rows(Array.from({ length: 1000 }, (_, i) => (i < 200 || i >= 800 ? 100 : 125) + 0.5 * Math.sin(i * Math.PI / 20)));
  const points = visibleSwingPoints(data, { from: 0, to: 999 }, { plotWidth: 1200, minimumProminence: 0.01 });
  assert(points.some(point => point.index < 200));
  assert(points.some(point => point.index >= 800));
  assert.equal(points.filter(point => point.extreme).length, 2);
});

test("the price-text budget follows screen width and always prioritizes both extremes", () => {
  const points = Array.from({ length: 20 }, (_, i) => screenPoint(i, i % 2 ? "low" : "high", 20 + i * 40, i % 2 ? 200 : 100, i === 0 || i === 19));
  const markers = placeSwingLabels(points, { width: 800, height: 300 }, []);
  assert.equal(markers.length, 20);
  assert(markers.filter(marker => marker.label).length <= 8);
  assert(markers.filter(marker => marker.extreme).every(marker => marker.label));
  assert(markers.some(marker => !marker.label));
  const narrow = placeSwingLabels(points.map(point => ({ ...point, x: point.x / 2 })), { width: 400, height: 300 }, []);
  assert(narrow.filter(marker => marker.label).length <= 4);
  assert(narrow.filter(marker => marker.extreme).every(marker => marker.label));
});

test("the lowest price can keep its text in a tight bottom scale margin without covering candles", () => {
  const candle = { x: 95, y: 170, width: 10, height: 10 };
  const marker = placeSwingLabels([screenPoint(1, "low", 100, 180, true)], { width: 220, height: 210 }, [candle])[0];
  assert(marker.label);
  assert(marker.label.y + marker.label.height <= 208);
  assert(!boxesOverlap(marker.label, candle, 4));
});
