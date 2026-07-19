"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useEffect, useRef, useState } from "react";
import { useNdk } from "@/app/providers";
import {
  readLatestDvmFeed,
  hydrateEvents,
  MOOT_DVM_PUBKEY,
  MOOT_FEED_TAGS,
  MOOT_TOPICS,
  topicFeedTag,
} from "@/lib/dvm";
import {
  mergeSources,
  rankExplore,
  type RankedSource,
  type ExploreCandidate,
} from "@/lib/explore";
import { fetchEngagementScores, engagementScore, type Engagement } from "@/lib/nostr";
import { isMuted, useMutes } from "@/lib/mute";
import { isNsfw, useShowNsfw } from "@/lib/nsfw";
import { PostRow } from "./PostRow";
import type { View } from "@/lib/nav";

// The source feeds Explore fuses: moot's three ranked sorts plus every topic
// feed. Blending the topic feeds is what makes Explore *discovery* — it pulls in
// subjects you don't follow, not just the global hot list. All read no-auth from
// moot's precomputed DVM results.
const CORE_TAGS = [MOOT_FEED_TAGS.hot, MOOT_FEED_TAGS.top, MOOT_FEED_TAGS.rising];
const SOURCE_TAGS = [...CORE_TAGS, ...MOOT_TOPICS.map((t) => topicFeedTag(t.slug))];

// Hydrate at most this many of the fused pool (relays cap large id filters, and
// a discovery feed doesn't need the whole tail).
const POOL_CAP = 100;

/**
 * Explore — a blended algorithmic discovery feed. Reads several precomputed DVM
 * feeds, fuses them (reciprocal-rank fusion) into one pool, then re-ranks that
 * pool by real engagement (reactions + zap sats) with gentle freshness. See
 * lib/explore.ts for the pure ranking. Distinct from Home (single sort) and from
 * the feed-provider directory (a picker of external DVMs).
 */
export function ExploreFeed({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { ndk } = useNdk();
  const [candidates, setCandidates] = useState<ExploreCandidate[] | null>(null); // null = loading
  const [byId, setById] = useState<Map<string, NDKEvent>>(new Map());
  const [scores, setScores] = useState<Map<string, Engagement>>(new Map());
  useMutes();
  const showNsfw = useShowNsfw();
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setCandidates(null);
    setById(new Map());
    setScores(new Map());
    (async () => {
      // Read every source feed concurrently, then fuse into one ranked pool.
      const sources: RankedSource[] = await Promise.all(
        SOURCE_TAGS.map(async (tag) => ({
          tag,
          ids: await readLatestDvmFeed(ndk, MOOT_DVM_PUBKEY, tag),
        }))
      );
      if (id !== reqId.current) return;
      const pool = mergeSources(sources).slice(0, POOL_CAP);
      const events = await hydrateEvents(
        ndk,
        pool.map((c) => c.id)
      );
      if (id !== reqId.current) return;
      const map = new Map(events.map((e) => [e.id, e]));
      // Keep only candidates we actually hydrated, in fusion order for now.
      const present = pool.filter((c) => map.has(c.id));
      setById(map);
      setCandidates(present); // paint immediately in fusion order…
      // …then re-rank once engagement lands (matches HomeFeed's progressive fill).
      const eng = await fetchEngagementScores(
        ndk,
        present.map((c) => c.id)
      );
      if (id !== reqId.current) return;
      setScores(eng);
      const now = Math.floor(Date.now() / 1000);
      setCandidates(
        rankExplore(present, now, (cid) => {
          const ev = map.get(cid);
          if (!ev) return undefined;
          return {
            engagement: engagementScore(eng.get(cid)),
            createdAt: ev.created_at ?? now,
          };
        })
      );
    })();
  }, [ndk]);

  const visible = (candidates ?? [])
    .map((c) => byId.get(c.id))
    .filter((e): e is NDKEvent => Boolean(e))
    .filter((e) => !isMuted(e) && (showNsfw || !isNsfw(e)));

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">explore</span>
          <span className="meta">· blended discovery — cross-feed picks, ranked by engagement</span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate({ kind: "dvm-directory" })}
          className="meta whitespace-nowrap hover:text-text"
        >
          feed providers ›
        </button>
      </div>

      {candidates === null && (
        <div className="p-8 text-center text-sm text-muted">Blending feeds…</div>
      )}

      {candidates !== null && visible.length === 0 && (
        <div className="mx-auto max-w-md p-8 text-center">
          <p className="text-sm text-muted">
            Nothing to explore on your relays yet — moot’s ranking refreshes every ~15 min.
          </p>
          <p className="mt-2 text-xs text-muted">
            Try{" "}
            <button
              type="button"
              onClick={() => onNavigate({ kind: "home" })}
              className="text-accent hover:underline"
            >
              Home
            </button>{" "}
            or browse{" "}
            <button
              type="button"
              onClick={() => onNavigate({ kind: "dvm-directory" })}
              className="text-accent hover:underline"
            >
              feed providers
            </button>
            .
          </p>
        </div>
      )}

      {visible.map((event) => (
        <PostRow key={event.id} event={event} rank={scores.get(event.id)} />
      ))}
    </div>
  );
}
