"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useNdk } from "@/app/providers";
import { fetchFollows, isTopLevelNote, publishNote } from "@/lib/nostr";
import { Feed } from "./Feed";
import type { View } from "@/lib/nav";

/**
 * The WoT hop-1 feed: only people you follow. This is the antidote to the "All"
 * wasteland — trusted authors, so no spam heuristic needed. Requires login
 * (reads your NIP-02 contact list).
 */
export function FollowingFeed({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { ndk, user, login } = useNdk();
  const [follows, setFollows] = useState<string[] | null>(null);

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

  if (!user) {
    return (
      <Notice title="Your feed, minus the noise">
        <p>
          <span className="font-medium text-text">Home</span> shows posts from the people you
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

  return (
    <Feed
      // Relays cap author lists; 500 covers all but the largest follow sets.
      filters={{ kinds: [1], authors: follows.slice(0, 500), limit: 100 }}
      accept={isTopLevelNote}
      publish={(ndk, text) => publishNote(ndk, text)}
      toolbarLabel={`following · ${follows.length}`}
      composerPlaceholder="Post to Nostr…"
    />
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <div className="eyebrow mb-1">home</div>
      <h2 className="mb-2 text-sm font-semibold text-text">{title}</h2>
      <div className="space-y-1 text-sm text-muted">{children}</div>
    </div>
  );
}
