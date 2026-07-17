"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import type { Engagement } from "@/lib/nostr";
import { imetaUrls } from "@/lib/nostr";
import { isNsfw } from "@/lib/nsfw";
import { isPoll } from "@/lib/polls";
import { PostCardHeader, TopicChips, ContentBody, Foldable, NsfwGate } from "./parts";
import { PostActionBar } from "./PostActions";
import { PostModBar } from "./PostModBar";
import { Poll } from "./Poll";
import { useMod } from "./ModContext";

/** Moderator-assigned flair chips for a post, shown inside a community. */
function FlairChips({ event }: { event: NDKEvent }) {
  const mod = useMod();
  const flairs = event.id ? mod?.state.flairs.get(event.id) : undefined;
  if (!flairs || flairs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flairs.map((f) => (
        <span key={f} className="rounded-full border border-brass/50 px-2 py-0.5 text-[11px] text-brass">
          {f}
        </span>
      ))}
    </div>
  );
}

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
        <FlairChips event={event} />
        <TopicChips event={event} />
        {isPoll(event) ? (
          <Poll event={event} />
        ) : (
          <Foldable>
            {isNsfw(event) ? (
              <NsfwGate>
                <ContentBody text={event.content} imeta={imetaUrls(event)} />
              </NsfwGate>
            ) : (
              <ContentBody text={event.content} imeta={imetaUrls(event)} />
            )}
          </Foldable>
        )}
      </div>
      <div className="mt-auto border-t border-border px-2 py-1.5">
        <PostActionBar event={event} replyCount={replyCount} netScore={rank?.reactions} />
        <PostModBar event={event} />
      </div>
    </article>
  );
}
