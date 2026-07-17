import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { buildHop2Authors, followsOf } from "./lib/nostr.ts";

// A minimal contact-list event: author + the pubkeys they follow as `p` tags.
const contacts = (author: string, follows: string[], created_at = 1): NDKEvent =>
  ({
    pubkey: author,
    created_at,
    tags: follows.map((p) => ["p", p]),
  }) as unknown as NDKEvent;

test("followsOf reads p-tag pubkeys from a contact list", () => {
  const ev = contacts("me", ["a", "b"]);
  assert.deepEqual(followsOf(ev), ["a", "b"]);
});

test("hop-2 includes a follow-of-follow absent from hop-1", () => {
  // I follow alice; alice follows carol (whom I don't). Carol is hop-2.
  const authors = buildHop2Authors("me", ["alice"], [contacts("alice", ["carol"])]);
  assert.ok(authors.includes("carol"), "carol (hop-2) should appear");
  assert.ok(authors.includes("alice"), "alice (hop-1) still present");
});

test("hop-2 without the option is just hop-1 (empty contact lists)", () => {
  const authors = buildHop2Authors("me", ["alice", "bob"], []);
  assert.deepEqual(authors, ["alice", "bob"]);
});

test("hop-2 never re-adds yourself and dedupes overlap", () => {
  const authors = buildHop2Authors(
    "me",
    ["alice"],
    [contacts("alice", ["me", "alice", "carol", "carol"])]
  );
  assert.ok(!authors.includes("me"), "self excluded");
  assert.equal(authors.filter((a) => a === "carol").length, 1, "carol deduped");
  assert.equal(authors.filter((a) => a === "alice").length, 1, "alice deduped");
});

test("cap keeps all hop-1 (core) authors, trimming hop-2 first", () => {
  const hop1 = ["a", "b", "c"];
  // Each hop-1 account brings two strangers.
  const lists = [
    contacts("a", ["x1", "x2"]),
    contacts("b", ["x3", "x4"]),
    contacts("c", ["x5", "x6"]),
  ];
  const authors = buildHop2Authors("me", hop1, lists, 4);
  assert.equal(authors.length, 4);
  for (const core of hop1) assert.ok(authors.includes(core), `${core} (hop-1) kept under cap`);
  // Only one hop-2 slot remained after the three core authors.
  assert.equal(authors.filter((a) => a.startsWith("x")).length, 1);
});
