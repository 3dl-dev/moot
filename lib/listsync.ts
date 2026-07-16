import NDK, { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import { collectEvents } from "./nostr";
import {
  KIND_PEOPLE_SET,
  buildListTags,
  getLists,
  mergeRemoteLists,
  parseListEvent,
  setListPublisher,
  type UserList,
} from "./lists";

/** Publish one named list as its NIP-51 kind:30000 event (replaceable by `d`). */
export async function publishList(ndk: NDK, list: UserList): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_PEOPLE_SET as NDKKind;
  ev.tags = buildListTags(list);
  await ev.publish();
  return ev;
}

/** Publish every current list (each is its own replaceable event). Best-effort. */
async function publishAll(ndk: NDK, lists: UserList[]): Promise<void> {
  await Promise.all(lists.map((l) => publishList(ndk, l).catch(() => {})));
}

/**
 * Hydrate the user's named lists from their kind:30000 events on login and keep
 * them synced. Read-only npubs hydrate but never publish.
 */
export async function syncListsOnLogin(
  ndk: NDK,
  pubkey: string,
  canWrite: boolean
): Promise<void> {
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_PEOPLE_SET as NDKKind], authors: [pubkey] },
    4000
  );
  const remote = events.map(parseListEvent).filter((l) => l.id);

  // Fold remote into local BEFORE registering the publisher so hydrating
  // doesn't immediately trigger a republish.
  const localBefore = getLists();
  mergeRemoteLists(remote);

  if (!canWrite) return; // read-only npub: hydrate only

  setListPublisher((lists) => void publishAll(ndk, lists).catch(() => {}));

  // Push any local lists the remote set didn't have.
  const remoteIds = new Set(remote.map((l) => l.id));
  if (localBefore.some((l) => !remoteIds.has(l.id))) {
    await publishAll(ndk, getLists());
  }
}

/** Stop syncing (on logout). Local lists remain for the logged-out session. */
export function stopListSync(): void {
  setListPublisher(null);
}
