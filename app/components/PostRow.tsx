"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useState } from "react";
import type { Engagement } from "@/lib/nostr";
import { useInView } from "@/lib/hooks";
import { usePrefs } from "@/lib/prefs";
import { PostCard } from "./PostCard";
import { CommentColumn } from "./CommentColumn";

/**
 * One feed row in the squabbles format: the post on the left, its own
 * threaded discussion on the right, top-aligned. The comment column
 * lazily fetches its thread when the row scrolls into view.
 */
export function PostRow({ event, rank }: { event: NDKEvent; rank?: Engagement }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [replyCount, setReplyCount] = useState<number | null>(null);
  const { compact } = usePrefs(); // denser rows when enabled

  return (
    <div
      ref={ref}
      className={`rowin grid grid-cols-1 items-start border-b border-border px-4 md:grid-cols-2 ${
        compact ? "gap-2 py-2" : "gap-3 py-3.5"
      }`}
    >
      <PostCard event={event} replyCount={replyCount ?? undefined} rank={rank} />
      <CommentColumn root={event} active={inView} onCount={setReplyCount} />
    </div>
  );
}
