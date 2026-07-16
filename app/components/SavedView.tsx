"use client";

import { useEffect, useRef, useState } from "react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { useNdk } from "@/app/providers";
import { useBookmarks } from "@/lib/bookmarks";
import { collectEvents, fetchEngagementScores, type Engagement } from "@/lib/nostr";
import { isMuted, useMutes } from "@/lib/mute";
import { PostRow } from "./PostRow";

/**
 * "Saved" — the posts/comments you've bookmarked (NIP-51 kind:10003). The id list
 * is reactive (useBookmarks), so saving/unsaving elsewhere updates this view live;
 * we hydrate the actual events from relays by id and render them newest-saved first.
 */
export function SavedView() {
  const { ndk, connecting } = useNdk();
  const ids = useBookmarks();
  useMutes(); // re-render on mute changes so a muted save drops out
  const [byId, setById] = useState<Map<string, NDKEvent>>(new Map());
  const [scores, setScores] = useState<Map<string, Engagement>>(new Map());
  const [loading, setLoading] = useState(false);
  const fetched = useRef<Set<string>>(new Set());

  // Hydrate any bookmarked ids we haven't fetched yet. Kept across renders so
  // unsaving then re-saving doesn't refetch, and new saves stream in cheaply.
  useEffect(() => {
    const missing = ids.filter((id) => !fetched.current.has(id));
    if (missing.length === 0) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const evs = await collectEvents(ndk, { ids: missing }, 4000);
      if (!alive) return;
      missing.forEach((id) => fetched.current.add(id));
      setById((cur) => {
        const next = new Map(cur);
        for (const e of evs) if (e.id) next.set(e.id, e);
        return next;
      });
      const s = await fetchEngagementScores(ndk, evs.map((e) => e.id).filter(Boolean) as string[]);
      if (alive) setScores((cur) => new Map([...cur, ...s]));
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [ndk, ids]);

  // Render in bookmark order (newest save first), skipping muted authors.
  const posts = ids
    .map((id) => byId.get(id))
    .filter((e): e is NDKEvent => !!e && !isMuted(e));

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">saved</span>
          <span className="meta">· posts you bookmarked</span>
        </div>
      </div>

      {ids.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">
          Nothing saved yet. Tap the bookmark icon on any post to save it here.
        </div>
      ) : posts.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">
          {loading || connecting ? "Loading your saved posts…" : "Your saved posts couldn’t be found on your relays."}
        </div>
      ) : (
        posts.map((event) => <PostRow key={event.id} event={event} rank={scores.get(event.id)} />)
      )}
    </div>
  );
}
