/**
 * Inspect real kind:30078 (NIP-78 app-data) events that look like community
 * membership records, so moot's join/leave writes the same shape other clients
 * read. Interop is defined by what's on the network — not our assumptions.
 *
 *   node scripts/inspect-membership.ts
 */
import NDK, { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import { collectEvents } from "../lib/nostr.ts";

const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}
const tags = (ev: NDKEvent) => JSON.stringify(ev.tags);

async function main() {
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await new Promise((r) => setTimeout(r, 1500));

  const events = await collectEvents(ndk, { kinds: [30078 as NDKKind], limit: 400 }, 6000);
  console.log(`fetched ${events.length} kind:30078 events`);

  // Membership candidates: reference a 34550: community coordinate via an a-tag.
  const memberships = events.filter((e) =>
    e.tags.some((t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"))
  );
  console.log(`\n${memberships.length} reference a 34550: community coordinate:\n`);
  for (const e of memberships.slice(0, 25)) {
    const d = e.tags.find((t) => t[0] === "d")?.[1] ?? "(none)";
    console.log(`  content=${e.content.slice(0, 40).padEnd(40)} d=${d.slice(0, 40).padEnd(40)}`);
    console.log(`    tags=${tags(e).slice(0, 160)}`);
  }

  // What do the d-tags look like across ALL 30078 (namespace convention)?
  const dCounts = new Map<string, number>();
  for (const e of events) {
    const d = e.tags.find((t) => t[0] === "d")?.[1] ?? "(none)";
    dCounts.set(d, (dCounts.get(d) ?? 0) + 1);
  }
  console.log(`\ntop d-tag namespaces across all 30078:`);
  for (const [d, n] of [...dCounts].sort((a, b) => b[1] - a[1]).slice(0, 20))
    console.log(`  ${String(n).padStart(4)}  ${d.slice(0, 60)}`);
  process.exit(0);
}
main().catch((e) => {
  console.error("failed:", e);
  process.exit(1);
});
