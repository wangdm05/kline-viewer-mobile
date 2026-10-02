import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDrawings, parseTemplates, rectangleBounds, resizeDrawing, type Drawing } from "./drawings.ts";

const rect = parseDrawings(JSON.stringify([{
  id: "r1", type: "rect", p1: { time: 100, price: 120 }, p2: { time: 200, price: 90 },
  color: "#3b82f6", title: "震荡整理",
}]))[0];

test("drawing storage preserves legacy lines, rectangles and Chinese titles", () => {
  const legacy = { ...rect, id: "l1", type: "trend", title: undefined };
  const restored = parseDrawings(JSON.stringify([legacy, rect]));
  assert.equal(restored.length, 2);
  assert.equal(restored[0].type, "trend");
  assert.equal(restored[1].title, "震荡整理");
  assert.deepEqual(restored[1].p2, rect.p2);
});

test("invalid persisted data cannot break the chart or template controls", () => {
  assert.deepEqual(parseDrawings("invalid JSON"), []);
  assert.deepEqual(parseDrawings(JSON.stringify([null, { ...rect, p1: null }, { ...rect, title: {} }])), []);
  assert.equal(parseDrawings(JSON.stringify([{ ...rect, title: "  " }]))[0].title, "未命名标注");
  assert.deepEqual(parseTemplates(JSON.stringify([{ id: "t1", title: "突破", color: "invalid" }])), []);
  assert.deepEqual(parseTemplates(JSON.stringify([{ id: "t1", title: "  突破  ", color: "#3b82f6" }])),
    [{ id: "t1", title: "突破", color: "#3b82f6" }]);
});

test("all four rectangle handles preserve the opposite corner without mutating the original", () => {
  const point = { time: 300 as Drawing["p1"]["time"], price: 130 };
  assert.deepEqual(resizeDrawing(rect, "p1", point).p2, rect.p2);
  assert.deepEqual(resizeDrawing(rect, "p2", point).p1, rect.p1);
  const p3 = resizeDrawing(rect, "p3", point);
  assert.deepEqual(p3.p1, { time: 300, price: 120 });
  assert.deepEqual(p3.p2, { time: 200, price: 130 });
  const p4 = resizeDrawing(rect, "p4", point);
  assert.deepEqual(p4.p1, { time: 100, price: 130 });
  assert.deepEqual(p4.p2, { time: 300, price: 90 });
  assert.deepEqual(rect.p1, { time: 100, price: 120 });
  assert.equal(p4.title, "震荡整理");
});

test("reversed rectangle corners still produce positive drawing bounds", () => {
  assert.deepEqual(rectangleBounds({ x: 400, y: 500 }, { x: 100, y: 200 }),
    { left: 100, top: 200, width: 300, height: 300 });
});

test("line endpoint resizing and horizontal prices remain compatible", () => {
  const point = { time: 150 as Drawing["p1"]["time"], price: 105 };
  assert.deepEqual(resizeDrawing({ ...rect, type: "trend" }, "p2", point).p2, point);
  const horizontal = resizeDrawing({ ...rect, type: "horiz" }, "p2", point);
  assert.equal(horizontal.p1.price, 105);
  assert.equal(horizontal.p2.price, 105);
});
