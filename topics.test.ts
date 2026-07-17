import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { hashtagCount, isHashtagStuffed, MAX_TOPIC_HASHTAGS } from "./lib/nostr.ts";

const withTags = (tags: string[][]) => ({ tags }) as unknown as NDKEvent;
const hashtags = (n: number) => withTags(Array.from({ length: n }, (_, i) => ["t", `tag${i}`]));

test("hashtagCount counts only t tags", () => {
  const ev = withTags([
    ["t", "art"],
    ["t", "photo"],
    ["e", "abc"],
    ["p", "def"],
  ]);
  assert.equal(hashtagCount(ev), 2);
});

test("isHashtagStuffed passes a normal post and rejects a stuffed one", () => {
  // A genuine topic post uses a handful of hashtags — never flagged.
  assert.equal(isHashtagStuffed(hashtags(3)), false);
  assert.equal(isHashtagStuffed(hashtags(MAX_TOPIC_HASHTAGS)), false); // at the cap
  // Link-spam bots stuff dozens; the measured spam wall sits at 11+.
  assert.equal(isHashtagStuffed(hashtags(MAX_TOPIC_HASHTAGS + 1)), true);
  assert.equal(isHashtagStuffed(hashtags(30)), true);
});

test("isHashtagStuffed honors a custom cap", () => {
  assert.equal(isHashtagStuffed(hashtags(5), 4), true);
  assert.equal(isHashtagStuffed(hashtags(4), 4), false);
});
