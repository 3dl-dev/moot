"use client";

import { useState } from "react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { useNdk } from "@/app/providers";
import { DEFAULT_RELAYS } from "@/lib/ndk";
import { relaysSupportSearch, searchEvents } from "@/lib/search";
import { KIND_TEXT } from "@/lib/nostr";
import { PostRow } from "./PostRow";

interface ProfileMeta {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

/**
 * Search posts and profiles via NIP-50. Queries our search-capable relays; when
 * none are available it shows a notice instead of silently returning nothing.
 */
export function SearchView() {
  const { ndk } = useNdk();
  const supported = relaysSupportSearch(DEFAULT_RELAYS);
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState<NDKEvent[]>([]);
  const [profiles, setProfiles] = useState<NDKEvent[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  const run = async () => {
    const q = query.trim();
    if (!q || !supported) return;
    setState("loading");
    const evs = await searchEvents(ndk, q, [0, KIND_TEXT], 5000);
    // kind:0 is replaceable — dedupe to the newest profile per author so a person
    // shows once, not once per historical version each relay returns.
    const byPubkey = new Map<string, NDKEvent>();
    for (const e of evs.filter((e) => e.kind === 0).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))) {
      if (!byPubkey.has(e.pubkey)) byPubkey.set(e.pubkey, e);
    }
    setProfiles([...byPubkey.values()]);
    setPosts(evs.filter((e) => e.kind === KIND_TEXT));
    setState("done");
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">search</span>
          <span className="meta">· posts &amp; profiles across Nostr</span>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Search Nostr…"
            disabled={!supported}
            className="w-full rounded-md border border-border bg-panel-2 px-3 py-1.5 text-sm text-text placeholder:text-muted focus:border-brass/40 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={run}
            disabled={!supported || !query.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black transition-opacity disabled:opacity-40"
          >
            Search
          </button>
        </div>
      </div>

      {!supported ? (
        <div className="p-8 text-center text-sm text-muted">
          Search needs a relay that supports NIP-50, and none of your connected relays do.
        </div>
      ) : state === "loading" ? (
        <div className="p-8 text-center text-sm text-muted">Searching…</div>
      ) : state === "done" && profiles.length === 0 && posts.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">No matches for “{query.trim()}”.</div>
      ) : (
        <>
          {profiles.length > 0 && (
            <div className="border-b border-border">
              <div className="px-4 pt-3 pb-1">
                <span className="eyebrow">profiles</span>
              </div>
              {profiles.map((e) => (
                <ProfileResult key={e.id} event={e} />
              ))}
            </div>
          )}
          {posts.map((event) => (
            <PostRow key={event.id} event={event} />
          ))}
        </>
      )}
    </div>
  );
}

/** A profile (kind:0) search hit: avatar + name + nip05 + about snippet. */
function ProfileResult({ event }: { event: NDKEvent }) {
  let meta: ProfileMeta = {};
  try {
    meta = JSON.parse(event.content) as ProfileMeta;
  } catch {
    /* malformed profile — fall back to the pubkey */
  }
  const name = meta.display_name || meta.name || event.pubkey.slice(0, 12);
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {meta.picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={meta.picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded-full bg-panel-2" />
      )}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-text">{name}</span>
          {meta.nip05 && <span className="meta truncate">{meta.nip05}</span>}
        </div>
        {meta.about && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{meta.about}</p>}
      </div>
    </div>
  );
}
