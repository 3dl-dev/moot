"use client";

import NDK, { NDKEvent, type NDKFilter } from "@nostr-dev-kit/ndk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNdk } from "@/app/providers";
import { fetchEngagementScores, engagementScore, type Engagement } from "@/lib/nostr";
import { useMutes, isMuted } from "@/lib/mute";
import { isNsfw, useShowNsfw } from "@/lib/nsfw";
import { ReplyBox } from "./parts";
import { PostRow } from "./PostRow";

// After this window the visible list freezes; new events queue behind a pill
// instead of reflowing the feed (kills the live "storm" and lets Top hold).
const PRIME_MS = 2500;

/**
 * Generic two-column feed. Same component drives the global firehose and any
 * community; the caller supplies what to subscribe to, how to filter, how to
 * publish, and an optional header (e.g. a community banner).
 */
export function Feed({
  filters,
  accept,
  publish,
  toolbarLabel,
  composerPlaceholder,
  header,
}: {
  filters: NDKFilter | NDKFilter[];
  accept: (ev: NDKEvent) => boolean;
  publish: (ndk: NDK, text: string) => Promise<NDKEvent>;
  toolbarLabel: string;
  composerPlaceholder: string;
  header?: ReactNode;
}) {
  const { ndk, user, connecting, canSign } = useNdk();
  const [posts, setPosts] = useState<NDKEvent[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [posting, setPosting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [sort, setSort] = useState<"new" | "top">("new");
  const [ranking, setRanking] = useState(false);
  const [primedState, setPrimedState] = useState(false);
  const [scores, setScores] = useState<Map<string, Engagement>>(new Map());
  useMutes(); // re-render when the local mute list changes
  const showNsfw = useShowNsfw();

  const known = useRef(new Set<string>()); // dedupe across shown + pending
  const shownMap = useRef(new Map<string, NDKEvent>()); // currently displayed
  const pendingMap = useRef(new Map<string, NDKEvent>()); // buffered new arrivals
  const primed = useRef(false);

  const flushShown = () => {
    setPosts(
      [...shownMap.current.values()]
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        .slice(0, 100)
    );
  };

  const key = JSON.stringify(filters);
  useEffect(() => {
    known.current = new Set();
    shownMap.current = new Map();
    pendingMap.current = new Map();
    primed.current = false;
    setPosts([]);
    setPendingCount(0);
    setComposing(false);
    setSort("new");
    setScores(new Map());
    setPrimedState(false);

    const sub = ndk.subscribe(filters, { closeOnEose: false });
    sub.on("event", (event: NDKEvent) => {
      if (!event.id || known.current.has(event.id) || !accept(event)) return;
      known.current.add(event.id);
      if (!primed.current) {
        shownMap.current.set(event.id, event);
        flushShown();
      } else {
        pendingMap.current.set(event.id, event);
        setPendingCount(pendingMap.current.size);
      }
    });
    const t = setTimeout(() => {
      primed.current = true;
      setPrimedState(true);
    }, PRIME_MS);
    return () => {
      clearTimeout(t);
      sub.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndk, key]);

  // Fetch engagement scores in the background so "Top" is instant on click.
  const warmScores = async (list: NDKEvent[]) => {
    const ids = list.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) return;
    const s = await fetchEngagementScores(ndk, ids);
    setScores((prev) => new Map([...prev, ...s]));
  };

  // Pre-warm once the initial batch has frozen.
  useEffect(() => {
    if (primedState) warmScores([...shownMap.current.values()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primedState]);

  const showNew = () => {
    for (const [id, ev] of pendingMap.current) shownMap.current.set(id, ev);
    pendingMap.current.clear();
    setPendingCount(0);
    flushShown();
    warmScores([...shownMap.current.values()]);
  };

  const submitPost = async (text: string) => {
    setPosting(true);
    try {
      const ev = await publish(ndk, text);
      if (ev.id && !known.current.has(ev.id)) {
        known.current.add(ev.id);
        shownMap.current.set(ev.id, ev);
        flushShown();
      }
      setComposing(false);
    } finally {
      setPosting(false);
    }
  };

  const rankTop = async () => {
    setSort("top"); // switch immediately using whatever scores are warmed
    if (scores.size === 0) {
      setRanking(true);
      try {
        await warmScores([...shownMap.current.values()]);
      } finally {
        setRanking(false);
      }
    }
  };

  const visible = posts.filter((e) => !isMuted(e) && (showNsfw || !isNsfw(e)));
  const shown =
    sort === "top"
      ? [...visible].sort(
          (a, b) =>
            engagementScore(scores.get(b.id)) - engagementScore(scores.get(a.id)) ||
            (b.created_at ?? 0) - (a.created_at ?? 0)
        )
      : visible;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">the floor</span>
          <span className="meta">· {toolbarLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setSort("new")}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                sort === "new" ? "bg-panel-2 text-text" : "text-muted hover:text-text"
              }`}
            >
              New
            </button>
            <button
              type="button"
              onClick={rankTop}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors ${
                sort === "top" ? "bg-panel-2 text-brass" : "text-muted hover:text-text"
              }`}
            >
              Top
              {ranking && (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-brass border-t-transparent" />
              )}
            </button>
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
      </div>

      {header}

      {composing && canSign && (
        <div className="border-b border-border p-3">
          <ReplyBox
            placeholder={composerPlaceholder}
            submitLabel="Post"
            busy={posting}
            autoFocus
            onSubmit={submitPost}
          />
        </div>
      )}

      {pendingCount > 0 && (
        <div className="sticky top-0 z-10 flex justify-center border-b border-border bg-bg/90 py-2 backdrop-blur">
          <button
            type="button"
            onClick={showNew}
            className="rounded-full border border-brass/40 bg-panel px-3 py-1 text-xs font-medium text-brass transition-colors hover:bg-panel-2"
          >
            ▲ {pendingCount} new post{pendingCount === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {posts.length === 0 && (
        <div className="p-8 text-center text-sm text-muted">
          {connecting ? "Connecting to relays…" : "Nothing here yet."}
        </div>
      )}

      {shown.map((event) => (
        <PostRow key={event.id} event={event} rank={scores.get(event.id)} />
      ))}
    </div>
  );
}
