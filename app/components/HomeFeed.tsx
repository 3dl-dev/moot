"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useEffect, useRef, useState } from "react";
import { useNdk } from "@/app/providers";
import { readLatestDvmFeed, hydrateEvents, MOOT_DVM_PUBKEY, MOOT_FEED_TAGS } from "@/lib/dvm";
import {
  collectEvents,
  fetchEngagementScores,
  isTopLevelNote,
  looksLikeContent,
  publishNote,
  type Engagement,
} from "@/lib/nostr";
import { isMuted, useMutes } from "@/lib/mute";
import { isNsfw, useShowNsfw } from "@/lib/nsfw";
import { PostRow } from "./PostRow";
import { ReplyBox } from "./parts";
import type { View } from "@/lib/nav";

type Sort = "hot" | "rising" | "top" | "new" | "controversial";

const TABS: { id: Sort; label: string; blurb: string }[] = [
  { id: "hot", label: "Hot", blurb: "what the network is discussing right now" },
  { id: "rising", label: "Rising", blurb: "posts gaining traction fast" },
  { id: "top", label: "Top", blurb: "the most-engaged posts in the window" },
  { id: "new", label: "New", blurb: "the latest posts, newest first" },
  { id: "controversial", label: "Controversial", blurb: "the most argued-over — the ratio" },
];

/** Recent top-level content notes, newest first (the client-side "New" sort). */
async function loadNew(ndk: ReturnType<typeof useNdk>["ndk"]): Promise<NDKEvent[]> {
  const raw = await collectEvents(ndk, { kinds: [1], limit: 120 }, 5000);
  return raw
    .filter((e) => e.id && isTopLevelNote(e) && looksLikeContent(e.content))
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, 100);
}

/**
 * The default landing view: moot's ranked front page. Hot/Rising/Top/
 * Controversial are read from moot's feed DVM (precomputed, no login, instant);
 * New is a plain client-side chronological read. This is the "good default" —
 * a reddit-like front page instead of the raw firehose.
 */
export function HomeFeed({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { ndk, canSign } = useNdk();
  const [sort, setSort] = useState<Sort>("hot");
  const [events, setEvents] = useState<NDKEvent[] | null>(null); // null = loading
  const [scores, setScores] = useState<Map<string, Engagement>>(new Map());
  const [composing, setComposing] = useState(false);
  const [posting, setPosting] = useState(false);
  useMutes();
  const showNsfw = useShowNsfw();
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setEvents(null);
    setScores(new Map());
    (async () => {
      const evs =
        sort === "new"
          ? await loadNew(ndk)
          : await hydrateEvents(ndk, await readLatestDvmFeed(ndk, MOOT_DVM_PUBKEY, MOOT_FEED_TAGS[sort]));
      if (id !== reqId.current) return; // a newer tab click won
      setEvents(evs);
      const s = await fetchEngagementScores(ndk, evs.map((e) => e.id).filter(Boolean));
      if (id === reqId.current) setScores(s);
    })();
  }, [ndk, sort]);

  const submitPost = async (text: string) => {
    setPosting(true);
    try {
      const ev = await publishNote(ndk, text);
      setEvents((cur) => (cur ? [ev, ...cur] : [ev]));
      setComposing(false);
    } finally {
      setPosting(false);
    }
  };

  const active = TABS.find((t) => t.id === sort)!;
  const visible = (events ?? []).filter((e) => !isMuted(e) && (showNsfw || !isNsfw(e)));

  return (
    <div className="min-w-0 flex-1">
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="eyebrow">the floor</span>
            <span className="meta">· {active.blurb}</span>
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
        <div className="mt-2 flex gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSort(t.id)}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                sort === t.id ? "bg-panel-2 text-brass" : "text-muted hover:bg-panel hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {composing && canSign && (
        <div className="border-b border-border p-3">
          <ReplyBox
            placeholder="Post to Nostr…"
            submitLabel="Post"
            busy={posting}
            autoFocus
            onSubmit={submitPost}
          />
        </div>
      )}

      {events === null && (
        <div className="p-8 text-center text-sm text-muted">
          Ranking {active.label.toLowerCase()} posts…
        </div>
      )}

      {events !== null && visible.length === 0 && (
        <div className="mx-auto max-w-md p-8 text-center">
          <p className="text-sm text-muted">
            {sort === "new"
              ? "No recent posts on your relays right now."
              : `The ${active.label} feed isn’t on your relays yet.`}
          </p>
          {sort !== "new" && (
            <p className="mt-2 text-xs text-muted">
              moot’s ranking DVM refreshes every ~15 min. Meanwhile, try{" "}
              <button type="button" onClick={() => setSort("new")} className="text-accent hover:underline">
                New
              </button>{" "}
              or{" "}
              <button
                type="button"
                onClick={() => onNavigate({ kind: "feed" })}
                className="text-accent hover:underline"
              >
                All
              </button>
              .
            </p>
          )}
        </div>
      )}

      {visible.map((event) => (
        <PostRow key={event.id} event={event} rank={scores.get(event.id)} />
      ))}
    </div>
  );
}
