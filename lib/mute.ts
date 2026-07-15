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
}

let state: Mutes = { pubkeys: [], words: [] };
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { pubkeys: [], words: [], ...JSON.parse(raw) };
  } catch {
    /* corrupt storage — start clean */
  }
}

function commit(next: Mutes) {
  state = next;
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
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
export function clearMutes() {
  commit({ pubkeys: [], words: [] });
}

/** True if an event should be hidden by the current mute list. */
export function isMuted(ev: NDKEvent): boolean {
  if (state.pubkeys.includes(ev.pubkey)) return true;
  if (state.words.length) {
    const c = ev.content.toLowerCase();
    if (state.words.some((w) => c.includes(w))) return true;
  }
  return false;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emptyServer: Mutes = { pubkeys: [], words: [] };

/** Reactive access to the mute list (re-renders on change). */
export function useMutes(): Mutes {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => emptyServer
  );
}
