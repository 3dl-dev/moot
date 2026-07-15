/**
 * Verify the HomeFeed data path: every moot-<sort> feed the DVM publishes reads
 * back and hydrates to real events — the exact calls HomeFeed makes. Runs from
 * Node (this sandbox's browser can't reach relays; real browsers can).
 *
 *   node scripts/verify-home-read.ts
 */
import NDK from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import { readLatestDvmFeed, hydrateEvents, MOOT_DVM_PUBKEY, MOOT_FEED_TAGS } from "../lib/dvm.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}

async function main() {
  const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await sleep(1500);
  let ok = true;
  for (const [sort, tag] of Object.entries(MOOT_FEED_TAGS)) {
    const ids = await readLatestDvmFeed(ndk, MOOT_DVM_PUBKEY, tag);
    const events = await hydrateEvents(ndk, ids);
    const good = events.length > 0;
    console.log(`${sort.padEnd(14)} ${tag.padEnd(20)} ${ids.length} ids → ${events.length} hydrated ${good ? "✅" : "❌"}`);
    ok = ok && good;
  }
  console.log(ok ? "\n✅ HomeFeed data path works — feeds read + hydrate" : "\n❌ a feed did not hydrate");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("verify failed:", e);
  process.exit(1);
});
