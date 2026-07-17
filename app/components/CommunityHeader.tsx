"use client";

import { useState } from "react";
import type { Community } from "@/lib/nostr";
import { muteCommunity, unmuteCommunity, useMutes } from "@/lib/mute";
import { joinCommunity, leaveCommunity, useMemberships } from "@/lib/membership";
import { useNdk } from "@/app/providers";
import { CommunityAvatar } from "./Directory";

export function CommunityHeader({
  community,
  onBack,
}: {
  community: Community;
  onBack: () => void;
}) {
  const { ndk, canSign } = useNdk();
  const mutes = useMutes();
  const muted = mutes.communities.includes(community.addr);
  const joined = useMemberships().includes(community.addr);
  const [busy, setBusy] = useState(false);

  const toggleJoin = async () => {
    setBusy(true);
    try {
      if (joined) await leaveCommunity(ndk, community.addr);
      else await joinCommunity(ndk, community.addr);
    } catch {
      /* optimistic store already rolled back; leave the UI as-is */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border bg-panel/40 px-4 py-3">
      <button
        type="button"
        onClick={onBack}
        className="meta mb-2 inline-flex items-center gap-1 hover:text-text"
      >
        ‹ all communities
      </button>
      <div className="flex gap-3">
        <CommunityAvatar community={community} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="wordmark text-base font-semibold text-text">{community.name}</h1>
          {community.description && (
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{community.description}</p>
          )}
          <div className="meta mt-1">
            {community.moderators.length} moderator{community.moderators.length === 1 ? "" : "s"} ·
            NIP-72
          </div>
        </div>
        <div className="flex h-fit shrink-0 items-center gap-1.5">
          {canSign && (
            <button
              type="button"
              onClick={toggleJoin}
              disabled={busy}
              title={joined ? "Leave this community" : "Join — it shows under My Communities"}
              className={
                joined
                  ? "meta group rounded-md border border-border px-2.5 py-1 hover:border-red-400/50 hover:text-text disabled:opacity-50"
                  : "rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              }
            >
              {joined ? (
                <>
                  <span className="group-hover:hidden">joined</span>
                  <span className="hidden group-hover:inline">leave</span>
                </>
              ) : (
                "Join"
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => (muted ? unmuteCommunity(community.addr) : muteCommunity(community.addr))}
            title={muted ? "Show this community's posts again" : "Hide this community's posts everywhere"}
            className="meta rounded-md border border-border px-2 py-1 hover:text-text"
          >
            {muted ? "muted" : "mute"}
          </button>
        </div>
      </div>
    </div>
  );
}
