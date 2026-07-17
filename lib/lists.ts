"use client";

import { useSyncExternalStore } from "react";
import { nip19 } from "nostr-tools";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

/**
 * Named people lists (NIP-51 kind:30000 "follow sets"). Local-first like mutes
 * and bookmarks: lists live in localStorage and — once logged in — sync to the
 * user's kind:30000 events so they follow across devices. Each list is a
 * parameterized-replaceable event keyed by its `d` identifier.
 */
export const KIND_PEOPLE_SET = 30000;

export interface UserList {
  /** NIP-51 `d` identifier (stable per list). */
  id: string;
  title: string;
  /** Hex member pubkeys. */
  pubkeys: string[];
}

const KEY = "moot.lists.v1";

// Stable empty reference for the server/initial snapshot — returning a fresh []
// each call makes getServerSnapshot non-referentially-stable, which React warns
// about ("should be cached to avoid an infinite loop"). Mirrors EMPTY in the
// other stores (lib/mute.ts, lib/membership.ts).
const EMPTY: UserList[] = [];
let state: UserList[] = EMPTY;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) state = parsed.filter(isValidList);
    }
  } catch {
    /* corrupt storage — start clean */
  }
}

function isValidList(l: unknown): l is UserList {
  return (
    !!l &&
    typeof (l as UserList).id === "string" &&
    typeof (l as UserList).title === "string" &&
    Array.isArray((l as UserList).pubkeys)
  );
}

// When logged in, providers registers a publisher so list changes update the
// user's NIP-51 kind:30000 events (see lib/listsync.ts). Null when logged out.
type Publisher = (lists: UserList[]) => void;
let publisher: Publisher | null = null;
export function setListPublisher(fn: Publisher | null) {
  publisher = fn;
}

function commit(next: UserList[]) {
  state = next;
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
  publisher?.(state);
}

/** Decode an npub (or accept a bare 64-char hex pubkey) to hex, else null. */
export function toHexPubkey(token: string): string | null {
  const t = token.trim().replace(/^nostr:/, "");
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase();
  try {
    const dec = nip19.decode(t);
    if (dec.type === "npub") return dec.data;
    if (dec.type === "nprofile") return dec.data.pubkey;
  } catch {
    /* not a valid token */
  }
  return null;
}

/** Parse a free-text member list (npubs/hex separated by commas/space/newlines). */
export function parseMembers(input: string): string[] {
  const out: string[] = [];
  for (const tok of input.split(/[\s,]+/)) {
    const hex = toHexPubkey(tok);
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "list";

export function getLists(): UserList[] {
  return state;
}

export function getList(id: string): UserList | undefined {
  return state.find((l) => l.id === id);
}

/** Create a new list; returns it. The id is a slug of the title plus a suffix. */
export function createList(title: string, pubkeys: string[]): UserList {
  const base = slugify(title);
  let id = base;
  let n = 1;
  while (state.some((l) => l.id === id)) id = `${base}-${++n}`;
  const list: UserList = { id, title: title.trim() || "Untitled list", pubkeys };
  commit([...state, list]);
  return list;
}

export function updateList(id: string, patch: Partial<Omit<UserList, "id">>) {
  commit(state.map((l) => (l.id === id ? { ...l, ...patch } : l)));
}

export function deleteList(id: string) {
  commit(state.filter((l) => l.id !== id));
}

/* ==================== NIP-51 kind:30000 sync ==================== */

/** Parse a kind:30000 event into a UserList (`d`→id, `title`→title, `p`→members). */
export function parseListEvent(ev: NDKEvent): UserList {
  let id = "";
  let title = "";
  const pubkeys: string[] = [];
  for (const t of ev.tags) {
    if (t[0] === "d" && t[1]) id = t[1];
    else if (t[0] === "title" && t[1]) title = t[1];
    else if (t[0] === "p" && t[1]) pubkeys.push(t[1]);
  }
  return { id, title: title || id || "Untitled list", pubkeys };
}

/** Tags for a kind:30000 republish (identifier, title, one `p` per member). */
export function buildListTags(list: UserList): string[][] {
  return [
    ["d", list.id],
    ["title", list.title],
    ...list.pubkeys.map((p) => ["p", p]),
  ];
}

/** Merge remote lists into local state by id (remote wins for existing ids). */
export function mergeRemoteLists(remote: UserList[]) {
  const byId = new Map(state.map((l) => [l.id, l] as const));
  for (const r of remote) if (r.id) byId.set(r.id, r);
  commit([...byId.values()]);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** Reactive access to the user's lists (re-renders on change). */
export function useLists(): UserList[] {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY
  );
}
