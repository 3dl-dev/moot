import assert from "node:assert";
import { test } from "node:test";
import { authTransition, canSign } from "./lib/auth.ts";

test("logout clears identity and read-only", () => {
  assert.deepEqual(authTransition({ type: "logout" }), {
    loggedIn: false,
    readOnly: false,
  });
});

test("read-only npub logs in but cannot sign", () => {
  assert.deepEqual(authTransition({ type: "login", method: "readOnly" }), {
    loggedIn: true,
    readOnly: true,
  });
});

test("local-key signup is a full signing identity", () => {
  assert.deepEqual(authTransition({ type: "signup", method: "local" }), {
    loggedIn: true,
    readOnly: false,
  });
});

test("NIP-46 and extension logins can sign", () => {
  for (const method of ["connect", "extension"] as const) {
    assert.equal(authTransition({ type: "login", method }).readOnly, false);
    assert.equal(authTransition({ type: "login", method }).loggedIn, true);
  }
});

test("a login with no method reported defaults to signing", () => {
  // nostr-login occasionally restores a session without a method tag; treat an
  // unknown method as signing-capable rather than silently read-only.
  assert.deepEqual(authTransition({ type: "login" }), {
    loggedIn: true,
    readOnly: false,
  });
});

test("canSign gates compose UI: only attached, non-read-only identities sign", () => {
  // The whole point of moot-404: a read-only npub must NOT be offered compose.
  assert.equal(canSign({ loggedIn: false, readOnly: false }), false); // logged out
  assert.equal(canSign({ loggedIn: true, readOnly: true }), false); // view-only npub
  assert.equal(canSign({ loggedIn: true, readOnly: false }), true); // signing identity
});

test("canSign is false for every read-only auth event, true for signing methods", () => {
  assert.equal(canSign(authTransition({ type: "login", method: "readOnly" })), false);
  assert.equal(canSign(authTransition({ type: "logout" })), false);
  for (const method of ["connect", "extension", "local", "otp"] as const) {
    assert.equal(canSign(authTransition({ type: "login", method })), true);
  }
});
