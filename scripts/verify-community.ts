/**
 * Verify the approved-feed data path CommunityFeed uses: fetch a community's
 * kind:4550 approvals + posts and resolve the moderated feed.
 *
 *   node scripts/verify-community.ts 34550:<pubkey>:<d>
 */
import NDK, { NDKEvent } from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import {
  collectEvents,
  communityPostFilters,
  fetchCommunityApprovals,
  isTopLevelCommunityPost,
  imetaUrls,
} from "../lib/nostr.ts";

const ADDR =
  process.argv[2] ||
  "34550:e7b12543baec0edfb16c7abaa18a13d1be9a396fbcd95492603f653e03dbed7b:photography-mqjhz6j2";
const snip = (c: string) => c.replace(/\s+/g, " ").trim().slice(0, 44);

function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}

async function main() {
  const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await new Promise((r) => setTimeout(r, 1500));

  const { ids, embedded } = await fetchCommunityApprovals(ndk, ADDR);
  const raw = await collectEvents(ndk, communityPostFilters(ADDR), 5000);
  const topLevel = raw.filter((e) => e.id && isTopLevelCommunityPost(e, ADDR));
  const byId = new Map<string, NDKEvent>();
  for (const e of [...embedded, ...topLevel]) if (e.id) byId.set(e.id, e);
  const approved = [...byId.values()].filter((e) => ids.has(e.id));

  console.log(`approvals: ${ids.size} approved ids, ${embedded.length} embedded events`);
  console.log(`raw top-level posts moot found: ${topLevel.length}`);
  console.log(`→ moderated feed (approved): ${approved.length} posts\n`);
  for (const e of approved.slice(0, 12).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))) {
    const imgs = imetaUrls(e).length;
    console.log(`  k${e.kind} ${imgs ? `📷${imgs}` : "   "}  ${snip(e.content)}`);
  }
  console.log(
    `\n${approved.length > 0 ? "✅" : "⚠️"} approved feed ${approved.length > 0 ? "resolves" : "empty (community may be unmoderated → falls back to all)"}`
  );
  process.exit(0);
}
main().catch((e) => {
  console.error("failed:", e);
  process.exit(1);
});
