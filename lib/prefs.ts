"use client";

import { useSyncExternalStore } from "react";

/**
 * Device-local UI preferences (no auth), persisted to localStorage like the NSFW
 * flag. Reactive via usePrefs() so a toggle updates every reading surface at once.
 */
export interface Prefs {
  /** Denser post rows (less padding, tighter media). */
  compact: boolean;
  /** New posts stream in live instead of queueing behind the "N new posts" pill. */
  liveScroll: boolean;
  /** Show reply notifications. */
  notifReplies: boolean;
  /** Show @-mention notifications. */
  notifMentions: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  compact: false,
  liveScroll: false,
  notifReplies: true,
  notifMentions: true,
};

const KEY = "moot.prefs.v1";

let state: Prefs = DEFAULT_PREFS;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(KEY);
    // Spread over defaults so fields absent from older stored data get sane values.
    if (raw) state = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* corrupt storage — use defaults */
  }
}

export function getPrefs(): Prefs {
  return state;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  state = { ...state, [key]: value };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive access to UI preferences (re-renders on change). */
export function usePrefs(): Prefs {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => DEFAULT_PREFS
  );
}
