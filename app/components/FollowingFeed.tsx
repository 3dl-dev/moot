"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useNdk } from "@/app/providers";
import { fetchFollows, fetchFollowsOfFollows, isTopLevelNote, publishNote } from "@/lib/nostr";
import { Feed } from "./Feed";
import type { View } from "@/lib/nav";

/**
 * The WoT feed: people you follow (hop-1), with an optional hop-2 toggle that
 * widens it to follows-of-follows. This is the antidote to the "All" wasteland —
 * trusted authors, so no spam heuristic needed. Requires login (reads your
 * NIP-02 contact list; hop-2 additionally reads your follows' contact lists).
 */
export function FollowingFeed({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { ndk, user, login } = useNdk();
  const [follows, setFollows] = useState<string[] | null>(null);
  const [hop2, setHop2] = useState(false);
  // hop-2 author set: null = not built yet, [] = building. Only used when hop2 on.
  const [hop2Authors, setHop2Authors] = useState<string[] | null>(null);
  const [hop2Loading, setHop2Loading] = useState(false);

  useEffect(() => {
    if (!user) {
      setFollows(null);
      return;
    }
    let alive = true;
    setFollows(null);
    fetchFollows(ndk, user.pubkey).then((f) => alive && setFollows(f));
    return () => {
      alive = false;
    };
  }, [ndk, user]);

  // Lazily build the hop-2 set the first time the toggle is switched on. Cached
  // for the session so re-toggling is instant.
  useEffect(() => {
    if (!hop2 || !user || follows === null || follows.length === 0) return;
    if (hop2Authors !== null) return; // already built
    let alive = true;
    setHop2Loading(true);
    fetchFollowsOfFollows(ndk, user.pubkey, follows)
      .then((a) => alive && setHop2Authors(a))
      .finally(() => alive && setHop2Loading(false));
    return () => {
      alive = false;
    };
  }, [hop2, ndk, user, follows, hop2Authors]);

  // Rebuilding on a fresh follow set: drop the cached hop-2 authors.
  useEffect(() => {
    setHop2Authors(null);
  }, [follows]);

  if (!user) {
    return (
      <Notice title="Your feed, minus the noise">
        <p>
          <span className="font-medium text-text">Following</span> shows posts from the people you
          follow — the antidote to the raw firehose in <span className="text-text">All</span>.
        </p>
        <button
          type="button"
          onClick={() => login()}
          className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black"
        >
          Log in to see it
        </button>
      </Notice>
    );
  }

  if (follows === null) {
    return <div className="p-8 text-center text-sm text-muted">Loading who you follow…</div>;
  }

  if (follows.length === 0) {
    return (
      <Notice title="You don't follow anyone yet">
        <p>
          Follow a few people and their posts show up here. Meanwhile, browse{" "}
          <button
            type="button"
            onClick={() => onNavigate({ kind: "communities" })}
            className="text-accent hover:underline"
          >
            communities
          </button>{" "}
          or the{" "}
          <button
            type="button"
            onClick={() => onNavigate({ kind: "feed" })}
            className="text-accent hover:underline"
          >
            firehose
          </button>
          .
        </p>
      </Notice>
    );
  }

  // Widened only when hop-2 is on AND its fetch actually returned extra accounts;
  // an empty/failed hop-2 fetch transparently falls back to hop-1 (label too).
  const widened = hop2 && !!hop2Authors && hop2Authors.length > follows.length;
  const authors = widened ? hop2Authors! : follows.slice(0, 500);
  const label = widened
    ? `following +follows-of-follows · ${authors.length}`
    : `following · ${follows.length}`;
  // Subtext under the toggle reflects the real outcome, not just the switch.
  const hop2Note = !hop2
    ? "widen to people your follows follow"
    : hop2Loading
      ? "widening your feed…"
      : widened
        ? "hop-2 accounts included"
        : "no follows-of-follows found on your relays";

  return (
    <Feed
      // The Feed remounts on a changed author list (its effect keys on filters),
      // so toggling hop-2 re-subscribes with the wider/narrower set.
      filters={{ kinds: [1], authors: authors.slice(0, 800), limit: 100 }}
      accept={isTopLevelNote}
      publish={(ndk, text) => publishNote(ndk, text)}
      toolbarLabel={label}
      composerPlaceholder="Post to Nostr…"
      draftKey="post:following"
      header={
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs">
          <div className="min-w-0">
            <span className="font-medium text-text">Follows-of-follows</span>
            <span className="ml-2 text-muted">{hop2Note}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={hop2}
            aria-label="Include follows-of-follows (hop-2)"
            onClick={() => setHop2((v) => !v)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              hop2 ? "bg-accent" : "bg-panel-2 ring-1 ring-inset ring-border"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                hop2 ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      }
    />
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <div className="eyebrow mb-1">following</div>
      <h2 className="mb-2 text-sm font-semibold text-text">{title}</h2>
      <div className="space-y-1 text-sm text-muted">{children}</div>
    </div>
  );
}
