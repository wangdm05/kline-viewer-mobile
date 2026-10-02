import { test } from "node:test";
import assert from "node:assert/strict";
import { moveDrawingTimes, openInterestData, visibleExtrema } from "./chartMath.ts";
import type { KlineRow } from "./parseCsv";

const rows: KlineRow[] = [
  { time: 100, high: 120, low: 95, volume: 10, openInterest: 50000 },
  { time: 160, high: 110, low: 90, volume: 20 },
  { time: 10000, high: 115, low: 80, volume: 30, openInterest: 0 },
  { time: 10060, high: 112, low: 92, volume: 40, openInterest: 49800 },
].map(row => ({ open: 100, close: 101, rawTime: "", dayKey: "", isNight: false, ...row }));

test("visible extrema exclude candles outside the zoomed viewport", () => {
  assert.equal(visibleExtrema(rows, { from: -0.5, to: 3.5 })?.high.high, 120);
  const zoomed = visibleExtrema(rows, { from: 0.1, to: 3 });
  assert.equal(zoomed?.high.high, 115);
  assert.equal(zoomed?.low.low, 80);
  const panned = visibleExtrema(rows, { from: 2.1, to: 8 });
  assert.equal(panned?.high.high, 112);
  assert.equal(panned?.low.low, 92);
});

test("empty, single-candle and off-data viewports", () => {
  assert.equal(visibleExtrema([], { from: 0, to: 3 }), null);
  assert.equal(visibleExtrema(rows, null), null);
  assert.equal(visibleExtrema(rows, { from: 4, to: 10 }), null);
  assert.equal(visibleExtrema(rows, { from: -10, to: -1 }), null);
  assert.equal(visibleExtrema(rows, { from: 1, to: 1 })?.low.low, 90);
});

test("dragging across a session gap keeps endpoints on bars and preserves span", () => {
  assert.deepEqual(moveDrawingTimes(rows, 100, 160, 1), [160, 10000]);
  assert.deepEqual(moveDrawingTimes(rows, 100, 160, 20), [10000, 10060]);
  assert.deepEqual(moveDrawingTimes(rows, 10000, 160, -20), [160, 100]);
});

test("OI uses its own values, retains zero and leaves missing timestamps as whitespace", () => {
  assert.deepEqual(openInterestData(rows), [
    { time: 100, value: 50000 }, { time: 160 },
    { time: 10000, value: 0 }, { time: 10060, value: 49800 },
  ]);
  assert.equal(openInterestData([{ ...rows[0], openInterest: Infinity }])[0].value, undefined);
});
