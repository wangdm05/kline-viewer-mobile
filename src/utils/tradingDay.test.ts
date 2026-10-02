import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateDaily, tradingDayKey, tradingDayOrder, tradingDaySegments } from "./tradingDay.ts";
import type { KlineRow } from "./parseCsv";

const row = (date: string, open: number, close: number): KlineRow => ({
  time: new Date(date).getTime() / 1000, open, close, high: Math.max(open, close) + 1,
  low: Math.min(open, close) - 1, volume: 1, rawTime: date, dayKey: date.slice(0, 10), isNight: false,
});

test("cursor dates and daily aggregation use the same night-session boundary", () => {
  assert.equal(tradingDayKey(new Date("2025-09-25T21:00:00")), "2025-09-26");
  assert.equal(tradingDayKey(new Date("2025-09-26T00:30:00")), "2025-09-26");
  assert.equal(tradingDayKey(new Date("2025-09-26T09:00:00")), "2025-09-26");
  assert.equal(tradingDayKey(new Date("2025-12-31T21:00:00")), "2026-01-01");
});

test("night, overnight and day candles select the daily bar they contribute to", () => {
  const data = [row("2025-09-25T21:00:00", 100, 102), row("2025-09-26T00:30:00", 102, 103), row("2025-09-26T15:00:00", 103, 110)];
  const daily = aggregateDaily(data);
  assert.equal(daily.length, 1);
  assert.deepEqual(daily[0], { time: "2025-09-26", dayKey: "2025-09-26", open: 100, high: 111, low: 99, close: 110 });
  for (const candle of data) assert.equal(tradingDayKey(new Date(candle.time * 1000)), daily[0].dayKey);
});

test("day-only sessions retain their own date and daily dates do not depend on UTC midnight", () => {
  const daily = aggregateDaily([row("2025-09-26T09:00:00", 110, 112), row("2025-09-26T15:00:00", 112, 115)]);
  assert.equal(daily[0].time, "2025-09-26");
  assert.equal(daily[0].open, 110);
  assert.equal(daily[0].close, 115);
  assert.deepEqual(aggregateDaily([]), []);
});


test("background bands group night, midnight and day session into one trading day", () => {
  const data = [
    row("2025-09-24T15:00:00", 100, 101),
    row("2025-09-24T21:00:00", 101, 102),
    row("2025-09-25T00:30:00", 102, 103),
    row("2025-09-25T09:00:00", 103, 104),
    row("2025-09-25T15:00:00", 104, 105),
    row("2025-09-25T21:00:00", 105, 106),
    row("2025-09-26T15:00:00", 106, 107),
  ];
  assert.deepEqual(tradingDaySegments(data), [
    { dayKey: "2025-09-24", from: 0, to: 0, colorIndex: 0 },
    { dayKey: "2025-09-25", from: 1, to: 4, colorIndex: 1 },
    { dayKey: "2025-09-26", from: 5, to: 6, colorIndex: 0 },
  ]);
  assert.deepEqual(tradingDaySegments(data.slice(2, 5), tradingDayOrder(data)), [
    { dayKey: "2025-09-25", from: 0, to: 2, colorIndex: 1 },
  ]);
});

test("day-only sessions alternate across gaps without inventing a night session", () => {
  const data = [row("2025-09-26T09:00:00", 100, 101), row("2025-09-29T09:00:00", 101, 102)];
  assert.deepEqual(tradingDaySegments(data).map(segment => segment.colorIndex), [0, 1]);
  assert.deepEqual(tradingDaySegments([]), []);
});
