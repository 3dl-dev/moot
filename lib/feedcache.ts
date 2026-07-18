// Per-tab feed snapshot.
//
// Why: the feed subscribes cold on every mount, so you stare at
// "Connecting to relays…" / "Nothing here yet." for a second before the first
// events arrive. Snapshotting the last-shown posts lets a reload (or a
// back-navigation) paint real content instantly; the live subscription then
// merges fresh events in on top and dedupes.
//
// sessionStorage (not localStorage) on purpose: the snapshot is a warm-start
// convenience for the current tab session, not a durable archive — it should
// not resurrect week-old posts as if they were current.
//
// Pure helpers (prune/serialize/deserialize) are storage-agnostic and DOM-free
// so they unit-test without a browser (see feedcache.test.ts).

import type { NostrEvent } from "@nostr-dev-kit/ndk";

const PREFIX = "moot:feed:v1:";
// How many posts to snapshot per feed. Enough to fill the first screen or two;
// the live subscription supplies the rest.
const MAX = 40;

/** Keep the newest `max` events by created_at. Pure, unit-testable. */
export function prune(events: NostrEvent[], max = MAX): NostrEvent[] {
  if (events.length <= max) return events;
  return [...events]
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, max);
}

/** Parse a stored blob into raw events. Tolerates null/corrupt data. */
export function deserialize(raw: string | null): NostrEvent[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as NostrEvent[]) : [];
  } catch {
    return [];
  }
}

/** Serialize a (pruned) event list to a JSON blob. */
export function serialize(events: NostrEvent[]): string {
  return JSON.stringify(prune(events));
}

function storage(): Storage | null {
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    // blocked in some privacy modes
  }
  return null;
}

/** Load the snapshot for a feed key (the filters' JSON), as raw events. */
export function loadFeed(key: string): NostrEvent[] {
  const store = storage();
  if (!store) return [];
  try {
    return deserialize(store.getItem(PREFIX + key));
  } catch {
    return [];
  }
}

/** Persist a feed snapshot. Best-effort — never throws into the render path. */
export function saveFeed(key: string, events: NostrEvent[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PREFIX + key, serialize(events));
  } catch {
    // quota / blocked — skip
  }
}
