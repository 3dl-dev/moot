/**
 * moot ranking core — the "hot" objective.
 *
 * This module is PURE (no relay I/O, no React, no clock) so it can be:
 *   - unit-tested deterministically,
 *   - run server-side in the Model A DVM (precomputed global/community feeds),
 *   - reused unchanged in the Model B DVM (per-user personalized feeds) — only
 *     the candidate set and the web-of-trust anchor differ, not the math.
 *
 * moot is a *discussion* app (two-pane Squabbles format), so the objective is
 * deliberately NOT engagement-maximizing like a generic timeline. It rewards
 * conversation over virality and discounts engagement from outside the web of
 * trust — "score the messenger, not the message" (docs/design.md anti-spam).
 *
 * Everything here is a tuning knob. The spike (scripts/rank-spike.ts) prints the
 * per-signal breakdown so these constants can be tuned against real Nostr data
 * before any hosting is built.
 */

/**
 * Raw engagement signals for one post, relative to the relay set they were
 * collected from (Nostr has no global karma). Channels are kept separate so
 * "people argued about this" is weighted differently from "people liked this",
 * and so the values can already be web-of-trust-weighted by the collector
 * (hence: may be fractional, never assume integers).
 */
export interface RankSignals {
  /** NIP-25 "+" reactions (trust-weighted). */
  upvotes: number;
  /** NIP-25 "-" reactions (trust-weighted). Real dissent — powers Controversial. */
  downvotes: number;
  /** NIP-57 zap sats (trust-weighted by zapper). Economic, hard to fake. */
  sats: number;
  /** Total replies to the post — thread volume (trust-weighted). */
  replies: number;
  /** Distinct reply authors — the core discussion signal (trust-weighted). */
  repliers: number;
}

/** A signals object with everything at zero. */
export const ZERO_SIGNALS: RankSignals = {
  upvotes: 0,
  downvotes: 0,
  sats: 0,
  replies: 0,
  repliers: 0,
};

/** Net reaction score: upvotes minus downvotes. Can be negative. */
export function netReactions(s: RankSignals): number {
  return s.upvotes - s.downvotes;
}

/**
 * Objective weights. Distinct repliers dominate per unit: a human joining the
 * conversation is worth far more than a free tap. Zap sats carry economic
 * weight (a botnet can't fake sats cheaply). Extra replies beyond the distinct
 * repliers add thread-depth credit. These are THE knobs we tune on the spike.
 */
export const WEIGHTS = {
  /** Per distinct human who joined the conversation. The moot thesis. */
  replier: 8,
  /** Per reply beyond the distinct repliers (depth / back-and-forth). */
  reply: 1,
  /** Per zap sat. ~50 sats ≈ one reaction; a 1k-sat zap ≈ 2.5 repliers. */
  sat: 0.02,
  /** Per net like. The weakest, most spammable signal. */
  reaction: 1,
} as const;

/**
 * Freshness decay exponent (reddit/HN "gravity"). Higher ⇒ the feed cycles
 * faster and old posts fall off sooner. 1.7 keeps a well-discussed post visible
 * for several hours without letting yesterday's winner camp the top.
 */
export const GRAVITY = 1.7;

/**
 * Weighted engagement — the numerator, before time decay. Discussion-weighted
 * per WEIGHTS and floored at 0 (a net-downvoted post can't go negative and flip
 * the decay). "Extra replies" credits thread depth without double-counting the
 * repliers already scored at the higher `replier` weight.
 */
export function weightedEngagement(s: RankSignals): number {
  const extraReplies = Math.max(0, s.replies - s.repliers);
  const raw =
    WEIGHTS.replier * s.repliers +
    WEIGHTS.reply * extraReplies +
    WEIGHTS.sat * s.sats +
    WEIGHTS.reaction * netReactions(s);
  return Math.max(0, raw);
}

/**
 * Reddit/HN-style hot score: weighted engagement decayed by age.
 *
 *   score = (weightedEngagement + 1) / (ageHours + 2)^GRAVITY
 *
 * The `+ 1` keeps a brand-new, zero-engagement post scoring above zero, so fresh
 * content is visible; the `+ 2` on age caps how much a few-minutes-old post can
 * outrank everything by sheer newness. A post needs real, trusted discussion to
 * hold the top as it ages.
 *
 * `prior` is the author-trust head start (see AUTHOR_PRIOR) — 0 keeps the pure
 * engagement behaviour (and the original test vectors).
 */
export function hotScore(s: RankSignals, ageSeconds: number, prior = 0): number {
  const ageHours = Math.max(0, ageSeconds) / 3600;
  return (weightedEngagement(s) + Math.max(0, prior) + 1) / Math.pow(ageHours + 2, GRAVITY);
}

/**
 * TOP — highest weighted engagement, no time decay. Reddit's "Top of day/week".
 * The time window (which posts are candidates) is applied by the caller; the
 * score itself is decay-free so the best-of-window rises regardless of age.
 * `ageSeconds`/`prior` are accepted for a uniform Scorer signature and ignored.
 */
export function topScore(s: RankSignals): number {
  return weightedEngagement(s);
}

/** Rising only considers posts younger than this — it's about what's breaking out. */
export const RISING_MAX_AGE_HOURS = 3;

/**
 * RISING — engagement *velocity*: weighted engagement per hour, gated to young
 * posts. Surfaces posts accumulating trusted signal fast for their age, before
 * they've earned a Hot spot. A stateless single-snapshot approximation; the DVM
 * can later upgrade this to true Δengagement/Δt across cron runs. No freshness
 * floor — a post with no engagement isn't "rising", it's just new.
 */
