"use client";

import { useSyncExternalStore } from "react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

/**
 * Device-local mute list (pubkeys + keywords), persisted to localStorage.
 * No auth: this never publishes a NIP-51 list — it's your local filter. A
 * "sync to Nostr" option can come later once you're logged in.
 */
const KEY = "moot.mutes.v1";

export interface Mutes {
  pubkeys: string[];
  words: string[];
  communities: string[]; // "34550:<pubkey>:<id>" coordinates
}

const EMPTY: Mutes = { pubkeys: [], words: [], communities: [] };

let state: Mutes = EMPTY;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(KEY);
    // Spread over EMPTY so lists absent from older stored data default to [].
    if (raw) state = { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    /* corrupt storage — start clean */
  }
}

// While logged in, providers registers a publisher so mute changes also update
// the user's NIP-51 kind:10000 list (see lib/mutesync.ts). Null when logged out.
type Publisher = (mutes: Mutes) => void;
let publisher: Publisher | null = null;
export function setMutePublisher(fn: Publisher | null) {
  publisher = fn;
}

function commit(next: Mutes) {
  state = next;
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
  publisher?.(state);
}

/** Current mute list (non-reactive). */
export function getMutes(): Mutes {
  return state;
}

export function mutePubkey(pubkey: string) {
  if (!state.pubkeys.includes(pubkey))
    commit({ ...state, pubkeys: [...state.pubkeys, pubkey] });
}
export function unmutePubkey(pubkey: string) {
  commit({ ...state, pubkeys: state.pubkeys.filter((p) => p !== pubkey) });
}
export function muteWord(word: string) {
  const w = word.trim().toLowerCase();
  if (w && !state.words.includes(w)) commit({ ...state, words: [...state.words, w] });
}
export function unmuteWord(word: string) {
  commit({ ...state, words: state.words.filter((w) => w !== word) });
}
export function muteCommunity(addr: string) {
  if (!state.communities.includes(addr))
    commit({ ...state, communities: [...state.communities, addr] });
}
export function unmuteCommunity(addr: string) {
  commit({ ...state, communities: state.communities.filter((a) => a !== addr) });
}
export function clearMutes() {
  commit({ ...EMPTY });
}

/**
 * True if this event is hidden by the given mute list. Pure (no localStorage /
 * React) so it's unit-testable; `isMuted` binds it to the live store.
 *
 * A community post carries the community coordinate in an `a` tag (classic
 * NIP-72 kind:1) or `A` tag (NIP-22 kind:1111) — see lib/nostr.ts — so muting a
 * community hides everything scoped to it.
 */
export function matchesMute(ev: NDKEvent, mutes: Mutes): boolean {
  if (mutes.pubkeys.includes(ev.pubkey)) return true;
  if (
    mutes.communities.length &&
    ev.tags.some((t) => (t[0] === "a" || t[0] === "A") && mutes.communities.includes(t[1]))
  )
    return true;
  if (mutes.words.length) {
    const c = ev.content.toLowerCase();
    if (mutes.words.some((w) => c.includes(w))) return true;
  }
  return false;
}

/** True if an event should be hidden by the current mute list. */
export function isMuted(ev: NDKEvent): boolean {
  return matchesMute(ev, state);
}

/* ===================== NIP-51 kind:10000 mute-list sync ===================== */

export const KIND_MUTE_LIST = 10000;

/** The mute fields moot syncs to/from NIP-51 (a subset of Mutes). */
export type RemoteMutes = Pick<Mutes, "pubkeys" | "words" | "communities">;

/**
 * Parse the PUBLIC tags of a NIP-51 kind:10000 list into moot's model:
 * `p`→pubkey, `word`→word, `a`→community coordinate. Private (NIP-04 encrypted)
 * mute content is preserved on write but not yet read — that's a superset-reader
 * follow-up. Unknown tags (`t` hashtags, `e` threads) are ignored here.
 */
export function parseMuteTags(tags: string[][]): RemoteMutes {
  const pubkeys: string[] = [];
  const words: string[] = [];
  const communities: string[] = [];
  for (const t of tags) {
    if (t[0] === "p" && t[1]) pubkeys.push(t[1]);
    else if (t[0] === "word" && t[1]) words.push(t[1].toLowerCase());
    else if (t[0] === "a" && t[1]) communities.push(t[1]);
  }
  return { pubkeys, words, communities };
}

/** Tags moot owns in the list — rebuilt from state on republish; all others preserved. */
export function isManagedMuteTag(t: string[]): boolean {
  return t[0] === "p" || t[0] === "word" || t[0] === "a";
}

/**
 * Full public tag set for a kind:10000 republish: moot's current mutes plus any
 * *unmanaged* tags carried over from the existing event, so we never clobber a
 * user's hashtag/thread mutes or another client's entries.
 */
export function buildMuteTags(mutes: Mutes, preservedTags: string[][] = []): string[][] {
  return [
    ...mutes.pubkeys.map((p) => ["p", p]),
    ...mutes.words.map((w) => ["word", w]),
    ...mutes.communities.map((a) => ["a", a]),
    ...preservedTags.filter((t) => !isManagedMuteTag(t)),
  ];
}

/** Union two mute sets, de-duplicated. */
export function mergeMutes(a: Mutes, b: RemoteMutes): Mutes {
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    pubkeys: uniq([...a.pubkeys, ...b.pubkeys]),
    words: uniq([...a.words, ...b.words]),
    communities: uniq([...a.communities, ...b.communities]),
  };
}

/** True if `a` already contains everything in `b` (so no republish is needed). */
export function muteSuperset(a: Mutes, b: RemoteMutes): boolean {
  const has = (xs: string[], ys: string[]) => ys.every((y) => xs.includes(y));
  return has(a.pubkeys, b.pubkeys) && has(a.words, b.words) && has(a.communities, b.communities);
}

/** Fold a remote mute list into local state (union). Used to hydrate on login. */
export function mergeRemote(remote: RemoteMutes) {
  commit(mergeMutes(state, remote));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** Reactive access to the mute list (re-renders on change). */
export function useMutes(): Mutes {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY
  );
}
