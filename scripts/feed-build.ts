/**
 * Canonical feed-build pipeline — the exact ranking the DVM publishes and (later)
 * the client falls back to. Pulls a maturation window of posts + their
 * engagement, derives an engagement-seeded web of trust, and returns each sort's
 * ranked id list. All scoring comes from lib/rank.ts; all I/O via NDK.
 *
 * (The spike, scripts/rank-spike.ts, still carries its own copy for exploration;
 * migrating it onto this module is tracked on the board.)
 */
import NDK, { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import {
  collectEvents,
  isTopLevelNote,
  looksLikeContent,
  isHashtagStuffed,
  zapSats,
  KIND_TEXT,
  KIND_COMMENT,
  KIND_PICTURE,
  KIND_REACTION,
  KIND_ZAP,
  KIND_CONTACTS,
} from "../lib/nostr.ts";
import {
  rankPosts,
  trustWeight,
  authorPrior,
  engagementVelocity,
  SCORERS,
  ZERO_SIGNALS,
  type RankSignals,
  type TrustTier,
  type Scorer,
} from "../lib/rank.ts";

export type SortName = "hot" | "top" | "rising" | "controversial";

/** Snapshot the publisher persists between cron runs to compute REAL rising velocity. */
export interface FeedSnapshot {
  at: number;
  signals: Record<string, RankSignals>;
}

export interface BuiltFeeds {
  ids: Record<SortName, string[]>;
  events: Map<string, NDKEvent>; // hydrated candidates, for display/hydration
  signals: Map<string, RankSignals>;
  createdAt: Map<string, number>;
  tiers: Map<string, TrustTier>;
  now: number;
  snapshot: FeedSnapshot; // persist this; pass back as prevSnapshot next run
  stats: { candidates: number; core: number; extended: number; seeds: number; velocityReal: boolean };
}

/** Latest contact list per author, deduped. */
async function contactLists(ndk: NDK, pubkeys: string[]): Promise<NDKEvent[]> {
  if (pubkeys.length === 0) return [];
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_CONTACTS as NDKKind], authors: pubkeys, limit: pubkeys.length },
    6000
  );
  const latest = new Map<string, NDKEvent>();
  for (const e of events) {
    const p = latest.get(e.pubkey);
    if (!p || (e.created_at ?? 0) > (p.created_at ?? 0)) latest.set(e.pubkey, e);
  }
  return [...latest.values()];
}

/** Union of the given accounts' follows. */
async function followSet(ndk: NDK, pubkeys: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (const e of await contactLists(ndk, pubkeys))
    for (const t of e.tags) if (t[0] === "p" && t[1]) set.add(t[1]);
  return set;
}

/** How many of `pubkeys` follow each account (multi-vouch tally). */
async function followVouches(ndk: NDK, pubkeys: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const e of await contactLists(ndk, pubkeys)) {
    const seen = new Set<string>();
    for (const t of e.tags) if (t[0] === "p" && t[1]) seen.add(t[1]);
    for (const pk of seen) counts.set(pk, (counts.get(pk) ?? 0) + 1);
  }
  return counts;
}

function zapper(ev: NDKEvent): string {
  const d = ev.tags.find((t) => t[0] === "description")?.[1];
  if (!d) return "";
  try {
    return (JSON.parse(d) as { pubkey?: string }).pubkey ?? "";
  } catch {
    return "";
  }
}
const targetId = (ev: NDKEvent) => ev.tags.filter((t) => t[0] === "e").at(-1)?.[1];

