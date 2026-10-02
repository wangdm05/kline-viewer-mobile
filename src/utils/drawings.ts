import type { UTCTimestamp } from "lightweight-charts";

export type DrawingPoint = { time: UTCTimestamp; price: number };
export type Drawing = {
  id: string;
  type: "trend" | "horiz" | "rect";
  p1: DrawingPoint;
  p2: DrawingPoint;
  color: string;
  title?: string;
};
export type DrawingHandle = "p1" | "p2" | "p3" | "p4";
export type TagTemplate = { id: string; title: string; color: string };
export const drawingStorageKey = "kline-drawings-v1";
export const templateStorageKey = "kline-tag-templates-v1";
export const normalizeTitle = (title: string) => title.trim().slice(0, 60) || "未命名标注";

export function parseDrawings(raw: string | null): Drawing[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Drawing =>
      item && typeof item.id === "string" && ["trend", "horiz", "rect"].includes(item.type) &&
      typeof item.color === "string" && (item.title === undefined || typeof item.title === "string") &&
      [item.p1, item.p2].every(p => p && Number.isFinite(p.time) && Number.isFinite(p.price))
    ).map(item => item.type === "rect" ? { ...item, title: normalizeTitle(item.title ?? "") } : item);
  } catch { return []; }
}

export function parseTemplates(raw: string | null): TagTemplate[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TagTemplate => item && typeof item.id === "string" &&
      typeof item.title === "string" && /^#[0-9a-f]{6}$/i.test(item.color)
    ).map(item => ({ ...item, title: normalizeTitle(item.title) }));
  } catch { return []; }
}

// Opposite corners remain fixed, including when the dragged corner crosses them.
export function resizeDrawing(drawing: Drawing, handle: DrawingHandle, point: DrawingPoint): Drawing {
  if (drawing.type === "horiz") {
    return { ...drawing, p1: { ...drawing.p1, price: point.price }, p2: { ...drawing.p2, price: point.price } };
  }
  if (handle === "p1" || handle === "p2") return { ...drawing, [handle]: point };
  if (handle === "p3") return {
    ...drawing, p1: { ...drawing.p1, time: point.time }, p2: { ...drawing.p2, price: point.price },
  };
  return { ...drawing, p1: { ...drawing.p1, price: point.price }, p2: { ...drawing.p2, time: point.time } };
}

export const rectangleBounds = (p1: { x: number; y: number }, p2: { x: number; y: number }) => ({
  left: Math.min(p1.x, p2.x), top: Math.min(p1.y, p2.y),
  width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y),
});
