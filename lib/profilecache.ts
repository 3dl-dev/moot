// Persistent kind:0 profile cache.
//
// Why: without persistence, every page load starts with zero known profiles, so
// avatars and display names visibly "pop in" one-by-one as each kind:0 fetch
// lands over the relay. Persisting the last-seen profiles to localStorage lets
// the very first paint render real names/avatars from the previous visit, and
// the network fetch just refreshes them in place. This is the single biggest
// win against the "boring, laggy" feel.
//
// The pure helpers (serialize/deserialize/prune) are storage-agnostic so they
// unit-test without a DOM (see profilecache.test.ts). The React hook layer lives
// in lib/hooks.ts and calls loadAll()/save() around its in-memory Map.

import type { NDKUserProfile } from "@nostr-dev-kit/ndk";

const KEY = "moot:profiles:v1";
// Bound the persisted set so a heavy scrolling session can't grow localStorage
// without limit. LRU by last-touched time; plenty for a warm first paint.
const MAX = 800;

export interface CachedProfile {
  /** The kind:0 profile fields we render (name, image, nip05, …). */
  p: NDKUserProfile;
  /** Last-touched epoch ms — drives LRU pruning. */
  t: number;
}

/** Minimal storage shape so tests can inject a fake (Web Storage-compatible). */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Keep the newest `max` entries by touch time. Pure, so it's unit-testable. */
export function prune(entries: [string, CachedProfile][], max = MAX): [string, CachedProfile][] {
  if (entries.length <= max) return entries;
  return [...entries].sort((a, b) => b[1].t - a[1].t).slice(0, max);
}

/** Parse the persisted blob into a Map. Tolerates missing/corrupt data. */
export function deserialize(raw: string | null): Map<string, CachedProfile> {
  const map = new Map<string, CachedProfile>();
  if (!raw) return map;
  try {
    const obj = JSON.parse(raw) as Record<string, CachedProfile>;
    for (const [pk, entry] of Object.entries(obj)) {
      if (entry && entry.p && typeof entry.t === "number") map.set(pk, entry);
    }
  } catch {
    // corrupt cache — start empty rather than throw
  }
  return map;
}

/** Serialize a (pruned) Map back to a JSON blob. */
export function serialize(map: Map<string, CachedProfile>): string {
  return JSON.stringify(Object.fromEntries(prune([...map.entries()])));
}

/** Resolve a storage backend, or null when unavailable (SSR / privacy mode). */
function storage(kv?: KV): KV | null {
  if (kv) return kv;
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // localStorage can throw in some privacy modes
  }
  return null;
}

/** Load all persisted profiles as a plain map of pubkey → profile. */
export function loadAll(kv?: KV): Map<string, NDKUserProfile> {
  const store = storage(kv);
  const out = new Map<string, NDKUserProfile>();
  if (!store) return out;
  try {
    for (const [pk, entry] of deserialize(store.getItem(KEY))) out.set(pk, entry.p);
  } catch {
    // blocked/unreadable storage — render with no warm cache rather than throw
  }
  return out;
}

/**
 * Persist a single profile, merging into whatever is already stored and pruning
 * to the LRU bound. Best-effort: any storage error is swallowed so profile
 * rendering never breaks on a full/blocked localStorage.
 */
export function save(pubkey: string, profile: NDKUserProfile, kv?: KV): void {
  const store = storage(kv);
  if (!store) return;
  try {
    const map = deserialize(store.getItem(KEY));
    map.set(pubkey, { p: profile, t: Date.now() });
    store.setItem(KEY, serialize(map));
  } catch {
    // full or blocked storage — skip persistence, keep rendering
  }
}
