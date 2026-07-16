"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useCallback, useEffect, useState } from "react";
import { useNdk } from "@/app/providers";
import {
  readLatestDvmFeed,
  requestDvmFeed,
  hydrateEvents,
  type DvmProvider,
} from "@/lib/dvm";
import { isMuted, useMutes } from "@/lib/mute";
import { PostRow } from "./PostRow";
import type { View } from "@/lib/nav";

type State =
  | { phase: "loading" }
  | { phase: "ready"; events: NDKEvent[]; source: "cached" | "live" }
  | { phase: "empty" };

export function DvmFeed({
  provider,
  onNavigate,
}: {
  provider: DvmProvider;
  onNavigate: (v: View) => void;
}) {
  const { ndk, canSign } = useNdk();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  useMutes(); // re-render on mute changes

  // Fast no-auth path: read the provider's latest published result.
  const loadCached = useCallback(async () => {
    setState({ phase: "loading" });
    const ids = await readLatestDvmFeed(ndk, provider.pubkey);
    const events = await hydrateEvents(ndk, ids);
    setState(events.length ? { phase: "ready", events, source: "cached" } : { phase: "empty" });
  }, [ndk, provider.pubkey]);

  useEffect(() => {
    loadCached();
  }, [loadCached]);

  // Live path (needs signer): request a fresh run from the provider.
  const refresh = async () => {
    if (!canSign) return;
    setRefreshing(true);
    try {
      const ids = await requestDvmFeed(ndk, provider.pubkey);
      const events = await hydrateEvents(ndk, ids);
      if (events.length) setState({ phase: "ready", events, source: "live" });
    } finally {
      setRefreshing(false);
    }
  };

  const events = state.phase === "ready" ? state.events.filter((e) => !isMuted(e)) : [];

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">algo feed</span>
          <span className="meta">
            · via {provider.name}
            {state.phase === "ready" && ` · ${state.source}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate({ kind: "discover" })}
            className="meta hover:text-text"
          >
            ‹ all feeds
          </button>
          {canSign && (
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text disabled:opacity-50"
            >
              {refreshing ? "requesting…" : "↻ live run"}
            </button>
          )}
        </div>
      </div>

      {state.phase === "loading" && (
        <div className="p-8 text-center text-sm text-muted">Reading this feed’s latest ranking…</div>
      )}

      {state.phase === "empty" && (
        <div className="mx-auto max-w-md p-8 text-center">
          <p className="text-sm text-muted">
            This provider hasn’t published a recent feed on your relays.
          </p>
          {canSign ? (
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
            >
              {refreshing ? "requesting…" : "Request a live run"}
            </button>
          ) : (
            <p className="mt-2 text-xs text-muted">
              Log in to request a fresh run, or try{" "}
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

      {state.phase === "ready" &&
        (events.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">Everything here is muted.</div>
        ) : (
          events.map((event) => <PostRow key={event.id} event={event} />)
        ))}
    </div>
  );
}
