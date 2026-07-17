"use client";

import { useEffect, useState } from "react";
import { useNdk } from "@/app/providers";
import { fetchCommunities, type Community } from "@/lib/nostr";
import { useMemberships } from "@/lib/membership";

export function Directory({
  onOpen,
  onCreate,
}: {
  onOpen: (c: Community) => void;
  onCreate: () => void;
}) {
  const { ndk, canSign } = useNdk();
  const [items, setItems] = useState<Community[] | null>(null);
  const joined = useMemberships();

  useEffect(() => {
    let alive = true;
    fetchCommunities(ndk).then((c) => alive && setItems(c));
    return () => {
      alive = false;
    };
  }, [ndk]);

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="eyebrow">communities</div>
          <p className="mt-0.5 text-sm text-muted">
            User-run, moderated on NIP-72 — visible to every Nostr client.
          </p>
        </div>
        {canSign && (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90"
          >
            + New community
          </button>
        )}
      </div>

      {items === null && <p className="p-6 text-center text-sm text-muted">Loading communities…</p>}
      {items?.length === 0 && (
        <p className="p-6 text-center text-sm text-muted">No communities found on these relays.</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items?.map((c) => (
          <button
            key={c.addr}
            type="button"
            onClick={() => onOpen(c)}
            className="flex gap-3 rounded-md border border-border bg-panel p-3 text-left transition-colors hover:border-brass/40"
          >
            <CommunityAvatar community={c} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-text">{c.name}</span>
                {joined.includes(c.addr) && (
                  <span className="shrink-0 rounded-full border border-brass/40 px-1.5 py-0.5 text-[0.625rem] font-medium leading-none text-brass">
                    joined
                  </span>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">
                {c.description || "No description."}
              </p>
              <div className="meta mt-1.5">
                {c.moderators.length} moderator{c.moderators.length === 1 ? "" : "s"}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CommunityAvatar({ community, size = 44 }: { community: Community; size?: number }) {
  const hue = parseInt(community.author.slice(0, 6), 16) % 360;
  if (community.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={community.image}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-md object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, background: `hsl(${hue} 40% 40%)` }}
      className="flex shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white/90"
    >
      {community.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
