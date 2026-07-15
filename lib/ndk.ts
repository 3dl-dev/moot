import NDK from "@nostr-dev-kit/ndk";

// Phase 0 default relay set. Broad, well-connected relays so the feed shows
// real content from every other Nostr client on day one (the interop thesis).
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
];

let ndk: NDK | undefined;

/** Process-wide NDK singleton. Constructed lazily; connect() is called
 *  client-side from the provider (never during SSR). */
export function getNdk(): NDK {
  if (!ndk) {
    ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
  }
  return ndk;
}
