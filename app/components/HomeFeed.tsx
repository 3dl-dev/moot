"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useEffect, useRef, useState } from "react";
import { useNdk } from "@/app/providers";
import { readLatestDvmFeed, hydrateEvents, MOOT_DVM_PUBKEY, MOOT_FEED_TAGS } from "@/lib/dvm";
import {
  collectEvents,
  fetchEngagementScores,
  fetchRepliesForRoots,
  isTopLevelNote,
  looksLikeContent,
  orderByDiscussion,
  publishNote,
  type Engagement,
} from "@/lib/nostr";
import { seedThreads } from "@/lib/threadcache";
import { isMuted, useMutes } from "@/lib/mute";
import { isNsfw, useShowNsfw } from "@/lib/nsfw";
import { meetsMinPow } from "@/lib/pow";
import { usePrefs } from "@/lib/prefs";
import { PostRow } from "./PostRow";
import { ReplyBox } from "./parts";
import type { View } from "@/lib/nav";

type Sort = "buzzing" | "hot" | "rising" | "top" | "new" | "controversial";

const TABS: { id: Sort; label: string; blurb: string }[] = [
  { id: "buzzing", label: "Buzzing", blurb: "live conversations — posts with replies lead" },
  { id: "hot", label: "Hot", blurb: "what the network is discussing right now" },
  { id: "rising", label: "Rising", blurb: "posts gaining traction fast" },
  { id: "top", label: "Top", blurb: "the most-engaged posts in the window" },
  { id: "new", label: "New", blurb: "the latest posts, newest first" },
  { id: "controversial", label: "Controversial", blurb: "the most argued-over — the ratio" },
];

// "Buzzing" reuses the DVM's Hot candidate set, then reorders it discussion-first
// on the client. The other DVM tabs map to their own precomputed feed tag.
const feedTagFor = (sort: Sort) => (sort === "buzzing" ? "hot" : sort) as
  | "hot"
  | "rising"
  | "top"
  | "controversial";

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
  const [sort, setSort] = useState<Sort>("buzzing");
  const [events, setEvents] = useState<NDKEvent[] | null>(null); // null = loading
  const [scores, setScores] = useState<Map<string, Engagement>>(new Map());
  const [threads, setThreads] = useState<Map<string, number>>(new Map()); // id → reply count
  const [composing, setComposing] = useState(false);
  const [posting, setPosting] = useState(false);
  useMutes();
  const showNsfw = useShowNsfw();
  const { minPow } = usePrefs();
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setEvents(null);
    setScores(new Map());
    setThreads(new Map());
    (async () => {
      const evs =
        sort === "new"
          ? await loadNew(ndk)
          : await hydrateEvents(ndk, await readLatestDvmFeed(ndk, MOOT_DVM_PUBKEY, MOOT_FEED_TAGS[feedTagFor(sort)]));
      if (id !== reqId.current) return; // a newer tab click won
      setEvents(evs); // paint posts immediately in DVM order…
      const ids = evs.map((e) => e.id).filter(Boolean);
      // Reactions/zaps for the score badges.
      fetchEngagementScores(ndk, ids).then((s) => {
        if (id === reqId.current) setScores(s);
      });
      // Bulk-fetch every visible post's replies once: seeds the comment panes so
      // they paint instantly (no per-row spinner) AND yields reply counts so
      // "Buzzing" can reorder discussion-first when they arrive.
      const replyMap = await fetchRepliesForRoots(ndk, ids);
      if (id !== reqId.current) return;
      seedThreads(replyMap);
      setThreads(new Map([...replyMap].map(([rid, list]) => [rid, list.length])));
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
  // Min-PoW gates the raw firehose read (New); the Hot/Rising/Top tabs are
  // already trust-ranked by moot's DVM, so PoW-filtering their curated output
  // would only blank the front page (most good posts carry no PoW).
  const filtered = (events ?? []).filter(
    (e) => !isMuted(e) && (showNsfw || !isNsfw(e)) && meetsMinPow(e, sort === "new" ? minPow : 0)
  );
  // Buzzing leads with real conversations: reorder discussion-first once reply
  // counts land (until then it shows in DVM order, then the threads bubble up).
  const visible =
    sort === "buzzing" ? orderByDiscussion(filtered, (id) => threads.get(id) ?? 0) : filtered;

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
            draftKey="post:home"
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
