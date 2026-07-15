"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import type { Engagement } from "@/lib/nostr";
import { isNsfw } from "@/lib/nsfw";
import { PostCardHeader, TopicChips, ContentBody, Foldable, NsfwGate } from "./parts";
import { PostActionBar } from "./PostActions";

export function PostCard({
  event,
  replyCount,
  rank,
}: {
  event: NDKEvent;
  replyCount?: number;
  rank?: Engagement; // shown only when the feed is ranked by Top
}) {
  return (
    <article className="flex flex-col rounded-md border border-border bg-panel">
      <div className="border-b border-border p-3">
        <PostCardHeader event={event} />
      </div>
      <div className="space-y-2.5 p-3">
        {rank && rank.sats > 0 && (
          <div className="flex items-center gap-2">
            <span className="meta rounded border border-brass/40 px-1.5 py-0.5 text-brass">
              ⚡ {rank.sats.toLocaleString()} sats
            </span>
          </div>
        )}
        <TopicChips event={event} />
        <Foldable>
          {isNsfw(event) ? (
            <NsfwGate>
              <ContentBody text={event.content} />
            </NsfwGate>
          ) : (
            <ContentBody text={event.content} />
          )}
        </Foldable>
      </div>
      <div className="mt-auto border-t border-border px-2 py-1.5">
        <PostActionBar event={event} replyCount={replyCount} netScore={rank?.reactions} />
      </div>
    </article>
  );
}
