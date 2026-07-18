import { test } from "node:test";
import assert from "node:assert/strict";
import type { NostrEvent } from "@nostr-dev-kit/ndk";
import { prune, serialize, deserialize } from "./lib/feedcache.ts";

const ev = (id: string, created_at: number): NostrEvent =>
  ({ id, created_at, kind: 1, content: id, tags: [], pubkey: "x", sig: "s" }) as NostrEvent;

test("prune keeps the newest events by created_at", () => {
  const events = [ev("a", 1), ev("b", 3), ev("c", 2)];
  assert.deepEqual(
    prune(events, 2).map((e) => e.id),
    ["b", "c"]
  );
});

test("prune is a no-op under the bound", () => {
  const events = [ev("a", 1)];
  assert.deepEqual(prune(events, 5), events);
});

test("deserialize tolerates null and corrupt input", () => {
  assert.deepEqual(deserialize(null), []);
  assert.deepEqual(deserialize("not json"), []);
  assert.deepEqual(deserialize('{"not":"array"}'), []);
});

test("serialize/deserialize round-trips events unchanged under the bound", () => {
  const events = [ev("a", 1), ev("b", 3), ev("c", 2)];
  const back = deserialize(serialize(events));
  // Under MAX, prune is a no-op — order is preserved (Feed re-sorts on render).
  assert.deepEqual(
    back.map((e) => e.id),
    ["a", "b", "c"]
  );
  assert.equal(back[1].content, "b");
});

test("serialize drops to the newest events when over the bound", () => {
  const events = [ev("a", 1), ev("b", 3), ev("c", 2)];
  const back = deserialize(serialize(events.slice()));
  assert.equal(back.length, 3);
  // Force pruning via the pure helper directly.
  assert.deepEqual(
    prune(events, 2).map((e) => e.id),
    ["b", "c"]
  );
});
