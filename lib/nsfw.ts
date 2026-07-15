"use client";

import { useSyncExternalStore } from "react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

/**
 * NSFW gating. moot treats NSFW as a legitimate avenue that stays **off the
 * default surface**: feeds exclude it unless the device opts in, and even then
 * each post is blurred until revealed. Detection reads what authors and labelers
 * already set — NIP-36 `content-warning`, NIP-32 `nsfw`-ish labels, and obvious
 * nsfw hashtags — never pixel inspection. `isNsfw` is pure, so it's unit-testable.
 */
const NSFW_RE = /^(nsfw|porn|xxx|nude|nudity|sensitive|gore|explicit|18\+)$/i;

export function isNsfw(ev: NDKEvent): boolean {
  for (const t of ev.tags) {
    if (t[0] === "content-warning") return true; // NIP-36: any sensitive content
    if ((t[0] === "l" || t[0] === "t") && NSFW_RE.test((t[1] ?? "").trim())) return true;
  }
  return false;
}

/* ---- device-local "Show NSFW" preference (no auth, like mutes) ---- */

const KEY = "moot.showNsfw.v1";
let show = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    show = localStorage.getItem(KEY) === "1";
  } catch {
    /* storage blocked — default hidden */
  }
}

export function getShowNsfw(): boolean {
  return show;
}

export function setShowNsfw(v: boolean) {
  show = v;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
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

/** Reactive "show NSFW" flag (re-renders on toggle). */
export function useShowNsfw(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => show,
    () => false
  );
}

/** Hide this event from a feed given the current preference. */
export function hiddenByNsfw(ev: NDKEvent): boolean {
  return !show && isNsfw(ev);
}
