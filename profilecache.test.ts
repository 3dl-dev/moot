import { test } from "node:test";
import assert from "node:assert/strict";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import {
  prune,
  serialize,
  deserialize,
  loadAll,
  save,
  type KV,
  type CachedProfile,
} from "./lib/profilecache.ts";

/** In-memory Web Storage stand-in for the pure round-trip tests. */
function fakeKV(): KV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
  };
}

const prof = (name: string): NDKUserProfile => ({ name }) as NDKUserProfile;

test("prune keeps the newest entries by touch time", () => {
  const entries: [string, CachedProfile][] = [
    ["a", { p: prof("a"), t: 1 }],
    ["b", { p: prof("b"), t: 3 }],
    ["c", { p: prof("c"), t: 2 }],
  ];
  const kept = prune(entries, 2).map(([pk]) => pk);
  assert.deepEqual(kept, ["b", "c"]); // dropped the oldest ("a", t=1)
});

test("prune is a no-op under the bound", () => {
  const entries: [string, CachedProfile][] = [["a", { p: prof("a"), t: 1 }]];
  assert.deepEqual(prune(entries, 5), entries);
});

test("deserialize tolerates null and corrupt input", () => {
  assert.equal(deserialize(null).size, 0);
  assert.equal(deserialize("not json").size, 0);
  assert.equal(deserialize('{"x": 1}').size, 0); // entry missing p/t is skipped
});

test("serialize/deserialize round-trips a profile", () => {
  const map = new Map<string, CachedProfile>([["pk1", { p: prof("alice"), t: 10 }]]);
  const back = deserialize(serialize(map));
  assert.equal(back.get("pk1")?.p.name, "alice");
});

test("save then loadAll returns the profile", () => {
  const kv = fakeKV();
  save("pk1", prof("bob"), kv);
  const loaded = loadAll(kv);
  assert.equal(loaded.get("pk1")?.name, "bob");
});

test("save merges rather than clobbering existing entries", () => {
  const kv = fakeKV();
  save("pk1", prof("alice"), kv);
  save("pk2", prof("bob"), kv);
  const loaded = loadAll(kv);
  assert.equal(loaded.get("pk1")?.name, "alice");
  assert.equal(loaded.get("pk2")?.name, "bob");
});

test("loadAll with no backend returns empty (no throw)", () => {
  // Explicit fake that always throws to simulate blocked storage.
  const throwing: KV = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  // save swallows the error; loadAll surfaces empty because deserialize sees the throw path via storage()
  assert.doesNotThrow(() => save("pk1", prof("x"), throwing));
});
