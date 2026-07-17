import NDK, { NDKEvent, type NDKFilter, type NDKKind } from "@nostr-dev-kit/ndk";
import { collectEvents } from "./nostr.ts";

/**
 * moot's moderation primitives ride on NIP-32 labels (kind:1985) — public,
 * namespaced, and readable by any client. A community moderator publishes a
 * label targeting a post (`e`) or a user (`p`), scoped to the community (`a`):
 *
 *   pin / lock / remove / dismiss / ban   → namespace `moot.mod`, label = action
 *   a flair                               → namespace `moot.flair`, label = text
 *
 * Approvals stay as NIP-72 kind:4550 (that's what other clients read for the
 * canonical feed). Labels cover everything NIP-72 leaves unspecified. Because a
 * permissionless network can't *enforce* moderation, moot treats these as
 * client-advisory: it honours labels from a community's own moderators and
 * documents that other clients may not (see docs/design.md).
 *
 * Toggle-able state (pin, lock, ban, flair) is retracted by deleting the label
 * event (NIP-09); `remove`/`dismiss` are append-only audit entries — the mod log.
 */
export const KIND_LABEL = 1985; // NIP-32
export const NS_MOD = "moot.mod";
export const NS_FLAIR = "moot.flair";

/** Actions recorded under the `moot.mod` namespace. */
export type ModAction = "pin" | "lock" | "ban" | "remove" | "dismiss";

export interface ModLabel {
  id?: string;
  /** Label value: a ModAction (moot.mod) or the flair text (moot.flair). */
  value: string;
  namespace: string;
  /** Community coordinate this label is scoped to ("34550:<pk>:<id>"). */
  community: string;
  /** Targeted post id, if any. */
  targetEvent?: string;
  /** Targeted pubkey (a ban target, or a post's author), if any. */
  targetPubkey?: string;
  /** The moderator who published the label. */
  author: string;
  /** Free-text note / reason carried in the event content. */
  note: string;
  created_at: number;
}

/** Tags for a NIP-32 label event (kind:1985). */
export function buildLabelTags(opts: {
  namespace: string;
  value: string;
  community: string;
  targetEvent?: string;
  targetPubkey?: string;
}): string[][] {
  const tags: string[][] = [
    ["L", opts.namespace],
    ["l", opts.value, opts.namespace],
    ["a", opts.community],
  ];
  if (opts.targetEvent) tags.push(["e", opts.targetEvent]);
  if (opts.targetPubkey) tags.push(["p", opts.targetPubkey]);
  return tags;
}

/** Parse a kind:1985 event into a ModLabel, or null if it isn't a moot label. */
export function parseLabel(ev: NDKEvent): ModLabel | null {
  const namespace = ev.tags.find((t) => t[0] === "L")?.[1];
  const value = ev.tags.find((t) => t[0] === "l")?.[1];
  const community = ev.tags.find((t) => t[0] === "a")?.[1];
  if (!namespace || !value || !community) return null;
  if (namespace !== NS_MOD && namespace !== NS_FLAIR) return null;
  return {
    id: ev.id,
    value,
    namespace,
    community,
    targetEvent: ev.tags.find((t) => t[0] === "e")?.[1],
    targetPubkey: ev.tags.find((t) => t[0] === "p")?.[1],
    author: ev.pubkey,
    note: ev.content ?? "",
    created_at: ev.created_at ?? 0,
  };
}

/** Aggregated, moderator-authored moderation state for a community. */
export interface ModState {
  pinned: Set<string>; // post ids pinned to the top
  locked: Set<string>; // post ids whose threads are locked (advisory)
  banned: Set<string>; // pubkeys temp-banned in this community (advisory)
  removed: Set<string>; // post ids a moderator has removed (hidden in moot)
  flairs: Map<string, string[]>; // post id → flair labels
}

