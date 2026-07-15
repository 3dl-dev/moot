/**
 * moot ranking spike — prove feed quality on REAL Nostr data before we build
 * any hosting. Runs the exact objective from lib/rank.ts (the same code the
 * Model A DVM will run) over live relay data and prints the ranked output with
 * a per-signal breakdown, next to today's naive "Top" for contrast.
 *
 *   node scripts/rank-spike.ts                       # defaults (4h, fiatjaf anchor)
 *   node scripts/rank-spike.ts --hours 8 --top 40
 *   node scripts/rank-spike.ts --anchor npub1...     # WoT anchored on you
 *   node scripts/rank-spike.ts --wot off             # disable trust weighting
 *
 * Node ≥ 22 strips TS types natively, so no build step. Relays are reachable
 * from Node even where a browser can't hit them (see repo memory).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import NDK, { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import {
  collectEvents,
  isTopLevelNote,
  looksLikeContent,
  zapSats,
  KIND_TEXT,
  KIND_COMMENT,
  KIND_REACTION,
  KIND_ZAP,
  KIND_CONTACTS,
} from "../lib/nostr.ts";
import {
  rankPosts,
  weightedEngagement,
  netReactions,
  trustWeight,
  authorPrior,
  engagementVelocity,
  SCORERS,
  ZERO_SIGNALS,
  type RankSignals,
  type TrustTier,
} from "../lib/rank.ts";

// --- args -------------------------------------------------------------------
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
}
const HOURS = Number(args.get("hours") ?? 4);
const TOP = Number(args.get("top") ?? 30);
const WOT_ON = (args.get("wot") ?? "on") !== "off";
const MAX_CANDIDATES = Number(args.get("candidates") ?? 250);
// Default anchor: fiatjaf — a dense, active follow graph. Swap for your own npub.
const ANCHOR_ARG = args.get("anchor") ?? "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
// "single" = one account's follows seed trust; "algo" = engagement-seeded graph.
const ANCHOR_MODE = args.get("anchor-mode") ?? "single";
const anchorKey = ANCHOR_MODE === "algo" ? "algo" : ANCHOR_ARG.slice(0, 12);

const now = Math.floor(Date.now() / 1000);
const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });

// --- helpers ----------------------------------------------------------------

/** Latest kind:3 follow set for each author, unioned. One query, all authors. */
async function followSet(pubkeys: string[]): Promise<Set<string>> {
  if (pubkeys.length === 0) return new Set();
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_CONTACTS as NDKKind], authors: pubkeys, limit: pubkeys.length },
    6000
  );
  const latest = new Map<string, NDKEvent>();
  for (const e of events) {
    const prev = latest.get(e.pubkey);
    if (!prev || (e.created_at ?? 0) > (prev.created_at ?? 0)) latest.set(e.pubkey, e);
  }
  const set = new Set<string>();
  for (const e of latest.values())
    for (const t of e.tags) if (t[0] === "p" && t[1]) set.add(t[1]);
  return set;
}

/** The zapper's pubkey, read from the embedded kind:9734 zap-request. */
function zapper(ev: NDKEvent): string | null {
  const desc = ev.tags.find((t) => t[0] === "description")?.[1];
  if (!desc) return null;
  try {
    return (JSON.parse(desc) as { pubkey?: string }).pubkey ?? null;
  } catch {
    return null;
  }
}

/** Target of an engagement event = its last `e` tag (matches fetchEngagementScores). */
function targetId(ev: NDKEvent): string | undefined {
  return ev.tags.filter((t) => t[0] === "e").at(-1)?.[1];
}

const short = (pk: string) => `${pk.slice(0, 8)}…`;
const snippet = (c: string) => c.replace(/\s+/g, " ").trim().slice(0, 68);

