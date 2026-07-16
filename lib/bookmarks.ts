"use client";

import { useSyncExternalStore } from "react";

/**
 * Device-local bookmark list (event ids), persisted to localStorage and — when
 * logged in — mirrored to the user's NIP-51 kind:10003 bookmark list so saves
 * follow you across devices and clients. Structurally this is the mute list's
 * simpler cousin (see lib/mute.ts): a replaceable list we read as a superset and
 * write conservatively, never clobbering entries other clients put there.
 *
 * Local-first: bookmarking works logged out (localStorage only); logging in folds
 * the remote list in and starts publishing. Newest bookmark is kept first for the
 * Saved view's reverse-chronological feel.
 */
const KEY = "moot.bookmarks.v1";

export const KIND_BOOKMARK_LIST = 10003;

const EMPTY: string[] = [];

let state: string[] = EMPTY;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) state = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    /* corrupt storage — start clean */
  }
}

// While logged in, providers registers a publisher so bookmark changes also
// update the user's NIP-51 kind:10003 list (see lib/bookmarksync.ts). Null when
// logged out or read-only.
type Publisher = (ids: string[]) => void;
let publisher: Publisher | null = null;
export function setBookmarkPublisher(fn: Publisher | null) {
  publisher = fn;
}

function commit(next: string[]) {
  state = next;
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
  publisher?.(state);
}

/** Current bookmark ids, newest first (non-reactive). */
export function getBookmarks(): string[] {
  return state;
}

/** True if this event id is bookmarked (non-reactive). */
export function isBookmarked(id: string): boolean {
  return state.includes(id);
}

export function addBookmark(id: string) {
  if (id && !state.includes(id)) commit([id, ...state]);
}
export function removeBookmark(id: string) {
  if (state.includes(id)) commit(state.filter((x) => x !== id));
}
export function toggleBookmark(id: string) {
  if (state.includes(id)) removeBookmark(id);
  else addBookmark(id);
}
export function clearBookmarks() {
  commit([]);
}

/* ==================== NIP-51 kind:10003 bookmark-list sync ==================== */

/**
 * Read the PUBLIC bookmarked note ids from a kind:10003 list's `e` tags. Other
 * bookmark kinds (`a` addressable, `t` hashtags, `r` urls) and NIP-04-encrypted
 * private bookmarks are preserved on write but not surfaced in Saved yet — a
 * superset-reader follow-up, mirroring how mutes defer encrypted entries.
 */
export function parseBookmarkTags(tags: string[][]): string[] {
  const ids: string[] = [];
  for (const t of tags) if (t[0] === "e" && t[1]) ids.push(t[1]);
  return ids;
}

/** Tags moot owns in the list (note bookmarks); everything else is preserved. */
export function isManagedBookmarkTag(t: string[]): boolean {
  return t[0] === "e";
}

/**
 * Full public tag set for a kind:10003 republish: moot's current note bookmarks
 * plus any *unmanaged* tags carried over from the existing event, so we never
 * clobber a user's article/hashtag/url bookmarks or another client's entries.
 */
export function buildBookmarkTags(ids: string[], preservedTags: string[][] = []): string[][] {
  return [
    ...ids.map((id) => ["e", id]),
    ...preservedTags.filter((t) => !isManagedBookmarkTag(t)),
  ];
}

/** Union two id lists, de-duplicated, keeping `a` (local, newest-first) ahead of `b`. */
export function mergeBookmarks(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/** True if `a` already contains every id in `b` (so no republish is needed). */
export function bookmarkSuperset(a: string[], b: string[]): boolean {
  return b.every((id) => a.includes(id));
}

/** Fold a remote bookmark list into local state (union). Used to hydrate on login. */
export function mergeRemoteBookmarks(remote: string[]) {
  commit(mergeBookmarks(state, remote));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** Reactive access to the bookmark id list (re-renders on change). */
export function useBookmarks(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY
  );
}
