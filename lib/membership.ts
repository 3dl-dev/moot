"use client";

import NDK, { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import { useSyncExternalStore } from "react";

/**
 * Community membership — the subreddit-style "join" for NIP-72 communities.
 *
 * The only convention on-network (published by the bchnostr client, confirmed
 * via scripts/inspect-membership.ts) records membership as a NIP-78 app-data
 * event:
 *
 *   kind:    30078
 *   content: {"role":"member"}          (may carry extra keys, e.g. paidSats)
 *   d:       bchnostr/community-member/<community-addr>
 *   a:       <community-addr>            (34550:<pubkey>:<d>)
 *
 * moot is a conservative writer: to interoperate we WRITE the exact same `d`
 * namespace, so a moot join and a bchnostr join for the same community are the
 * *same* replaceable event — mutually visible and de-duplicated, never two
 * competing records. To LEAVE we NIP-09 delete the event (which also drops the
 * replaceable coordinate).
 *
 * As a superset reader we don't rely on that `d` namespace when READING others'
 * memberships — we match on kind + a `34550:` a-tag + content role, so any
 * client's membership record counts.
 */
export const KIND_APP_DATA = 30078; // NIP-78 application-specific data

/** The interop `d` namespace we share with bchnostr so joins de-duplicate. */
export const MEMBER_D_PREFIX = "bchnostr/community-member/";

/** The replaceable `d` identifier for a membership in `addr`. */
export function memberD(addr: string): string {
  return `${MEMBER_D_PREFIX}${addr}`;
}

/** Tags for a membership event: the shared `d` + the community `a` coordinate. */
export function buildMembershipTags(addr: string): string[][] {
  const author = addr.split(":")[1] ?? "";
  return [
    ["d", memberD(addr)],
    ["a", addr, "", author],
  ];
}

/**
 * The community coordinate this event marks membership in, or null if it isn't a
 * membership record. Pure (no store/NDK) so it's unit-testable.
 *
 * Gate on `content.role === "member"`: other app-data on the same community
 * (e.g. bchnostr's community-pin, which also carries a `34550:` a-tag) must NOT
 * be read as membership. Extra content keys (paidSats, etc.) are tolerated.
 */
export function parseMembership(ev: NDKEvent): string | null {
  const addr = ev.tags.find((t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"))?.[1];
  if (!addr) return null;
  try {
    const data = JSON.parse(ev.content);
    if (data && data.role === "member") return addr;
  } catch {
    /* non-JSON content — not a membership record */
  }
  return null;
}

/**
 * Reduce a batch of fetched kind:30078 events into the newest membership event
 * per community. Newest-wins so a re-join (replaceable) supersedes an older
 * record; a since-deleted coordinate simply won't be in the fetched set.
 */
export function reduceMemberships(events: NDKEvent[]): Map<string, NDKEvent> {
  const best = new Map<string, { ev: NDKEvent; ts: number }>();
  for (const ev of events) {
    const addr = parseMembership(ev);
    if (!addr) continue;
    const ts = ev.created_at ?? 0;
    const prev = best.get(addr);
    if (!prev || ts > prev.ts) best.set(addr, { ev, ts });
  }
  return new Map([...best].map(([addr, { ev }]) => [addr, ev]));
}

/* ============================ reactive store ============================ */

// addr -> the membership event (kept so LEAVE can NIP-09 delete it).
let events = new Map<string, NDKEvent>();
// Stable snapshot for useSyncExternalStore; recomputed only on change.
let addrs: string[] = [];
const EMPTY: string[] = [];
const listeners = new Set<() => void>();

function recompute() {
  addrs = [...events.keys()].sort();
  listeners.forEach((l) => l());
}

/** The set of community coordinates the user has joined (non-reactive). */
export function getMemberships(): string[] {
  return addrs;
}

/** True if the user has joined `addr` (non-reactive). */
export function isMember(addr: string): boolean {
  return events.has(addr);
}

/**
 * Join a community: publish the shared-convention membership event and add it to
 * the store optimistically, rolling back if the publish fails. No-op if already
 * a member. Requires a signer (call sites gate on `canSign`).
 */
export async function joinCommunity(ndk: NDK, addr: string): Promise<void> {
  if (events.has(addr)) return;
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_APP_DATA as NDKKind;
  ev.content = JSON.stringify({ role: "member" });
  ev.tags = buildMembershipTags(addr);
  events.set(addr, ev); // optimistic
  recompute();
  try {
    await ev.publish();
  } catch (e) {
    events.delete(addr); // roll back on failure
    recompute();
    throw e;
  }
}

/**
 * Leave a community: NIP-09 delete the membership event and drop it from the
 * store optimistically, rolling back if the delete fails. No-op if not a member.
 */
export async function leaveCommunity(ndk: NDK, addr: string): Promise<void> {
  const ev = events.get(addr);
  if (!ev) return;
  events.delete(addr); // optimistic
  recompute();
  try {
    await ev.delete("left community");
  } catch (e) {
    events.set(addr, ev); // roll back on failure
    recompute();
    throw e;
  }
}

/**
 * Replace the joined set from a freshly fetched batch of kind:30078 events.
 * Called by lib/membershipsync.ts on login (kept out of this file so it has no
 * relative imports and stays unit-testable under the Node test runner).
 */
export function hydrateMemberships(fetched: NDKEvent[]): void {
  events = reduceMemberships(fetched);
  recompute();
}

/** Clear the joined set (on logout). */
export function stopMembershipSync(): void {
  events = new Map();
  recompute();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive access to the joined-community set (re-renders on change). */
export function useMemberships(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => addrs,
    () => EMPTY
  );
}
