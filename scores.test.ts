import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { zapSats } from "./lib/nostr.ts";

const ev = (tags: string[][]) => ({ tags }) as unknown as NDKEvent;

test("zapSats reads sats from the embedded zap-request amount (msats)", () => {
  const desc = JSON.stringify({ tags: [["amount", "21000"], ["e", "abc"]] });
  assert.equal(zapSats(ev([["description", desc]])), 21);
});

test("zapSats is 0 without a parseable amount", () => {
  assert.equal(zapSats(ev([])), 0);
  assert.equal(zapSats(ev([["description", "not json"]])), 0);
  assert.equal(zapSats(ev([["description", JSON.stringify({ tags: [] })]])), 0);
});
