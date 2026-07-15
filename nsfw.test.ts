import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { isNsfw } from "./lib/nsfw.ts";

const ev = (tags: string[][]) => ({ tags }) as unknown as NDKEvent;

test("isNsfw flags NIP-36 content-warning (any sensitive content)", () => {
  assert.equal(isNsfw(ev([["content-warning", "nudity"]])), true);
  assert.equal(isNsfw(ev([["content-warning"]])), true);
});

test("isNsfw flags NIP-32 nsfw labels and nsfw hashtags", () => {
  assert.equal(isNsfw(ev([["l", "nsfw"]])), true);
  assert.equal(isNsfw(ev([["t", "porn"]])), true);
  assert.equal(isNsfw(ev([["t", "NSFW"]])), true); // case-insensitive
});

test("isNsfw leaves ordinary posts alone", () => {
  assert.equal(isNsfw(ev([])), false);
  assert.equal(isNsfw(ev([["t", "bitcoin"], ["t", "nostr"]])), false);
  assert.equal(isNsfw(ev([["l", "en"]])), false); // a language label is not nsfw
});
