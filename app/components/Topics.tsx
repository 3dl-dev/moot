"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useEffect, useState } from "react";
import { useNdk } from "@/app/providers";
import {
  readLatestDvmFeed,
  hydrateEvents,
  MOOT_DVM_PUBKEY,
  MOOT_TOPICS,
  topicFeedTag,
  type Topic,
} from "@/lib/dvm";
import { fetchEngagementScores, publishNote, type Engagement } from "@/lib/nostr";
import { isMuted, useMutes } from "@/lib/mute";
import { isNsfw, useShowNsfw } from "@/lib/nsfw";
import { PostRow } from "./PostRow";
import { ReplyBox } from "./parts";

/** Grid of topic feeds — each one alive because it draws from all of Nostr. */
export function TopicsDirectory({ onOpen }: { onOpen: (t: Topic) => void }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="border-b border-border px-4 py-2.5">
        <span className="eyebrow">topics</span>
        <span className="meta"> · hot posts by subject, across all of Nostr</span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
        {MOOT_TOPICS.map((t) => (
          <button
            key={t.slug}
            type="button"
            onClick={() => onOpen(t)}
            className="rounded-md border border-border p-4 text-left transition-colors hover:bg-panel"
          >
            <div className="text-sm font-semibold text-text">{t.label}</div>
            <div className="meta mt-1">#{t.tags[0]}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A single topic's hot feed (read from the DVM), with a topic-tagged composer. */
export function TopicFeed({ topic, onBack }: { topic: Topic; onBack: () => void }) {
  const { ndk, user, canSign } = useNdk();
  const [events, setEvents] = useState<NDKEvent[] | null>(null);
  const [scores, setScores] = useState<Map<string, Engagement>>(new Map());
  const [composing, setComposing] = useState(false);
  const [posting, setPosting] = useState(false);
  useMutes();
  const showNsfw = useShowNsfw();

  useEffect(() => {
    let alive = true;
    setEvents(null);
    setScores(new Map());
    (async () => {
      const ids = await readLatestDvmFeed(ndk, MOOT_DVM_PUBKEY, topicFeedTag(topic.slug));
      const evs = await hydrateEvents(ndk, ids);
      if (!alive) return;
      setEvents(evs);
      const s = await fetchEngagementScores(ndk, evs.map((e) => e.id).filter(Boolean));
      if (alive) setScores(s);
    })();
    return () => {
      alive = false;
    };
  }, [ndk, topic.slug]);

  const submitPost = async (text: string) => {
    setPosting(true);
    try {
      const tag = topic.tags[0];
      const body = new RegExp(`#${tag}\\b`, "i").test(text) ? text : `${text}\n#${tag}`;
      const ev = await publishNote(ndk, body);
      setEvents((cur) => (cur ? [ev, ...cur] : [ev]));
      setComposing(false);
    } finally {
      setPosting(false);
    }
  };

  const visible = (events ?? []).filter((e) => !isMuted(e) && (showNsfw || !isNsfw(e)));

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <button type="button" onClick={onBack} className="meta hover:text-text">
            ‹ topics
          </button>
          <span className="eyebrow">{topic.label}</span>
          <span className="meta">· #{topic.tags[0]} across Nostr</span>
        </div>
        {canSign && (
          <button
            type="button"
            onClick={() => setComposing((v) => !v)}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-black transition-opacity hover:opacity-90"
          >
            + Post
          </button>
        )}
      </div>

      {composing && canSign && (
        <div className="border-b border-border p-3">
          <ReplyBox
            placeholder={`Post to #${topic.tags[0]}…`}
            submitLabel="Post"
            busy={posting}
            autoFocus
            onSubmit={submitPost}
          />
        </div>
      )}

      {events === null && (
        <div className="p-8 text-center text-sm text-muted">Ranking {topic.label} posts…</div>
      )}

      {events !== null && visible.length === 0 && (
        <div className="mx-auto max-w-md p-8 text-center text-sm text-muted">
          No {topic.label} posts on your relays yet — moot’s ranking refreshes every ~15 min.
        </div>
      )}

      {visible.map((event) => (
        <PostRow key={event.id} event={event} rank={scores.get(event.id)} />
      ))}
    </div>
  );
}