export function risingScore(s: RankSignals, ageSeconds: number, prior = 0): number {
  const ageHours = Math.max(0, ageSeconds) / 3600;
  if (ageHours > RISING_MAX_AGE_HOURS) return 0;
  return (weightedEngagement(s) + Math.max(0, prior)) / (ageHours + 0.25);
}

/**
 * CONTROVERSIAL — "the ratio". Real downvotes are near-zero on Nostr today (the
 * spike measured 0 across the live network), so a pure up/down-balance score
 * would leave this tab permanently empty. Instead we approximate contested-ness
 * the way social media always has: a post drawing far more *argument* (replies)
 * than *endorsement* (likes) is getting **ratio'd**.
 *
 *   pushback    = replies + downvotes         (argument + explicit dissent)
 *   endorsement = upvotes
 *   score       = 0 unless pushback > endorsement (a well-liked, well-discussed
 *                 post is popular, not controversial — this is the crucial gate)
 *               = pushback² / (endorsement + 1)  otherwise
 *
 * Downvotes fold straight into the pushback side, so as `-` reactions spread on
 * the network this smoothly becomes dissent-aware — no code switch needed. Only
 * posts drawing *more* argument than endorsement surface here, which keeps
 * Controversial distinct from Hot/Top instead of collapsing onto the same
 * high-engagement post.
 */
export function controversyScore(s: RankSignals): number {
  const pushback = Math.max(0, s.replies) + Math.max(0, s.downvotes);
  const endorsement = Math.max(0, s.upvotes);
  if (pushback <= endorsement) return 0;
  return (pushback * pushback) / (endorsement + 1);
}

/**
 * Real engagement velocity: how fast weighted engagement grew between two
 * snapshots, in engagement-points per hour. This is the *stateful* Rising the
 * DVM computes across cron runs (persist a snapshot each run, diff on the next).
 * Never negative — retracted reactions/deletions don't make a post "rise".
 * `risingScore` remains the stateless single-snapshot fallback for posts with no
 * prior snapshot (e.g. first-seen this run).
 */
export function engagementVelocity(
  prev: RankSignals,
  curr: RankSignals,
  dtSeconds: number
): number {
  const dtHours = Math.max(1 / 60, Math.max(0, dtSeconds) / 3600); // floor at ~1 min
  return Math.max(0, weightedEngagement(curr) - weightedEngagement(prev)) / dtHours;
}

/** Uniform scorer signature so rankPosts can drive any sort mode. */
export type Scorer = (s: RankSignals, ageSeconds: number, prior: number) => number;

/** The five Reddit sorts as scorers. NEW is chronological (handled by caller). */
export const SCORERS: Record<"hot" | "top" | "rising" | "controversial", Scorer> = {
  hot: (s, age, prior) => hotScore(s, age, prior),
  top: (s) => topScore(s),
  rising: (s, age, prior) => risingScore(s, age, prior),
  controversial: (s) => controversyScore(s),
};

/**
 * Web-of-trust tiers for an actor (reactor / replier / zapper), relative to the
 * feed's anchor identity (the DVM operator's follows for Model A; the requesting
 * user for Model B).
 */
export type TrustTier = "core" | "extended" | "unknown";

/**
 * How much an actor's engagement counts, by tier. Engagement from strangers is
 * heavily discounted so a botnet liking/replying to itself can't climb the feed.
 * This is the anti-spam heart of the objective.
 */
export const TRUST_WEIGHT: Record<TrustTier, number> = {
  core: 1, // hop-1: followed by the anchor
  extended: 0.35, // hop-2: followed by someone the anchor follows
  unknown: 0.05, // outside the graph — barely counts
};

/** Trust weight for a pubkey given a tier lookup. Absent ⇒ unknown. */
export function trustWeight(pubkey: string, tiers: Map<string, TrustTier>): number {
  return TRUST_WEIGHT[tiers.get(pubkey) ?? "unknown"];
}

/**
 * Author-trust prior — a head start (in engagement-points) for a post based on
 * *who wrote it*, before any engagement accrues. This is "score the messenger"
 * applied to the author: a fresh post from someone inside the web of trust
 * outranks fresh spam from a stranger, so spammers (who are never in the graph)
 * stay buried without any content classifier. Strangers earn their way up
 * purely on trusted engagement.
 */
export const AUTHOR_PRIOR: Record<TrustTier, number> = {
  core: 3, // a trusted author's fresh post ≈ 3 reaction-points of head start
  extended: 1,
  unknown: 0, // strangers start from zero and must earn trusted engagement
};

/** Author prior for a pubkey given a tier lookup. Absent ⇒ unknown ⇒ 0. */
export function authorPrior(pubkey: string, tiers: Map<string, TrustTier>): number {
  return AUTHOR_PRIOR[tiers.get(pubkey) ?? "unknown"];
}

/** A scored post: the event id, its final hot score, and the signals behind it. */
export interface RankedPost {
  id: string;
  score: number;
  signals: RankSignals;
  ageSeconds: number;
}

/**
 * Score and sort a batch of posts, highest first. Ties (rare) fall back to
 * fresher-first. Pure: caller supplies signals, ages, and the current time.
 */
export function rankPosts(
  posts: { id: string; signals: RankSignals; createdAt: number; authorPrior?: number }[],
  nowSeconds: number,
  scorer: Scorer = SCORERS.hot
): RankedPost[] {
  return posts
    .map((p) => {
      const ageSeconds = Math.max(0, nowSeconds - p.createdAt);
      return {
        id: p.id,
        score: scorer(p.signals, ageSeconds, p.authorPrior ?? 0),
        signals: p.signals,
        ageSeconds,
      };
    })
    .sort((a, b) => b.score - a.score || a.ageSeconds - b.ageSeconds);
}