/** Resolve a promise or give up after `ms` — nothing on the relay path may hang. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

// --- pipeline ---------------------------------------------------------------

async function main() {
  console.log(`\n⟳ connecting to ${DEFAULT_RELAYS.length} relays…`);
  // connect() can await the pool indefinitely; cap it and move on — subscriptions
  // reconnect on their own, and collectEvents has its own time caps.
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await new Promise((r) => setTimeout(r, 1500)); // let sockets settle
  console.log(`⟳ connected (${ndk.pool.connectedRelays().length}/${DEFAULT_RELAYS.length} relays up)`);

  // 1. Candidate posts. A busy relay returns only the newest few minutes for a
  //    single `limit` query — and the newest posts have NO engagement yet, so
  //    ranking them by "hot" is just ranking by "new". We instead sweep the
  //    *maturation window* with `until` cursors so candidates are old enough
  //    (≥ MIN_AGE) to have earned signal.
  const MIN_AGE = 20 * 60; // 20 min — below this, engagement hasn't accrued
  const cursors = [0.5, 1.5, 3, 5, 8].filter((h) => h <= HOURS).map((h) => now - Math.floor(h * 3600));
  const pool = new Map<string, NDKEvent>();
  for (const until of cursors) {
    const batch = await collectEvents(ndk, { kinds: [KIND_TEXT as NDKKind], until, limit: 300 }, 6000);
    for (const e of batch) if (e.id) pool.set(e.id, e);
  }
  let candidates = [...pool.values()].filter(
    (e) =>
      isTopLevelNote(e) &&
      looksLikeContent(e.content) &&
      (e.created_at ?? 0) <= now - MIN_AGE &&
      (e.created_at ?? 0) >= now - HOURS * 3600
  );
  if (candidates.length > MAX_CANDIDATES) {
    candidates.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    const stride = candidates.length / MAX_CANDIDATES;
    candidates = Array.from({ length: MAX_CANDIDATES }, (_, i) => candidates[Math.floor(i * stride)]);
  }
  const ages = candidates.map((e) => (now - (e.created_at ?? 0)) / 3600);
  console.log(
    `⟳ candidates: ${candidates.length} mature top-level notes ` +
      `(age ${Math.min(...ages).toFixed(1)}–${Math.max(...ages).toFixed(1)}h) from a pool of ${pool.size}`
  );
  const byId = new Map(candidates.map((e) => [e.id, e]));

  // 2. RAW engagement (giver retained; weighting applied later). Fetching before
  //    trust is what lets the algorithmic anchor be DERIVED from who engages whom.
  type Raw = { target: string; giver: string; kind: number; sats: number; down: boolean };
  const raw: Raw[] = [];
  const ids = candidates.map((e) => e.id);
  const CHUNK = 40;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const eng = await collectEvents(
      ndk,
      { kinds: [KIND_REACTION, KIND_ZAP, KIND_TEXT, KIND_COMMENT] as NDKKind[], "#e": chunk },
      5000
    );
    for (const ev of eng) {
      const target = targetId(ev);
      if (!target || !byId.has(target)) continue;
      if (ev.kind === KIND_ZAP) raw.push({ target, giver: zapper(ev) ?? "", kind: ev.kind, sats: zapSats(ev), down: false });
      else if (ev.kind === KIND_REACTION) raw.push({ target, giver: ev.pubkey, kind: ev.kind, sats: 0, down: ev.content.trim() === "-" });
      else raw.push({ target, giver: ev.pubkey, kind: ev.kind, sats: 0, down: false }); // reply
    }
    process.stdout.write(`\r⟳ engagement: ${Math.min(i + CHUNK, ids.length)}/${ids.length} posts`);
  }
  console.log("");

  // 3. Web of trust — single-anchor OR engagement-seeded algorithmic.
  const tiers = new Map<string, TrustTier>();
  if (WOT_ON && ANCHOR_MODE === "algo") {
    // Seed = authors who drew the most DISTINCT engagers in the window
    // (engagement-selected hubs, ≥2 distinct engagers to resist a single botnet).
    // Core = who those hubs collectively follow (vouch for); extended = hop-2.
    // Trust is thus derived from engagement, then spread through the follow graph —
    // no single curator. (First cut; the DVM upgrades this to iterated EigenTrust.)
    const distinct = new Map<string, Set<string>>();
    for (const r of raw) {
      if (!r.giver) continue;
      const author = byId.get(r.target)!.pubkey;
      (distinct.get(author) ?? distinct.set(author, new Set()).get(author)!).add(r.giver);
    }
    const seed = [...distinct.entries()]
      .filter(([, g]) => g.size >= 2)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 30)
      .map(([pk]) => pk);
    const core = await followSet(seed);
    for (const pk of seed) core.add(pk); // the hubs themselves are core
    for (const pk of core) tiers.set(pk, "core");
    const sample = [...core].slice(0, 80);
    const extended = await followSet(sample);
    for (const pk of extended) if (!tiers.has(pk)) tiers.set(pk, "extended");
    console.log(
      `⟳ WoT (algo, engagement-seeded): ${seed.length} seed hubs → ${core.size} core, ${tiers.size - core.size} extended`
    );
  } else if (WOT_ON) {
    const anchor = ANCHOR_ARG.startsWith("npub") ? ndk.getUser({ npub: ANCHOR_ARG }).pubkey : ANCHOR_ARG;
    const core = await followSet([anchor]);
    for (const pk of core) tiers.set(pk, "core");
    const sample = [...core].slice(0, 80);
    const extended = await followSet(sample);
    for (const pk of extended) if (!tiers.has(pk)) tiers.set(pk, "extended");
    console.log(`⟳ web of trust (single anchor): ${core.size} core, ${tiers.size - core.size} extended`);
  } else {
    console.log("⟳ web of trust: DISABLED (every actor counts equally)");
  }
  const weightOf = (pk: string | null | undefined) =>
    !WOT_ON ? 1 : pk ? trustWeight(pk, tiers) : trustWeight("", tiers);

  // 4. Fold raw engagement into trust-weighted signals.
  const signals = new Map<string, RankSignals>();
  const repliers = new Map<string, Map<string, number>>(); // postId -> giver -> weight
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
      s.replies += w; // total (trust-weighted) reply volume
      repliers.get(r.target)!.set(r.giver, w); // distinct givers (deduped by Map)
    }
  }
  for (const [id, m] of repliers) {
    let sum = 0;
    for (const w of m.values()) sum += w;
    signals.get(id)!.repliers = sum; // distinct repliers — the discussion signal
  }

  // 4. Rank with the objective (+ author-trust prior when WoT is on).
  const ranked = rankPosts(
    candidates.map((e) => ({
      id: e.id,
      signals: signals.get(e.id)!,
      createdAt: e.created_at ?? 0,
      authorPrior: WOT_ON ? authorPrior(e.pubkey, tiers) : 0,
    })),
    now
  );

  // 5. Resolve display names for the top N only.
  const names = new Map<string, string>();
  await Promise.all(
    ranked.slice(0, TOP).map(async (r) => {
      const pk = byId.get(r.id)!.pubkey;
      try {
        const p = await withTimeout(ndk.getUser({ pubkey: pk }).fetchProfile(), 4000, null);
        if (p?.name || p?.displayName) names.set(pk, (p.displayName || p.name)!.slice(0, 16));
      } catch {
        /* ignore */
      }
    })
  );
  const name = (pk: string) => (names.get(pk) ?? short(pk)).padEnd(16).slice(0, 16);

  // A ranked-list printer reused by each sort.
  const scored = candidates.map((e) => ({
    id: e.id,
    signals: signals.get(e.id)!,
    createdAt: e.created_at ?? 0,
    authorPrior: WOT_ON ? authorPrior(e.pubkey, tiers) : 0,
  }));
  const printSort = (title: string, list: { id: string; score: number; ageSeconds: number }[]) => {
    console.log(`\n═══ ${title} ═══`);
    console.log("  #  score   age   rplr  rpl  sats  up  dn  author            post");
    list.slice(0, TOP).forEach((r, i) => {
      const s = signals.get(r.id)!;
      const ev = byId.get(r.id)!;
      console.log(
        `${String(i + 1).padStart(3)}  ${r.score.toFixed(3).padStart(6)}  ${(r.ageSeconds / 3600).toFixed(1).padStart(4)}h ` +
          `${s.repliers.toFixed(1).padStart(5)} ${String(Math.round(s.replies)).padStart(4)} ${String(Math.round(s.sats)).padStart(5)} ` +
          `${String(Math.round(s.upvotes)).padStart(3)} ${String(Math.round(s.downvotes)).padStart(3)}  ${name(ev.pubkey)}  ${snippet(ev.content)}`
      );
    });
  };

  // 6a. HOT (default).
  printSort(`moot HOT — discussion-weighted${WOT_ON ? " + WoT-filtered" : ""} + freshness decay`, ranked);

  // 6b. RISING — REAL velocity across snapshots when a recent prior run exists,
  //     else the stateless approximation. This is exactly what the DVM cron does.
  const SNAP = join(tmpdir(), `moot-rising-${anchorKey}.json`);
  let prevSnap: { at: number; posts: Record<string, RankSignals> } | null = null;
  try {
    prevSnap = JSON.parse(readFileSync(SNAP, "utf8"));
  } catch {
    /* first run — no prior snapshot */
  }
  writeFileSync(
    SNAP,
    JSON.stringify({ at: now, posts: Object.fromEntries(candidates.map((e) => [e.id, signals.get(e.id)!])) })
  );

  let rising: { id: string; score: number; ageSeconds: number }[];
  let risingLabel: string;
  const dt = prevSnap ? now - prevSnap.at : 0;
  if (prevSnap && dt > 120 && dt < 6 * 3600) {
    rising = candidates
      .map((e) => ({
        id: e.id,
        score: engagementVelocity(prevSnap!.posts[e.id] ?? ZERO_SIGNALS, signals.get(e.id)!, dt),
        ageSeconds: now - (e.created_at ?? 0),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    risingLabel = `moot RISING — REAL velocity (Δweighted-engagement/h vs snapshot ${(dt / 60).toFixed(0)}m ago)`;
  } else {
    rising = rankPosts(scored, now, SCORERS.rising).filter((r) => r.score > 0);
    risingLabel = prevSnap
      ? "moot RISING — stateless approx (prior snapshot too old/new for Δ)"
      : "moot RISING — stateless approx (RUN AGAIN in a few min for REAL velocity)";
  }
  if (rising.length === 0) console.log(`\n═══ ${risingLabel} ═══\n  (nothing rising this window)`);
  else printSort(risingLabel, rising);

  // 6c. CONTROVERSIAL — "the ratio" (argument ≫ endorsement; downvotes fold in).
  const controversial = rankPosts(scored, now, SCORERS.controversial).filter((r) => r.score > 0);
  if (controversial.length === 0)
    console.log(`\n═══ moot CONTROVERSIAL — the ratio ═══\n  (nothing contested in this window)`);
  else printSort("moot CONTROVERSIAL — the ratio (replies ≫ likes; downvotes strengthen it)", controversial);

  // 6d. Today's naive "Top" for contrast.
  const naive = candidates
    .map((e) => {
      const s = signals.get(e.id)!;
      return { ev: e, score: netReactions(s) + s.sats };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  console.log(`\n─── today's naive "Top" (net reactions + sats, no decay, no discussion signal) ───`);
  naive.forEach((n, i) => {
    console.log(
      `${String(i + 1).padStart(3)}  ${n.score.toFixed(0).padStart(6)}   ${short(n.ev.pubkey)}  ${snippet(n.ev.content)}`
    );
  });

  // 6e. Health check: did the objective actually reorder things?
  const hotTop = new Set(ranked.slice(0, 10).map((r) => r.id));
  const naiveTop = new Set(naive.map((n) => n.ev.id));
  const overlap = [...hotTop].filter((id) => naiveTop.has(id)).length;
  console.log(
    `\n∆ Hot top-10 overlap with naive Top: ${overlap}/10  (low ⇒ objective doing real work)`
  );
  const maxEng = Math.max(...candidates.map((e) => weightedEngagement(signals.get(e.id)!)));
  const totalDown = candidates.reduce((n, e) => n + signals.get(e.id)!.downvotes, 0);
  console.log(`∆ peak weighted engagement: ${maxEng.toFixed(1)}   ∆ total downvotes seen: ${totalDown.toFixed(1)}`);
  console.log(`∆ rising: ${rising.length} breaking out · controversial: ${controversial.length} contested\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error("spike failed:", e);
  process.exit(1);
});