/**
 * Reduce a community's labels into moderation state, honouring ONLY labels
 * authored by that community's moderators (authorization is client-side on a
 * permissionless network). Later labels don't override earlier ones — presence
 * is the signal, and retraction is a NIP-09 delete that removes the event.
 */
export function reduceModState(labels: ModLabel[], moderators: string[]): ModState {
  const mods = new Set(moderators);
  const state: ModState = {
    pinned: new Set(),
    locked: new Set(),
    banned: new Set(),
    removed: new Set(),
    flairs: new Map(),
  };
  for (const l of labels) {
    if (!mods.has(l.author)) continue; // non-moderator label: advisory, ignored
    if (l.namespace === NS_FLAIR && l.targetEvent) {
      const cur = state.flairs.get(l.targetEvent) ?? [];
      if (!cur.includes(l.value)) cur.push(l.value);
      state.flairs.set(l.targetEvent, cur);
      continue;
    }
    if (l.namespace !== NS_MOD) continue;
    if (l.value === "pin" && l.targetEvent) state.pinned.add(l.targetEvent);
    else if (l.value === "lock" && l.targetEvent) state.locked.add(l.targetEvent);
    else if (l.value === "ban" && l.targetPubkey) state.banned.add(l.targetPubkey);
    else if (l.value === "remove" && l.targetEvent) state.removed.add(l.targetEvent);
  }
  return state;
}

/** Post ids a moderator has actioned (remove/dismiss) — used to resolve reports. */
export function resolvedTargets(labels: ModLabel[], moderators: string[]): Set<string> {
  const mods = new Set(moderators);
  const resolved = new Set<string>();
  for (const l of labels) {
    if (!mods.has(l.author) || l.namespace !== NS_MOD) continue;
    if ((l.value === "remove" || l.value === "dismiss") && l.targetEvent) {
      resolved.add(l.targetEvent);
    }
  }
  return resolved;
}

/** Raw kind:1985 label events tagged to a community. */
export function fetchLabelEvents(ndk: NDK, addr: string): Promise<NDKEvent[]> {
  const filter: NDKFilter = { kinds: [KIND_LABEL as NDKKind], "#a": [addr] };
  return collectEvents(ndk, filter, 5000);
}

/** Fetch every moot label for a community (both namespaces). */
export async function fetchCommunityLabels(ndk: NDK, addr: string): Promise<ModLabel[]> {
  const events = await fetchLabelEvents(ndk, addr);
  return events.map(parseLabel).filter((l): l is ModLabel => l !== null);
}

/**
 * Retract this user's matching labels via NIP-09 deletion — how a pin/lock/flair
 * is undone (labels are regular events; presence is the signal, so the event
 * itself must go). Only the author's own labels are deletable. Best-effort.
 */
export async function retractLabel(
  ndk: NDK,
  addr: string,
  match: { author: string; namespace?: string; value?: string; targetEvent?: string; targetPubkey?: string }
): Promise<void> {
  const events = await fetchLabelEvents(ndk, addr);
  const mine = events.filter((ev) => {
    const l = parseLabel(ev);
    if (!l || l.author !== match.author) return false;
    if (match.namespace && l.namespace !== match.namespace) return false;
    if (match.value && l.value !== match.value) return false;
    if (match.targetEvent && l.targetEvent !== match.targetEvent) return false;
    if (match.targetPubkey && l.targetPubkey !== match.targetPubkey) return false;
    return true;
  });
  await Promise.all(mine.map((ev) => ev.delete().catch(() => {})));
}

/** Publish a moderation label (kind:1985). Requires a signer. */
export async function publishLabel(
  ndk: NDK,
  opts: {
    namespace: string;
    value: string;
    community: string;
    targetEvent?: string;
    targetPubkey?: string;
    note?: string;
  }
): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_LABEL as NDKKind;
  ev.content = opts.note ?? "";
  ev.tags = buildLabelTags(opts);
  await ev.publish();
  return ev;
}
