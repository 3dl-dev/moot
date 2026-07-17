import NDK, { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import { collectEvents } from "./nostr";
import {
  KIND_MUTE_LIST,
  buildMuteTags,
  clearPrivateMutes,
  countNewMutes,
  getMutes,
  mergeRemote,
  muteSuperset,
  parseMuteTags,
  parsePrivateMuteContent,
  setMutePublisher,
  setPrivateMutes,
  type Mutes,
} from "./mute";

/** Parts of the existing kind:10000 we must carry forward untouched on republish. */
interface Preserved {
  content: string; // NIP-04-encrypted private mutes we don't read yet — never drop them
  tags: string[][]; // unmanaged tags (hashtags, threads, other-client entries)
}

/** Publish moot's current mutes as the user's NIP-51 kind:10000, preserving the
 *  original encrypted content and any unmanaged tags so nothing is clobbered. */
export async function publishMuteList(
  ndk: NDK,
  mutes: Mutes,
  preserved: Preserved
): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_MUTE_LIST as NDKKind;
  ev.content = preserved.content;
  ev.tags = buildMuteTags(mutes, preserved.tags);
  await ev.publish();
  return ev;
}

/**
 * Hydrate mutes from the user's NIP-51 kind:10000 on login and keep it in sync.
 *
 * - Fetches the existing list and folds its public entries into local state
 *   (union — so device-local mutes and remote mutes both survive).
 * - When `canWrite` (i.e. not a read-only npub), registers a publisher so later
 *   mute changes republish the list, and pushes the merged union back once if the
 *   local list had entries the remote didn't. Read-only sessions only hydrate.
 */
export async function syncMutesOnLogin(
  ndk: NDK,
  pubkey: string,
  canWrite: boolean
): Promise<void> {
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_MUTE_LIST as NDKKind], authors: [pubkey], limit: 1 },
    4000
  );
  const existing = events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
  const remote = existing
    ? parseMuteTags(existing.tags)
    : { pubkeys: [], words: [], communities: [] };
  const preserved: Preserved = { content: existing?.content ?? "", tags: existing?.tags ?? [] };

  // Fold remote into local BEFORE registering the publisher, so hydrating
  // doesn't immediately trigger a republish.
  mergeRemote(remote);

  // Superset reader: also decrypt and apply the user's NIP-04-encrypted PRIVATE
  // mutes (Damus/Amethyst store mutes in `.content`). Filter-only — never
  // republished as public tags, and the encrypted blob is carried through
  // untouched (preserved.content). Non-fatal: a read-only npub can't decrypt, and
  // a bad blob shouldn't break login — either way the private mutes just stay
  // unapplied, never destroyed.
  if (existing?.content && ndk.signer) {
    try {
      const self = ndk.getUser({ pubkey });
      const decrypted = await ndk.signer.decrypt(self, existing.content, "nip04");
      setPrivateMutes(parsePrivateMuteContent(decrypted));
    } catch {
      /* decrypt unavailable/failed — private mutes stay unapplied, never destroyed */
    }
  }

  if (!canWrite) return; // read-only npub: hydrate for filtering, never publish

  setMutePublisher((mutes) => void publishMuteList(ndk, mutes, preserved).catch(() => {}));

  // Push the union back only if local has entries the remote list lacked.
  if (!muteSuperset(remote, getMutes())) {
    await publishMuteList(ndk, getMutes(), preserved);
  }
}

/** Stop syncing (on logout). Local mutes remain as the logged-out filter, but the
 *  decrypted private mutes are dropped — they belong to the account, not the device. */
export function stopMuteSync(): void {
  setMutePublisher(null);
  clearPrivateMutes();
}

/** Outcome of importing someone else's block list. */
export interface ImportResult {
  /** New entries folded into the local filter (0 ⇒ nothing you didn't have). */
  added: number;
  /** True if a kind:10000 list was found for that pubkey at all. */
  found: boolean;
}

/**
 * Import another user's PUBLIC NIP-51 kind:10000 mute list (delegated trust) and
 * union it into the local filter. Only public tags are read — their NIP-04
 * private mutes are, by definition, unreadable to anyone else. If the local list
 * changed and a publisher is registered (logged-in writer), the union
 * republishes automatically via the mute store, so an import you make sticks to
 * your own list too.
 */
export async function importMuteListFrom(ndk: NDK, pubkey: string): Promise<ImportResult> {
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_MUTE_LIST as NDKKind], authors: [pubkey], limit: 1 },
    4000
  );
  const latest = events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
  if (!latest) return { added: 0, found: false };
  const remote = parseMuteTags(latest.tags);
  const added = countNewMutes(getMutes(), remote);
  if (added > 0) mergeRemote(remote); // triggers republish via the registered publisher
  return { added, found: true };
}
