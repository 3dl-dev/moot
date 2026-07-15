"use client";

import type { Community } from "@/lib/nostr";
import { muteCommunity, unmuteCommunity, useMutes } from "@/lib/mute";
import { CommunityAvatar } from "./Directory";

export function CommunityHeader({
  community,
  onBack,
}: {
  community: Community;
  onBack: () => void;
}) {
  const mutes = useMutes();
  const muted = mutes.communities.includes(community.addr);

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
        <button
          type="button"
          onClick={() => (muted ? unmuteCommunity(community.addr) : muteCommunity(community.addr))}
          title={muted ? "Show this community's posts again" : "Hide this community's posts everywhere"}
          className="meta h-fit rounded-md border border-border px-2 py-1 hover:text-text"
        >
          {muted ? "muted" : "mute"}
        </button>
      </div>
    </div>
  );
}
