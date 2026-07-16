import NDK, { NDKEvent, NDKRelaySet, type NDKFilter } from "@nostr-dev-kit/ndk";

/**
 * Full-text search over Nostr via NIP-50 (the relay `search` filter field).
 * Only some relays implement it, so we query a known-capable subset of our
 * default relays and degrade gracefully (a notice) when none are available.
 */

/**
 * Dedicated NIP-50 search relays, queried regardless of the user's feed relays.
 * Multiple providers for resilience: nostr.band and noswhere are the mainstays,
 * search.nos.today adds coverage. (primal.net is a standard relay that does not
 * serve generic NIP-50 search, so it's intentionally excluded.)
 */
export const SEARCH_RELAYS = [
  "wss://relay.nostr.band",
  "wss://relay.noswhere.com",
  "wss://search.nos.today",
];

/** True if any of the given relay URLs is NIP-50-capable. */
export function relaysSupportSearch(relays: string[]): boolean {
  return relays.some((r) => SEARCH_RELAYS.includes(r));
}

// NIP-50 adds `search` to the filter; older NDK filter types may omit it.
type SearchFilter = NDKFilter & { search: string };

/**
 * Run a NIP-50 search for `query` over the given kinds against the search-capable
 * relays, returning matching events. Resolves on EOSE or after `capMs`.
 */
export function searchEvents(
  ndk: NDK,
  query: string,
  kinds: number[],
  capMs = 5000
): Promise<NDKEvent[]> {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  const relaySet = NDKRelaySet.fromRelayUrls(SEARCH_RELAYS, ndk);
  return new Promise((resolve) => {
    const events = new Map<string, NDKEvent>();
    const sub = ndk.subscribe(
      { kinds, search: q, limit: 40 } as SearchFilter,
      { closeOnEose: true, relaySet }
    );
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub.stop();
      resolve([...events.values()]);
    };
    sub.on("event", (e: NDKEvent) => {
      if (e.id) events.set(e.id, e);
    });
    sub.on("eose", finish);
    setTimeout(finish, capMs);
  });
}
