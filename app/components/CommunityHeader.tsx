"use client";

import type { Community } from "@/lib/nostr";
import { CommunityAvatar } from "./Directory";

export function CommunityHeader({
  community,
  onBack,
}: {
  community: Community;
  onBack: () => void;
}) {
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
        <div className="min-w-0">
          <h1 className="wordmark text-base font-semibold text-text">{community.name}</h1>
          {community.description && (
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{community.description}</p>
          )}
          <div className="meta mt-1">
            {community.moderators.length} moderator{community.moderators.length === 1 ? "" : "s"} ·
            NIP-72
          </div>
        </div>
      </div>
    </div>
  );
}
