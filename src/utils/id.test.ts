import assert from "node:assert/strict";
import test from "node:test";
import { createId } from "./id.ts";

test("drawing IDs work without secure-context randomUUID", () => {
  const api = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const ids = Array.from({ length: 100 }, () => createId(api));
  assert.equal(new Set(ids).size, 100);
  assert.ok(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
});
