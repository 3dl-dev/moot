"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNdk } from "@/app/providers";
import {
  collectEvents,
  communityPostFilters,
  fetchCommunityApprovals,
  fetchEngagementScores,
  isModerator,
  isOwner,
  isTopLevelCommunityPost,
  publishCommunityPost,
  type Community,
  type Engagement,
} from "@/lib/nostr";
import { fetchCommunityLabels, reduceModState, type ModState } from "@/lib/modlabels";
import { isMuted, useMutes } from "@/lib/mute";
import { isNsfw, useShowNsfw } from "@/lib/nsfw";
import { PostRow } from "./PostRow";
import { ReplyBox } from "./parts";
import { CommunityHeader } from "./CommunityHeader";
import { ModProvider, type ModContextValue } from "./ModContext";
import { ManageCommunity } from "./ManageCommunity";

const EMPTY_MOD_STATE: ModState = {
  pinned: new Set(),
  locked: new Set(),
  banned: new Set(),
  removed: new Set(),
  flairs: new Map(),
};

/**
 * A community, shown the way other NIP-72 clients show it: the moderator-approved
 * feed (kind:4550), not the raw firehose of everything tagged to the community.
 * Falls back to all top-level posts when a community isn't moderated, and an
 * "All" toggle reveals the unmoderated set (superset reader — nothing's hidden).
 *
 * On top of approvals it layers moot's NIP-32 moderation state (pins, locks,
 * flairs, removals): pinned posts float to the top, moderator-removed posts are
 * hidden from members, and mods get per-post controls (see PostModBar).
 */
export function CommunityFeed({ community, onBack }: { community: Community; onBack: () => void }) {
  const { ndk, canSign, user } = useNdk();
  const me = user?.pubkey ?? null;
  const [posts, setPosts] = useState<NDKEvent[] | null>(null);
  const [hasApprovals, setHasApprovals] = useState(false);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [modState, setModState] = useState<ModState>(EMPTY_MOD_STATE);
  const [showAll, setShowAll] = useState(false);
  const [managing, setManaging] = useState(false);
  const [scores, setScores] = useState<Map<string, Engagement>>(new Map());
  const [composing, setComposing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useMutes();
  const showNsfw = useShowNsfw();

  const iAmMod = isModerator(community, me);
  const iAmOwner = isOwner(community, me);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setPosts(null);
    (async () => {
      const [{ ids, embedded }, raw, labels] = await Promise.all([
        fetchCommunityApprovals(ndk, community.addr),
        collectEvents(ndk, communityPostFilters(community.addr), 5000),
        fetchCommunityLabels(ndk, community.addr),
      ]);
      const topLevel = raw.filter((e) => e.id && isTopLevelCommunityPost(e, community.addr));
      const byId = new Map<string, NDKEvent>();
      for (const e of [...embedded, ...topLevel]) if (e.id) byId.set(e.id, e);
      const approved = [...byId.values()].filter((e) => ids.has(e.id));
      if (!alive) return;
      setHasApprovals(ids.size > 0);
      setApprovedIds(ids);
      setModState(reduceModState(labels, [community.author, ...community.moderators]));
      const feed = (ids.size > 0 && !showAll ? approved : topLevel).sort(
        (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)
      );
      setPosts(feed);
      const s = await fetchEngagementScores(ndk, feed.map((e) => e.id).filter(Boolean));
      if (alive) setScores(s);
    })();
    return () => {
      alive = false;
    };
  }, [ndk, community.addr, community.author, community.moderators, showAll, reloadKey]);

  const submitPost = async (text: string) => {
    setPosting(true);
    try {
      const ev = await publishCommunityPost(ndk, community, text);
      setPosts((cur) => (cur ? [ev, ...cur] : [ev]));
      setComposing(false);
    } finally {
      setPosting(false);
    }
  };

  // Members never see moderator-removed posts; mods still see them (marked) so
  // they can restore. Pinned posts float to the top, newest-first within groups.
  const visible = useMemo(() => {
    const kept = (posts ?? []).filter((e) => {
      if (!e.id) return false;
      if (isMuted(e) || (!showNsfw && isNsfw(e))) return false;
      // Moderator-removed posts and temp-banned authors are hidden from members
      // (advisory); mods still see them so they can restore / unban.
      if (!iAmMod && (modState.removed.has(e.id) || modState.banned.has(e.pubkey))) return false;
      return true;
    });
    return kept.sort((a, b) => {
      const pa = modState.pinned.has(a.id) ? 1 : 0;
      const pb = modState.pinned.has(b.id) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (b.created_at ?? 0) - (a.created_at ?? 0);
    });
  }, [posts, modState, showNsfw, iAmMod]);

  const modCtx: ModContextValue = {
    community,
    me,
    isMod: iAmMod,
    isOwner: iAmOwner,
    state: modState,
    approved: approvedIds,
    refresh,
  };

  return (
    <ModProvider value={modCtx}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="eyebrow">community</span>
            <span className="meta">
              · {community.name}
              {hasApprovals && !showAll && " · moderated"}
              {iAmMod && " · you moderate"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {iAmOwner && (
              <button
                type="button"
                onClick={() => setManaging((v) => !v)}
                className="meta rounded-md border border-border px-2 py-0.5 text-xs hover:text-text"
              >
                {managing ? "close" : "manage"}
              </button>
            )}
            {hasApprovals && (
              <div className="flex rounded-md border border-border p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAll(false)}
                  className={`rounded px-2 py-0.5 transition-colors ${
                    !showAll ? "bg-panel-2 text-brass" : "text-muted hover:text-text"
                  }`}
                >
                  Approved
                </button>
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className={`rounded px-2 py-0.5 transition-colors ${
                    showAll ? "bg-panel-2 text-text" : "text-muted hover:text-text"
                  }`}
                >
                  All
                </button>
              </div>
            )}
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

        <CommunityHeader community={community} onBack={onBack} />

        {managing && iAmOwner && (
          <ManageCommunity community={community} onSaved={refresh} onClose={() => setManaging(false)} />
        )}

        {composing && canSign && (
          <div className="border-b border-border p-3">
            <ReplyBox
              placeholder={`Post to ${community.name}…`}
              submitLabel="Post"
              busy={posting}
              autoFocus
              onSubmit={submitPost}
              draftKey={`community:${community.addr}`}
            />
          </div>
        )}

        {posts === null && (
          <div className="p-8 text-center text-sm text-muted">Loading {community.name}…</div>
        )}

        {posts !== null && visible.length === 0 && (
          <div className="mx-auto max-w-md p-8 text-center text-sm text-muted">
            {hasApprovals && !showAll ? (
              <>
                No approved posts yet.{" "}
                <button type="button" onClick={() => setShowAll(true)} className="text-accent hover:underline">
                  See all posts
                </button>
                .
              </>
            ) : (
              "No posts in this community yet."
            )}
          </div>
        )}

        {visible.map((event) => (
          <PostRow key={event.id} event={event} rank={scores.get(event.id)} />
        ))}
      </div>
    </ModProvider>
  );
}
