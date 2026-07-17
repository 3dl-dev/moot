import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { powBits, eventPow, meetsMinPow } from "./lib/pow.ts";

const ev = (id?: string): NDKEvent => ({ id }) as unknown as NDKEvent;

test("powBits counts leading zero bits within the first nibble", () => {
  assert.equal(powBits("ffff"), 0); // 1111… → no leading zeros
  assert.equal(powBits("8000"), 0); // 1000… → 0
  assert.equal(powBits("4000"), 1); // 0100… → 1
  assert.equal(powBits("2000"), 2); // 0010… → 2
  assert.equal(powBits("1000"), 3); // 0001… → 3
});

test("powBits accumulates whole zero nibbles then the partial one", () => {
  assert.equal(powBits("0fff"), 4); // one zero nibble, then 1111
  assert.equal(powBits("00ff"), 8);
  assert.equal(powBits("08ff"), 4); // 0000 1000 → 4
  assert.equal(powBits("001f"), 11); // 0000 0000 0001 → 8 + 3
});

test("powBits matches the NIP-13 spec example (36 bits)", () => {
  const id = "000000000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d";
  assert.equal(powBits(id), 36);
});

test("powBits stops cleanly on a malformed id", () => {
  assert.equal(powBits(""), 0);
  assert.equal(powBits("00zz"), 8); // counts the leading zeros, halts at junk
});

test("eventPow reads the event id; missing id is 0 difficulty", () => {
  assert.equal(eventPow(ev("00ffdead")), 8);
  assert.equal(eventPow(ev(undefined)), 0);
});

test("meetsMinPow: 0/negative threshold is a no-op pass", () => {
  assert.equal(meetsMinPow(ev("ffffffff"), 0), true);
  assert.equal(meetsMinPow(ev(undefined), 0), true);
  assert.equal(meetsMinPow(ev("ffffffff"), -5), true);
});

test("meetsMinPow gates below the threshold and passes at/above it", () => {
  assert.equal(meetsMinPow(ev("00ffffff"), 8), true); // exactly 8
  assert.equal(meetsMinPow(ev("00ffffff"), 9), false); // needs 9, has 8
  assert.equal(meetsMinPow(ev("000fffff"), 12), true); // 12 ≥ 12
  assert.equal(meetsMinPow(ev("ffffffff"), 8), false); // no PoW at all
  assert.equal(meetsMinPow(ev(undefined), 8), false); // unsigned/no id fails
});
