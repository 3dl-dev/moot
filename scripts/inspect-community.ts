/**
 * Inspect how a real community's posts are structured on-network, so we can see
 * which threading/kind convention moot is (or isn't) reading. Interop is defined
 * by what other clients actually write — not our assumptions.
 *
 *   node scripts/inspect-community.ts photo
 *   node scripts/inspect-community.ts --addr 34550:<pubkey>:<d>
 */
import NDK, { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import { collectEvents } from "../lib/nostr.ts";

const args = process.argv.slice(2);
const addrArg = args.includes("--addr") ? args[args.indexOf("--addr") + 1] : null;
const term = (addrArg ? "" : args[0]) || "photo";

const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}
const tagKeys = (ev: NDKEvent) => ev.tags.map((t) => t[0]).join(",");
const snip = (c: string) => c.replace(/\s+/g, " ").trim().slice(0, 50);

async function main() {
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await new Promise((r) => setTimeout(r, 1500));

  let addr = addrArg;
  if (!addr) {
    const defs = await collectEvents(ndk, { kinds: [34550 as NDKKind], limit: 500 }, 6000);
    const matches = defs.filter((e) => {
      const hay = (e.tags.map((t) => t[1]).join(" ") + " " + e.content).toLowerCase();
      return hay.includes(term.toLowerCase());
    });
    console.log(`communities matching "${term}": ${matches.length}`);
    // Pick the one with the most posts.
    let best: { addr: string; name: string; count: number } | null = null;
    for (const e of matches.slice(0, 12)) {
      const d = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
      const a = `34550:${e.pubkey}:${d}`;
      const name = e.tags.find((t) => t[0] === "name")?.[1] ?? d;
      const posts = await collectEvents(
        ndk,
        [
          { "#a": [a], limit: 50 },
          { "#A": [a], limit: 50 },
        ],
        4000
      );
      console.log(`  ${name.padEnd(24).slice(0, 24)} ${posts.length} refs  ${a.slice(0, 30)}…`);
      if (!best || posts.length > best.count) best = { addr: a, name, count: posts.length };
    }
    if (!best) return console.log("no matching community found");
    addr = best.addr;
    console.log(`\n▶ inspecting most active: ${best.name} (${best.count} refs)\n  ${addr}\n`);
  }

  // Everything that references the community, by any tag.
  const events = await collectEvents(
    ndk,
    [
      { "#a": [addr!], limit: 100 },
      { "#A": [addr!], limit: 100 },
    ],
    6000
  );

  // Classify by kind + tag shape.
  const byKind = new Map<number, number>();
  for (const e of events) byKind.set(e.kind ?? -1, (byKind.get(e.kind ?? -1) ?? 0) + 1);
  console.log("kinds referencing this community:");
  for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  kind ${k}: ${n}`);

  const hasE = (e: NDKEvent) => e.tags.some((t) => t[0] === "e");
  const hasUpperA = (e: NDKEvent) => e.tags.some((t) => t[0] === "A" && t[1] === addr);
  const hasLowerARoot = (e: NDKEvent) =>
    e.tags.some((t) => t[0] === "a" && t[1] === addr);

  console.log("\nmoot top-level rule (kind∈{1,1111}, references addr, NO e-tag):");
  const mootTop = events.filter(
    (e) => !hasE(e) && ((e.kind === 1 && hasLowerARoot(e)) || (e.kind === 1111 && hasUpperA(e)))
  );
  console.log(`  ${mootTop.length}/${events.length} would show as top-level; the rest render as replies`);

  console.log("\nsample events (kind | tags | e? | snippet):");
  for (const e of events.slice(0, 22)) {
    console.log(
      `  k${String(e.kind).padEnd(5)} ${hasE(e) ? "REPLY" : "top  "}  [${tagKeys(e)}]  ${snip(e.content)}`
    );
  }
  process.exit(0);
}
main().catch((e) => {
  console.error("failed:", e);
  process.exit(1);
});
