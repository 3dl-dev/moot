/**
 * moot ranking spike — prints the DVM feeds over LIVE relay data with a
 * per-signal breakdown, for tuning the objective. It runs the exact production
 * pipeline (scripts/feed-build.ts → the same code the publisher and client use),
 * so what you see here is what ships. Run twice a few minutes apart to see REAL
 * rising velocity (a snapshot persists between runs).
 *
 *   node scripts/rank-spike.ts --hours 8 --top 20
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import NDK from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import { netReactions } from "../lib/rank.ts";
import { buildRankedFeeds, type SortName, type FeedSnapshot } from "./feed-build.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const HOURS = Number(args.get("hours") ?? 8);
const TOP = Number(args.get("top") ?? 20);
const MAX = Number(args.get("candidates") ?? 250);

const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
const short = (pk: string) => `${pk.slice(0, 8)}…`;
const snippet = (c: string) => c.replace(/\s+/g, " ").trim().slice(0, 58);
function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}

async function main() {
  console.log("⟳ connecting…");
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await new Promise((r) => setTimeout(r, 1500));

  const SNAP = join(tmpdir(), "moot-rising-spike.json");
  let prevSnapshot: FeedSnapshot | null = null;
  try {
    prevSnapshot = JSON.parse(readFileSync(SNAP, "utf8"));
  } catch {
    /* first run */
  }

  const feeds = await buildRankedFeeds(ndk, { hours: HOURS, maxCandidates: MAX, limit: 100, prevSnapshot });
  try {
    writeFileSync(SNAP, JSON.stringify(feeds.snapshot));
  } catch {
    /* non-fatal */
  }
  console.log(
    `⟳ ${feeds.stats.candidates} candidates · ${feeds.stats.core} core / ${feeds.stats.extended} extended ` +
      `(${feeds.stats.seeds} seed hubs) · rising=${feeds.stats.velocityReal ? "REAL velocity" : "stateless (run again for Δ)"}`
  );

  // Resolve names for displayed authors only.
  const shownIds = new Set<string>();
  for (const s of ["hot", "rising", "top", "controversial"] as SortName[])
    for (const id of feeds.ids[s].slice(0, TOP)) shownIds.add(id);
  const names = new Map<string, string>();
  await Promise.all(
    [...shownIds].map(async (id) => {
      const ev = feeds.events.get(id);
      if (!ev) return;
      try {
        const p = await withTimeout(ndk.getUser({ pubkey: ev.pubkey }).fetchProfile(), 4000, null);
        if (p?.name || p?.displayName) names.set(ev.pubkey, (p.displayName || p.name)!.slice(0, 16));
      } catch {
        /* ignore */
      }
    })
  );
  const name = (pk: string) => (names.get(pk) ?? short(pk)).padEnd(16).slice(0, 16);

  const printSort = (title: string, ids: string[]) => {
    console.log(`\n═══ ${title} ═══`);
    console.log("  #   age   rplr  rpl  sats  up  dn  author            post");
    ids.slice(0, TOP).forEach((id, i) => {
      const ev = feeds.events.get(id);
      const s = feeds.signals.get(id);
      if (!ev || !s) return;
      const age = ((feeds.now - (ev.created_at ?? 0)) / 3600).toFixed(1);
      console.log(
        `${String(i + 1).padStart(3)}  ${age.padStart(4)}h ${s.repliers.toFixed(1).padStart(5)} ` +
          `${String(Math.round(s.replies)).padStart(4)} ${String(Math.round(s.sats)).padStart(5)} ` +
          `${String(Math.round(s.upvotes)).padStart(3)} ${String(Math.round(s.downvotes)).padStart(3)}  ${name(ev.pubkey)}  ${snippet(ev.content)}`
      );
    });
  };

  printSort("moot HOT", feeds.ids.hot);
  printSort(`moot RISING (${feeds.stats.velocityReal ? "real velocity" : "stateless — run again in a few min"})`, feeds.ids.rising);
  printSort("moot TOP", feeds.ids.top);
  if (feeds.ids.controversial.length) printSort("moot CONTROVERSIAL — the ratio", feeds.ids.controversial);
  else console.log("\n═══ moot CONTROVERSIAL — the ratio ═══\n  (nothing contested this window)");

  // Naive baseline for contrast.
  const naive = [...feeds.events.values()]
    .map((e) => ({ e, s: netReactions(feeds.signals.get(e.id)!) + feeds.signals.get(e.id)!.sats }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 10);
  console.log(`\n─── naive "Top" (net reactions + sats, no decay / no discussion) ───`);
  naive.forEach((n, i) =>
    console.log(`${String(i + 1).padStart(3)}  ${n.s.toFixed(0).padStart(5)}  ${short(n.e.pubkey)}  ${snippet(n.e.content)}`)
  );
  const naiveSet = new Set(naive.map((n) => n.e.id));
  const overlap = feeds.ids.hot.slice(0, 10).filter((id) => naiveSet.has(id)).length;
  console.log(`\n∆ Hot top-10 overlap with naive: ${overlap}/10 (low ⇒ objective doing real work)`);
  process.exit(0);
}

main().catch((e) => {
  console.error("spike failed:", e);
  process.exit(1);
});
