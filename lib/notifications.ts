"use client";

import { useSyncExternalStore } from "react";
import type { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";

/**
 * Reply / mention notifications for the logged-in user — pure logic + the
 * device-local read watermark. The live relay subscription lives in
 * lib/useNotifications.ts; this module stays import-free of other local
 * modules (like lib/rank.ts and lib/dvm.ts) so `node --test` can load it.
 *
 * Nostr has no server-side inbox — a "notification" is any event that tags your
 * pubkey. We subscribe to kind:1 (NIP-01) + kind:1111 (NIP-22) with `#p = you`,
 * which captures both threading conventions at once:
 *   - a NIP-10 reply to your note p-tags the note's author (you),
 *   - a NIP-22 comment on your note p-tags the parent author (you),
 *   - a NIP-27 @-mention p-tags the mentioned pubkey (you).
 */

const KIND_TEXT = 1; // NIP-01 short text note
const KIND_COMMENT = 1111; // NIP-22 comment

export type NotificationKind = "reply" | "mention";

export interface Notification {
  event: NDKEvent;
  kind: NotificationKind;
}

/** Relay filter for everything that tags `pubkey` across both conventions. */
export function notificationFilters(pubkey: string): NDKFilter {
  return { kinds: [KIND_TEXT, KIND_COMMENT], "#p": [pubkey], limit: 100 };
}

/**
 * Classify an event that tags the user. Pure. Returns null for events that
 * aren't notifications for `userPubkey` — your own events (you don't notify
 * yourself) and events that don't actually p-tag you (defensive: the filter
 * already guarantees the tag, but the classifier shouldn't assume it).
 *
 * A reply threads onto another event (a kind:1111 comment, or a kind:1 carrying
 * any `e` tag). A top-level note that merely tags you is a mention.
 */
export function classifyNotification(
  ev: NDKEvent,
  userPubkey: string
): NotificationKind | null {
  if (ev.pubkey === userPubkey) return null;
  if (!ev.tags.some((t) => t[0] === "p" && t[1] === userPubkey)) return null;
  const isReply = ev.kind === KIND_COMMENT || ev.tags.some((t) => t[0] === "e");
  return isReply ? "reply" : "mention";
}

/** Count notifications newer than the last-read watermark. Pure. */
export function unreadCount(items: Notification[], lastReadAt: number): number {
  return items.filter((n) => (n.event.created_at ?? 0) > lastReadAt).length;
}

/* -------------------- per-account last-read watermark (device-local) ------- */

const KEY = "moot.notifsRead.v1";
type ReadMap = Record<string, number>; // pubkey -> last-read unix seconds

let readState: ReadMap = {};
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) readState = JSON.parse(raw);
  } catch {
    /* corrupt storage — start clean */
  }
}

/** Last-read watermark (unix seconds) for an account; 0 if never read. */
export function getLastRead(pubkey?: string): number {
  return pubkey ? readState[pubkey] ?? 0 : 0;
}

/** Advance an account's last-read watermark and persist it. Never moves back. */
export function markRead(pubkey: string, at: number) {
  if ((readState[pubkey] ?? 0) >= at) return;
  readState = { ...readState, [pubkey]: at };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(readState));
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

function subscribeRead(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive last-read watermark for an account (re-renders when it advances). */
export function useLastRead(pubkey?: string): number {
  return useSyncExternalStore(
    subscribeRead,
    () => getLastRead(pubkey),
    () => 0
  );
}
