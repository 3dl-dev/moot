import { test } from "node:test";
import assert from "node:assert/strict";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { attributeReplies, orderByDiscussion } from "./lib/nostr.ts";

/** Minimal reply event with id + e/E tags. */
const reply = (id: string, tags: string[][]): NDKEvent =>
  ({ id, tags, content: "", kind: 1, pubkey: "p", created_at: 1 }) as unknown as NDKEvent;

test("attributeReplies groups replies under the root they tag (e)", () => {
  const evs = [
    reply("r1", [["e", "root1"]]),
    reply("r2", [["e", "root1"]]),
    reply("r3", [["e", "root2"]]),
  ];
  const m = attributeReplies(["root1", "root2"], evs);
  assert.equal(m.get("root1")!.length, 2);
  assert.equal(m.get("root2")!.length, 1);
});

test("attributeReplies honors NIP-22 uppercase E root marker", () => {
  const m = attributeReplies(["root1"], [reply("r1", [["E", "root1"], ["e", "parentX"]])]);
  assert.equal(m.get("root1")!.length, 1);
});

test("attributeReplies dedupes a reply that tags the same root twice", () => {
  const m = attributeReplies(["root1"], [reply("r1", [["e", "root1"], ["E", "root1"]])]);
  assert.equal(m.get("root1")!.length, 1);
});

test("attributeReplies gives every requested root an entry, empty if none", () => {
  const m = attributeReplies(["root1", "root2"], [reply("r1", [["e", "root1"]])]);
  assert.deepEqual(m.get("root2"), []);
  assert.equal(m.size, 2);
});

test("attributeReplies ignores replies to roots outside the set", () => {
  const m = attributeReplies(["root1"], [reply("r1", [["e", "unrelated"]])]);
  assert.equal(m.get("root1")!.length, 0);
});

test("orderByDiscussion leads with the most-replied, ties keep input order", () => {
  const items = [
    { id: "a" }, // 0 replies
    { id: "b" }, // 5 replies
    { id: "c" }, // 0 replies
    { id: "d" }, // 5 replies
  ];
  const counts = new Map([
    ["a", 0],
    ["b", 5],
    ["c", 0],
    ["d", 5],
  ]);
  const ordered = orderByDiscussion(items, (id) => counts.get(id) ?? 0).map((x) => x.id);
  // b and d (5 each) lead in original relative order; then a, c (0 each).
  assert.deepEqual(ordered, ["b", "d", "a", "c"]);
});

test("orderByDiscussion does not mutate its input", () => {
  const items = [{ id: "a" }, { id: "b" }];
  const before = items.map((x) => x.id);
  orderByDiscussion(items, () => 0);
  assert.deepEqual(
    items.map((x) => x.id),
    before
  );
});
