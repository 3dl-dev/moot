import assert from "node:assert";
import { test } from "node:test";
import { relaysSupportSearch, SEARCH_RELAYS } from "./lib/search.ts";
import { DEFAULT_RELAYS } from "./lib/ndk.ts";

test("relaysSupportSearch is true iff a NIP-50-capable relay is present", () => {
  assert.equal(relaysSupportSearch(["wss://relay.nostr.band"]), true);
  assert.equal(relaysSupportSearch(["wss://relay.noswhere.com", "wss://relay.damus.io"]), true);
  assert.equal(relaysSupportSearch(["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"]), false);
  assert.equal(relaysSupportSearch([]), false);
});

test("SEARCH_RELAYS are all recognised as search-capable", () => {
  for (const r of SEARCH_RELAYS) assert.equal(relaysSupportSearch([r]), true);
});

test("moot's default relay set supports search (includes a NIP-50 relay)", () => {
  assert.equal(relaysSupportSearch(DEFAULT_RELAYS), true);
});
