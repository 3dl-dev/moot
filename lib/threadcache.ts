// Shared, module-level cache of a root's raw reply set (both threading
// conventions), keyed by root event id. Two writers, two readers:
//
//   - CommentColumn writes it as each thread streams in, and reads it to paint
//     instantly when a row scrolls back into view.
//   - HomeFeed *seeds* it in bulk on feed load (one batched query for every
//     visible post), so the comment panes paint with real threads immediately —
//     no per-row spinner — and the front page can rank by real discussion size.
//
// Values are the same shape fetchReplies/subscribeReplies return, so buildThread
// consumes them directly.

import type { NDKEvent } from "@nostr-dev-kit/ndk";

const cache = new Map<string, NDKEvent[]>();

export function getThread(rootId: string): NDKEvent[] | undefined {
  return cache.get(rootId);
}

export function setThread(rootId: string, events: NDKEvent[]): void {
  cache.set(rootId, events);
}

/**
 * Bulk-seed from a root→replies map (HomeFeed's batched fetch). Empty arrays are
 * stored too: they let a reply-less post paint its "be the first" invitation
 * instantly instead of flashing a spinner, since we already know it's empty.
 */
export function seedThreads(map: Map<string, NDKEvent[]>): void {
  for (const [rootId, events] of map) cache.set(rootId, events);
}
