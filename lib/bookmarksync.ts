import NDK, { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import { collectEvents } from "./nostr";
import {
  KIND_BOOKMARK_LIST,
  buildBookmarkTags,
  bookmarkSuperset,
  getBookmarks,
  mergeRemoteBookmarks,
  parseBookmarkTags,
  setBookmarkPublisher,
} from "./bookmarks";

/** Parts of the existing kind:10003 we must carry forward untouched on republish. */
interface Preserved {
  content: string; // NIP-04-encrypted private bookmarks we don't read yet — never drop them
  tags: string[][]; // unmanaged tags (article/hashtag/url bookmarks, other-client entries)
}

/** Publish moot's current bookmarks as the user's NIP-51 kind:10003, preserving
 *  the original encrypted content and any unmanaged tags so nothing is clobbered. */
export async function publishBookmarkList(
  ndk: NDK,
  ids: string[],
  preserved: Preserved
): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_BOOKMARK_LIST as NDKKind;
  ev.content = preserved.content;
  ev.tags = buildBookmarkTags(ids, preserved.tags);
  await ev.publish();
  return ev;
}

/**
 * Hydrate bookmarks from the user's NIP-51 kind:10003 on login and keep it synced.
 *
 * - Fetches the existing list and folds its public `e` entries into local state
 *   (union — so device-local saves and remote saves both survive).
 * - When `canWrite` (not a read-only npub), registers a publisher so later
 *   bookmark changes republish the list, and pushes the merged union back once if
 *   the local list had entries the remote didn't. Read-only sessions only hydrate.
 */
export async function syncBookmarksOnLogin(
  ndk: NDK,
  pubkey: string,
  canWrite: boolean
): Promise<void> {
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_BOOKMARK_LIST as NDKKind], authors: [pubkey], limit: 1 },
    4000
  );
  const existing = events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
  const remote = existing ? parseBookmarkTags(existing.tags) : [];
  const preserved: Preserved = { content: existing?.content ?? "", tags: existing?.tags ?? [] };

  // Fold remote into local BEFORE registering the publisher, so hydrating
  // doesn't immediately trigger a republish.
  mergeRemoteBookmarks(remote);

  if (!canWrite) return; // read-only npub: hydrate for the Saved view, never publish

  setBookmarkPublisher((ids) => void publishBookmarkList(ndk, ids, preserved).catch(() => {}));

  // Push the union back only if local has entries the remote list lacked.
  if (!bookmarkSuperset(remote, getBookmarks())) {
    await publishBookmarkList(ndk, getBookmarks(), preserved);
  }
}

/** Stop syncing (on logout). Local bookmarks remain as the logged-out list. */
export function stopBookmarkSync(): void {
  setBookmarkPublisher(null);
}
