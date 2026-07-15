import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { parseDvmResult } from "./lib/dvm.ts";

const ev = (o: Partial<NDKEvent>) => o as unknown as NDKEvent;

test("parseDvmResult reads the ranked id list from JSON content, in order", () => {
  const content = JSON.stringify([
    ["e", "id1"],
    ["e", "id2"],
    ["e", "id3"],
  ]);
  assert.deepEqual(parseDvmResult(ev({ content, tags: [] })), ["id1", "id2", "id3"]);
});

test("parseDvmResult falls back to the event's own e tags", () => {
  const result = parseDvmResult(
    ev({ content: "processing complete", tags: [["e", "a"], ["p", "x"], ["e", "b"]] })
  );
  assert.deepEqual(result, ["a", "b"]);
});

test("parseDvmResult dedupes", () => {
  const content = JSON.stringify([["e", "dup"], ["e", "dup"], ["e", "uniq"]]);
  assert.deepEqual(parseDvmResult(ev({ content, tags: [] })), ["dup", "uniq"]);
});
