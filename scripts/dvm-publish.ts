/**
 * moot-dvm publisher. Builds the ranked feeds and publishes one kind:6300 per
 * sort (tagged `t=moot-<sort>` so moot's reader selects it), plus a NIP-89
 * kind:31990 handler announcement so moot and any client discover the DVM. Then
 * verifies each feed reads back through moot's own reader (readLatestDvmFeed).
 *
 * This is exactly what the GitHub Actions cron runs. It reuses the client's
 * scoring (lib/rank.ts) via scripts/feed-build.ts — the algorithm is shared.
 *
 *   NOSTR_NSEC=nsec1… node scripts/dvm-publish.ts          # publish + verify
 *   NOSTR_NSEC=nsec1… node scripts/dvm-publish.ts --dry    # build only, no publish
 */
import { readFileSync, writeFileSync } from "node:fs";
import NDK, { NDKEvent, NDKPrivateKeySigner, type NDKKind } from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import {
  readLatestDvmFeed,
  KIND_DVM_RESULT,
  KIND_DVM_REQUEST,
  KIND_HANDLER,
  MOOT_TOPICS,
  topicFeedTag,
} from "../lib/dvm.ts";
import { buildRankedFeeds, type SortName, type FeedSnapshot } from "./feed-build.ts";

const DRY = process.argv.includes("--dry");
const nsec = process.env.NOSTR_NSEC;
if (!nsec) {
  console.error("set NOSTR_NSEC (nsec1… — the moot-dvm signing key)");
  process.exit(1);
}

const SORTS: { name: SortName; tag: string; title: string }[] = [
  { name: "hot", tag: "moot-hot", title: "moot · Hot" },
  { name: "top", tag: "moot-top", title: "moot · Top" },
  { name: "rising", tag: "moot-rising", title: "moot · Rising" },
  { name: "controversial", tag: "moot-controversial", title: "moot · Controversial" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}

async function main() {
  const signer = new NDKPrivateKeySigner(nsec);
  const me = (await signer.user()).pubkey;
  const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS, signer });
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await sleep(1500);
  console.log(`DVM ${me.slice(0, 12)}… · ${ndk.pool.connectedRelays().length}/${DEFAULT_RELAYS.length} relays`);

  // Rising velocity needs the prior run's snapshot; the cron caches this file.
  const SNAP = process.env.SNAPSHOT_FILE ?? "./rising-snapshot.json";
  let prevSnapshot: FeedSnapshot | null = null;
  try {
    prevSnapshot = JSON.parse(readFileSync(SNAP, "utf8"));
  } catch {
    /* cold start — no prior snapshot */
  }

  const feeds = await buildRankedFeeds(ndk, { hours: 8, maxCandidates: 250, limit: 100, prevSnapshot });
  try {
    writeFileSync(SNAP, JSON.stringify(feeds.snapshot));
  } catch {
    /* non-fatal — rising just stays stateless next run */
  }
  console.log(
    `built: ${feeds.stats.candidates} candidates · ${feeds.stats.core} core / ${feeds.stats.extended} extended ` +
      `(${feeds.stats.seeds} seed hubs) · rising=${feeds.stats.velocityReal ? "REAL velocity" : "stateless (cold start)"}`
  );
  for (const s of SORTS) console.log(`  ${s.tag}: ${feeds.ids[s.name].length} posts`);

  // Topic feeds — hot-ranked hashtag slices across all of Nostr. Reuse the global
  // trust graph so we don't rebuild it per topic.
  const topicFeeds: { tag: string; title: string; ids: string[] }[] = [];
  for (const topic of MOOT_TOPICS) {
    const tf = await buildRankedFeeds(ndk, {
      hours: 12,
      maxCandidates: 150,
      limit: 60,
      topicTags: topic.tags,
      tiers: feeds.tiers,
    });
    topicFeeds.push({ tag: topicFeedTag(topic.slug), title: `moot · ${topic.label}`, ids: tf.ids.hot });
    console.log(`  ${topicFeedTag(topic.slug)}: ${tf.ids.hot.length} posts`);
  }

  if (DRY) {
    console.log("\ndry run — not publishing");
    process.exit(0);
  }

  // One kind:6300 per sort.
  for (const s of SORTS) {
    const ids = feeds.ids[s.name];
    if (ids.length === 0) {
      console.log(`skip ${s.tag} (empty this window)`);
      continue;
    }
    const ev = new NDKEvent(ndk);
    ev.kind = KIND_DVM_RESULT as NDKKind;
    ev.content = JSON.stringify(ids.map((id) => ["e", id]));
    ev.tags = [
      ["t", s.tag],
      ["title", s.title],
      ["alt", `${s.title} — discussion-weighted, WoT-filtered Nostr feed`],
    ];
    await ev.publish();
    console.log(`published ${s.tag}: ${ev.id.slice(0, 12)}… (${ids.length} ids)`);
  }

  // Topic feeds.
  for (const tf of topicFeeds) {
    if (tf.ids.length === 0) {
      console.log(`skip ${tf.tag} (empty this window)`);
      continue;
    }
    const ev = new NDKEvent(ndk);
    ev.kind = KIND_DVM_RESULT as NDKKind;
    ev.content = JSON.stringify(tf.ids.map((id) => ["e", id]));
    ev.tags = [
      ["t", tf.tag],
      ["title", tf.title],
      ["alt", `${tf.title} — a hot-ranked topic feed across Nostr`],
    ];
    await ev.publish();
    console.log(`published ${tf.tag}: ${tf.ids.length} ids`);
  }

  // NIP-89 handler announcement so clients discover the DVM.
  const ann = new NDKEvent(ndk);
  ann.kind = KIND_HANDLER as NDKKind;
  ann.content = JSON.stringify({
    name: "moot feeds",
    display_name: "moot · discussion-hot",
    about:
      "Discussion-weighted, web-of-trust-filtered ranked feeds for Nostr: hot, top, rising, controversial. Precomputed — read the latest kind:6300 filtered by #t (moot-hot / moot-top / moot-rising / moot-controversial).",
    picture: "",
  });
  ann.tags = [["d", "moot-feeds"], ["k", String(KIND_DVM_REQUEST)]];
  await ann.publish();
  console.log(`announced (NIP-89 kind:31990): ${ann.id.slice(0, 12)}…`);

  // Verify each feed reads back through moot's own reader.
  await sleep(2500);
  let ok = true;
  for (const s of SORTS) {
    if (feeds.ids[s.name].length === 0) continue;
    const back = await readLatestDvmFeed(ndk, me, s.tag);
    const good = back.length > 0;
    console.log(`verify ${s.tag}: ${good ? "✅" : "❌"} readLatestDvmFeed → ${back.length} ids`);
    ok = ok && good;
  }
  console.log(`\nRESULT: ${ok ? "✅ all feeds published & readable by moot" : "❌ a feed failed to read back"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("publish failed:", e);
  process.exit(1);
});
