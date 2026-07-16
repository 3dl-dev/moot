/**
 * Auth state derivation for the nostr-login integration.
 *
 * nostr-login (see app/providers.tsx) injects a NIP-07-compatible `window.nostr`
 * shim and fires an `onAuth(npub, options)` callback for every login / signup /
 * logout across all methods (local key, NIP-46 remote signer, read-only npub,
 * extension). This module keeps the provider dumb: it turns one raw auth event
 * into the boolean state moot actually cares about, behind a pure, testable seam.
 */

/** Methods nostr-login can authenticate with. `readOnly` = browse-only npub. */
export type NlAuthMethod = "connect" | "extension" | "readOnly" | "local" | "otp";

/** Shape of the `options` argument nostr-login passes to `onAuth`. */
export interface NlAuthOptions {
  type: "login" | "signup" | "logout";
  method?: NlAuthMethod;
  pubkey?: string;
}

/** Resulting moot auth state after an auth event. */
export interface AuthTransition {
  /** True once an identity is attached (signing or read-only). */
  loggedIn: boolean;
  /** True when the identity is a view-only npub and cannot sign events. */
  readOnly: boolean;
}

/**
 * Pure reducer: given a nostr-login auth event, what auth state results?
 *
 * `login` and `signup` both attach an identity; only the `readOnly` method
 * cannot sign. `logout` clears everything.
 */
export function authTransition(o: NlAuthOptions): AuthTransition {
  if (o.type === "logout") return { loggedIn: false, readOnly: false };
  return { loggedIn: true, readOnly: o.method === "readOnly" };
}

/**
 * Can this identity actually sign events? True only when an identity is attached
 * and it is not a view-only npub. Every compose/publish control gates on this so
 * a read-only login never sees signing UI it can't use (see app/providers.tsx).
 */
export function canSign(t: AuthTransition): boolean {
  return t.loggedIn && !t.readOnly;
}
