"use client";

import { useEffect, useMemo, useState } from "react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { useNdk } from "@/app/providers";
import {
  KIND_COMMENT,
  KIND_REACTION,
  KIND_TEXT,
  collectEvents,
  imetaUrls,
  shareLink,
  timeAgo,
} from "@/lib/nostr";
import { CommentHeader, ContentBody, Foldable } from "./parts";

/**
 * "History" — your own activity: the posts (kind:1), comments (kind:1111) and
 * reactions (kind:7) authored by your pubkey, newest first. A self-contained
 * read like Notifications/Saved; nothing here publishes.
 */
export function HistoryView() {
  const { ndk, user, connecting } = useNdk();
  const [events, setEvents] = useState<NDKEvent[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setEvents(null);
    (async () => {
      const evs = await collectEvents(
        ndk,
        { kinds: [KIND_TEXT, KIND_COMMENT, KIND_REACTION], authors: [user.pubkey], limit: 100 },
        5000
      );
      if (!alive) return;
      evs.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
      setEvents(evs);
    })();
    return () => {
      alive = false;
    };
  }, [ndk, user]);

  if (!user) {
    return <div className="p-8 text-center text-sm text-muted">Log in to see your history.</div>;
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">history</span>
          <span className="meta">· your posts, comments &amp; reactions</span>
        </div>
      </div>

      {events === null ? (
        <div className="p-8 text-center text-sm text-muted">
          {connecting ? "Connecting to relays…" : "Loading your history…"}
        </div>
      ) : events.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">
          Nothing yet — your posts, comments and reactions will show up here.
        </div>
      ) : (
        events.map((e) => <HistoryRow key={e.id} event={e} />)
      )}
    </div>
  );
}

/** One activity row: reactions render as a compact line; posts/comments show content. */
function HistoryRow({ event }: { event: NDKEvent }) {
  const imeta = useMemo(() => imetaUrls(event), [event]);
  const kindLabel =
    event.kind === KIND_TEXT ? "post" : event.kind === KIND_COMMENT ? "comment" : "reaction";

  if (event.kind === KIND_REACTION) {
    const c = event.content.trim();
    const label = c === "" || c === "+" ? "▲ upvoted" : c === "-" ? "▼ downvoted" : `reacted ${c}`;
    return (
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm text-muted">
        <span className="text-text">{label}</span>
        <span className="meta">· {timeAgo(event.created_at)}</span>
        <a
          href={shareLink(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="meta ml-auto hover:text-text"
        >
          view ›
        </a>
      </div>
    );
  }

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <CommentHeader event={event} />
        <span className="meta ml-auto shrink-0 rounded border border-border px-1.5 py-0.5">
          {kindLabel}
        </span>
      </div>
      <div className="mt-2 pl-7">
        <Foldable max={200}>
          <ContentBody text={event.content} imeta={imeta} />
        </Foldable>
        <a
          href={shareLink(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="meta mt-1.5 inline-block hover:text-text"
        >
          view thread ›
        </a>
      </div>
    </div>
  );
}
