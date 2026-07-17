"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Community } from "@/lib/nostr";
import type { ModState } from "@/lib/modlabels";

/**
 * Moderation context for a community view. Provided by CommunityFeed and read by
 * PostCard / CommentColumn so a post can show flairs, a mod toolbar, and an
 * advisory "locked" state without prop-drilling through every feed. `null`
 * outside a community — general feeds render posts with no moderation chrome.
 */
export interface ModContextValue {
  community: Community;
  /** The logged-in user's pubkey, or null. */
  me: string | null;
  /** True when the logged-in user moderates this community. */
  isMod: boolean;
  /** True when the logged-in user owns this community. */
  isOwner: boolean;
  /** Aggregated moderator-authored state (pins, locks, flairs, removals). */
  state: ModState;
  /** kind:4550-approved post ids. */
  approved: Set<string>;
  /** Re-fetch the community's posts + moderation state after an action. */
  refresh: () => void;
}

const Ctx = createContext<ModContextValue | null>(null);

export function ModProvider({ value, children }: { value: ModContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Moderation context for the current post, or null outside a community view. */
export function useMod(): ModContextValue | null {
  return useContext(Ctx);
}
