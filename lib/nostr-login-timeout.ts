/**
 * Bound nostr-login's blocking NIP-46 probe so the auth modal always opens fast.
 *
 * nostr-login's launch() (see app/providers.tsx) does, *before* it mounts the
 * modal into the DOM:
 *
 *     await fetch("https://nsec.app/.well-known/nostr.json")   // no timeout
 *
 * to resolve the Nsec.app remote-signer relay. When that endpoint is slow or
 * unreachable the fetch hangs, so the user clicks "Log in" and stares at nothing
 * for a long time (observed multi-second delay). nostr-login already `catch`es a
 * failed probe and falls back to its default relay — it just never gives up.
 *
 * moot can't hand nostr-login an AbortSignal, but nostr-login calls the global
 * `fetch`, so we wrap `fetch` and attach a timeout to *only* that one probe URL.
 * Everything else passes through untouched. Worst case the modal now opens after
 * `timeoutMs` with the default relay instead of hanging indefinitely.
 */

/** Is this the nostr-login Nsec.app probe that must not block modal open? */
export function isNostrconnectProbe(url: string): boolean {
  return url.includes("nsec.app/.well-known/nostr.json");
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Install the global-`fetch` wrapper. Idempotent and browser-only; must run
 * before nostr-login's init() so the probe is already bounded.
 */
export function installNostrconnectFetchTimeout(timeoutMs = 3000): void {
  if (typeof window === "undefined") return;
  const w = window as typeof window & { __mootNcFetchPatched?: boolean };
  if (w.__mootNcFetchPatched) return;
  w.__mootNcFetchPatched = true;

  // AbortSignal.timeout is in every evergreen browser; guard so an old one falls
  // back to the (unbounded) original fetch rather than throwing and breaking login.
  const canTimeout = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function";

  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // Only bound the probe, and only if the caller didn't already pass a signal.
    if (canTimeout && isNostrconnectProbe(urlOf(input)) && !init?.signal) {
      return orig(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    }
    return orig(input, init);
  };
}
