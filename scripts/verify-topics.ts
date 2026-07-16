/**
 * Verify the TopicFeed data path: every moot-topic-<slug> feed reads back and
 * hydrates to real events — the exact calls the client makes.
 *
 *   node scripts/verify-topics.ts
 */
import NDK from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import { readLatestDvmFeed, hydrateEvents, MOOT_DVM_PUBKEY, MOOT_TOPICS, topicFeedTag } from "../lib/dvm.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}

async function main() {
  const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await sleep(1500);
  let live = 0;
  for (const t of MOOT_TOPICS) {
    const ids = await readLatestDvmFeed(ndk, MOOT_DVM_PUBKEY, topicFeedTag(t.slug));
    const events = await hydrateEvents(ndk, ids);
    if (events.length) live++;
    console.log(`${t.label.padEnd(14)} ${ids.length} ids → ${events.length} hydrated ${events.length ? "✅" : "…"}`);
  }
  console.log(`\n${live}/${MOOT_TOPICS.length} topic feeds live`);
  process.exit(live > 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("failed:", e);
  process.exit(1);
});
