import NDK, { type NDKKind } from "@nostr-dev-kit/ndk";
import { collectEvents } from "./nostr";
import { KIND_APP_DATA, hydrateMemberships } from "./membership";

/**
 * Hydrate the user's joined communities from their kind:30078 events on login.
 * Read-only npubs hydrate too — they see their joined set even though the
 * Join/Leave controls stay disabled. Kept separate from lib/membership.ts so the
 * store's pure helpers have no relative imports (Node's TS test runner needs
 * explicit extensions on those — see lib/mutesync.ts for the same split).
 */
export async function syncMembershipsOnLogin(ndk: NDK, pubkey: string): Promise<void> {
  const fetched = await collectEvents(
    ndk,
    { kinds: [KIND_APP_DATA as NDKKind], authors: [pubkey], limit: 500 },
    4000
  );
  hydrateMemberships(fetched);
}