export async function buildRankedFeeds(
  ndk: NDK,
  opts: {
    hours?: number;
    maxCandidates?: number;
    now?: number;
    limit?: number;
    prevSnapshot?: FeedSnapshot | null;
    /** Restrict candidates to posts carrying one of these hashtags (topic feed). */
    topicTags?: string[];
    /** Reuse a prebuilt trust graph (e.g. the global one) instead of rebuilding. */
    tiers?: Map<string, TrustTier>;
  } = {}
): Promise<BuiltFeeds> {
  const hours = opts.hours ?? 8;
  const maxCandidates = opts.maxCandidates ?? 250;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const limit = opts.limit ?? 100;
  const prev = opts.prevSnapshot ?? null;

  // Candidates: sweep the maturation window with until-cursors (fresh posts have
  // no engagement, so ranking them by "hot" is just ranking by "new").
  const MIN_AGE = 20 * 60;
  const pool = new Map<string, NDKEvent>();
  if (opts.topicTags?.length) {
    // Topic feed: recent posts carrying the topic's hashtags, network-wide.
    // Include NIP-68 picture posts (kind:20) so photo/art topics show the actual
    // images that photo-first clients (Olas) publish, not just text notes.
    const b = await collectEvents(
      ndk,
      {
        kinds: [KIND_TEXT, KIND_PICTURE] as NDKKind[],
        "#t": opts.topicTags,
        since: now - hours * 3600,
        limit: 400,
      },
      6000
    );
    for (const e of b) if (e.id) pool.set(e.id, e);
  } else {
    // Global feed: sweep the maturation window with until-cursors.
    const cursors = [0.5, 1.5, 3, 5, 8].filter((h) => h <= hours).map((h) => now - Math.floor(h * 3600));
    for (const until of cursors) {
      const b = await collectEvents(ndk, { kinds: [KIND_TEXT as NDKKind], until, limit: 300 }, 6000);
      for (const e of b) if (e.id) pool.set(e.id, e);
    }
  }
  const inWindow = (e: NDKEvent) =>
    (e.created_at ?? 0) <= now - MIN_AGE && (e.created_at ?? 0) >= now - hours * 3600;
  const isTopic = !!opts.topicTags?.length;
  // A kind:20 picture post carries its content as an imeta image, not thread
  // text, so it's top-level by definition and exempt from the looksLikeContent
  // text gate (its caption is often empty). Text notes keep the classic gate.
  // On topic feeds, drop hashtag-stuffed link-spam before ranking — bare topic
  // tags (#art, #music, #food) are otherwise ~97% spam that crowds out the
  // handful of genuine posts. The global feed doesn't gate on this: it isn't
  // matched by hashtag and its trust-weighted ranking already sinks such posts.
  const isCandidate = (e: NDKEvent) => {
    if (!inWindow(e)) return false;
    if (isTopic && isHashtagStuffed(e)) return false;
    return e.kind === KIND_PICTURE || (isTopLevelNote(e) && looksLikeContent(e.content));
  };
  let candidates = [...pool.values()].filter(isCandidate);
  if (candidates.length > maxCandidates) {
    candidates.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    const stride = candidates.length / maxCandidates;
    candidates = Array.from({ length: maxCandidates }, (_, i) => candidates[Math.floor(i * stride)]);
  }
  const byId = new Map(candidates.map((e) => [e.id, e]));

  // Raw engagement (giver retained so trust can be derived from it).
  type Raw = { target: string; giver: string; kind: number; sats: number; down: boolean };
  const raw: Raw[] = [];
  const ids = candidates.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 40) {
    const eng = await collectEvents(
      ndk,
      { kinds: [KIND_REACTION, KIND_ZAP, KIND_TEXT, KIND_COMMENT] as NDKKind[], "#e": ids.slice(i, i + 40) },
      5000
    );
    for (const ev of eng) {
      const target = targetId(ev);
      if (!target || !byId.has(target)) continue;
      if (ev.kind === KIND_ZAP) raw.push({ target, giver: zapper(ev), kind: ev.kind, sats: zapSats(ev), down: false });
      else if (ev.kind === KIND_REACTION)
        raw.push({ target, giver: ev.pubkey, kind: ev.kind, sats: 0, down: ev.content.trim() === "-" });
      else raw.push({ target, giver: ev.pubkey, kind: ev.kind, sats: 0, down: false });
    }
  }

  // Engagement-seeded web of trust: hubs that drew the most distinct engagers,
  // grown through the follow graph. No single curator. Reused across topic feeds
  // (opts.tiers) so we build it once, not per topic.
  let tiers = opts.tiers;
  let seeds = 0;
  if (!tiers) {
    tiers = new Map<string, TrustTier>();
    const distinct = new Map<string, Set<string>>();
    for (const r of raw) {
      if (!r.giver) continue;
      const a = byId.get(r.target)!.pubkey;
      (distinct.get(a) ?? distinct.set(a, new Set()).get(a)!).add(r.giver);
    }
    const seed = [...distinct.entries()]
      .filter(([, g]) => g.size >= 2)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 30)
      .map(([pk]) => pk);
    seeds = seed.length;
    // Core = the seed hubs + accounts followed by ≥2 of them (multi-vouch), which
    // keeps "core" tight and resistant to one idiosyncratic hub.
    const vouches = await followVouches(ndk, seed);
    const core = new Set<string>(seed);
    for (const [pk, n] of vouches) if (n >= 2) core.add(pk);
    for (const pk of core) tiers.set(pk, "core");
    const extended = await followSet(ndk, [...core].slice(0, 80));
    for (const pk of extended) if (!tiers.has(pk)) tiers.set(pk, "extended");
  }
  const weightOf = (pk: string) => trustWeight(pk, tiers!);

  // Fold into trust-weighted signals.
  const signals = new Map<string, RankSignals>();
  const repliers = new Map<string, Map<string, number>>();
  for (const e of candidates) {
    signals.set(e.id, { ...ZERO_SIGNALS });
    repliers.set(e.id, new Map());
  }
  for (const r of raw) {
    const s = signals.get(r.target)!;
    if (r.kind === KIND_ZAP) s.sats += weightOf(r.giver) * r.sats;
    else if (r.kind === KIND_REACTION) {
      if (r.down) s.downvotes += weightOf(r.giver);
      else s.upvotes += weightOf(r.giver);
    } else {
      const w = weightOf(r.giver);
      s.replies += w;
      repliers.get(r.target)!.set(r.giver, w);
    }
  }
  for (const [id, m] of repliers) {
    let sum = 0;
    for (const w of m.values()) sum += w;
    signals.get(id)!.repliers = sum;
  }

  const scored = candidates.map((e) => ({
    id: e.id,
    signals: signals.get(e.id)!,
    createdAt: e.created_at ?? 0,
    authorPrior: authorPrior(e.pubkey, tiers),
  }));
  const rankIds = (scorer: Scorer, floor = true) =>
    rankPosts(scored, now, scorer)
      .filter((r) => !floor || r.score > 0)
      .slice(0, limit)
      .map((r) => r.id);

  // RISING — real Δengagement/h vs the prior run's snapshot when we have one in a
  // sane interval; otherwise the stateless approximation for a cold start.
  const dt = prev ? now - prev.at : 0;
  const velocityReal = !!prev && dt > 120 && dt < 6 * 3600;
  const rising = velocityReal
    ? candidates
        .map((e) => ({ id: e.id, v: engagementVelocity(prev!.signals[e.id] ?? ZERO_SIGNALS, signals.get(e.id)!, dt) }))
        .filter((r) => r.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, limit)
        .map((r) => r.id)
    : rankIds(SCORERS.rising);

  return {
    ids: {
      hot: rankIds(SCORERS.hot, false), // hot always > 0 (freshness floor)
      top: rankIds(SCORERS.top),
      rising,
      controversial: rankIds(SCORERS.controversial),
    },
    events: byId,
    signals,
    createdAt: new Map(candidates.map((e) => [e.id, e.created_at ?? 0])),
    tiers,
    now,
    snapshot: { at: now, signals: Object.fromEntries(candidates.map((e) => [e.id, signals.get(e.id)!])) },
    stats: {
      candidates: candidates.length,
      core: [...tiers.values()].filter((t) => t === "core").length,
      extended: [...tiers.values()].filter((t) => t === "extended").length,
      seeds,
      velocityReal,
    },
  };
}
