import assert from "node:assert";
import { test } from "node:test";
import { isNostrconnectProbe } from "./lib/nostr-login-timeout.ts";

test("matches the nostr-login Nsec.app probe that blocks modal open", () => {
  assert.equal(
    isNostrconnectProbe("https://nsec.app/.well-known/nostr.json"),
    true
  );
});

test("leaves unrelated requests alone", () => {
  // moot's own relay traffic and other NIP-05 lookups must pass through untouched.
  for (const url of [
    "wss://relay.damus.io/",
    "https://moot.pub/.well-known/nostr.json",
    "https://nsec.app/assets/favicon.ico",
    "https://example.com/api",
  ]) {
    assert.equal(isNostrconnectProbe(url), false, url);
  }
});
