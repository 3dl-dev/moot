/**
 * Explore — the blended discovery surface.
 *
 * The Home feed shows ONE sort at a time (hot, or top, or rising…). Explore is
 * different: it's a *discovery* feed that fuses many precomputed DVM feeds into a
 * single pool and re-ranks that pool by real engagement. The point is to surface
 * things you wouldn't otherwise see — content that multiple independent rankers
 * agree on, and that has drawn real reactions/zaps — rather than the raw firehose
 * or a single algorithm's output.
 *
 * Two-stage rank, and neither stage is recency-first (the explicit design goal —
 * "beyond raw recency"):
 *   1. FUSION — reciprocal-rank fusion (RRF) across the source feeds. A post
 *      ranked high in several feeds (hot AND a topic feed, say) beats one ranked
 *      high in only one. This is the cross-feed-agreement signal.
 *   2. BLEND — multiply fusion by an engagement boost (reactions + zap sats, with
 *      diminishing returns) and a gentle freshness factor so the pool slowly
 *      cycles without letting a few-minutes-old post camp the top.
 *
 * This module is PURE (no relay I/O, no React, no clock) so the ranking is unit-
 * testable and deterministic — the component supplies the candidate lists, the
 * engagement snapshot, and the current time.
 */

/** One source feed's ranked output: a name (the DVM feed tag) and its ids. */
export interface RankedSource {
  tag: string;
  ids: string[];
}

/**
 * RRF softening constant. A larger K flattens the head so the #1 of any single
 * feed doesn't dominate the fusion — cross-feed *agreement* should win, not a
 * lucky top slot in one list. 60 is the value from the original RRF paper.
 */
export const RRF_K = 60;

/** Reciprocal-rank weight for a 0-based position in a source list. */
export function rrfWeight(rank: number): number {
  return 1 / (RRF_K + Math.max(0, rank));
}

/** A candidate in the merged pool: the id, which sources surfaced it, and its
 *  summed cross-feed fusion weight. */
export interface ExploreCandidate {
  id: string;
  sources: string[];
  fusion: number;
}

/**
 * Merge many ranked lists into one deduped candidate pool via reciprocal-rank
 * fusion, best-first. An id appearing in several feeds accumulates a weight from
 * each (higher position ⇒ larger weight), so agreement across independent rankers
 * bubbles it up. Ids are assumed deduped within each source (readLatestDvmFeed
 * guarantees this); a repeat within one source would double-count.
 */
export function mergeSources(sources: RankedSource[]): ExploreCandidate[] {
  const byId = new Map<string, ExploreCandidate>();
  for (const src of sources) {
    src.ids.forEach((id, rank) => {
      const cur = byId.get(id);
      if (cur) {
        if (!cur.sources.includes(src.tag)) cur.sources.push(src.tag);
        cur.fusion += rrfWeight(rank);
      } else {
        byId.set(id, { id, sources: [src.tag], fusion: rrfWeight(rank) });
      }
    });
  }
  return [...byId.values()].sort((a, b) => b.fusion - a.fusion);
}

/**
 * Freshness decay exponent for Explore. Deliberately gentle (Home's Hot uses
 * 1.7): the source feeds already encode recency where it matters, so Explore only
 * needs enough decay to cycle stale winners out over a day, not to chase newness.
 */
export const EXPLORE_GRAVITY = 0.4;

/**
 * Final blend for one candidate: cross-feed fusion × engagement boost × gentle
 * freshness. Engagement (reactions + zap sats) enters through log1p so a viral
 * post can't swamp the pool on raw counts alone — an order of magnitude more
 * engagement is a bounded multiplier, not a linear one.
 */
export function exploreScore(fusion: number, engagement: number, ageSeconds: number): number {
  const engagementBoost = 1 + Math.log1p(Math.max(0, engagement));
  const ageHours = Math.max(0, ageSeconds) / 3600;
  const freshness = 1 / Math.pow(ageHours + 4, EXPLORE_GRAVITY);
  return fusion * engagementBoost * freshness;
}

/**
 * Re-rank a merged pool by the full blend. `lookup` returns the engagement total
 * and createdAt for a candidate id (from the hydrated events + engagement
 * snapshot); ids with no metadata keep their fusion order via a zero-engagement,
 * zero-age fallback. Highest score first; ties fall back to fusion.
 */
export function rankExplore(
  candidates: ExploreCandidate[],
  nowSeconds: number,
  lookup: (id: string) => { engagement: number; createdAt: number } | undefined
): ExploreCandidate[] {
  return candidates
    .map((c) => {
      const meta = lookup(c.id);
      const engagement = meta?.engagement ?? 0;
      const ageSeconds = meta ? Math.max(0, nowSeconds - meta.createdAt) : 0;
      return { c, score: exploreScore(c.fusion, engagement, ageSeconds) };
    })
    .sort((a, b) => b.score - a.score || b.c.fusion - a.c.fusion)
    .map((x) => x.c);
}
