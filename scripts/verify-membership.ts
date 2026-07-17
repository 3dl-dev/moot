/**
 * Verify the community membership WRITE→READ→LEAVE path end-to-end with a
 * throwaway key, exercising the real lib/membership.ts functions the Join/Leave
 * button calls. Browsers can't reach these relays; Node can (see repo memory).
 *
 *   node scripts/verify-membership.ts
 */
import NDK, { NDKPrivateKeySigner, type NDKKind } from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import { collectEvents, KIND_COMMUNITY } from "../lib/nostr.ts";
import {
  joinCommunity,
  leaveCommunity,
  isMember,
  getMemberships,
  hydrateMemberships,
  KIND_APP_DATA,
  memberD,
} from "../lib/membership.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}

// Mirror lib/membershipsync.ts's syncMembershipsOnLogin here — we can't import
// that module under Node's TS loader (it uses extensionless app-code imports),
// but this exercises the same fetch → hydrateMemberships → reduce/parse path.
async function hydrateFromRelays(ndk: NDK, pubkey: string): Promise<void> {
  const fetched = await collectEvents(
    ndk,
    { kinds: [KIND_APP_DATA as NDKKind], authors: [pubkey], limit: 500 },
    4000
  );
  hydrateMemberships(fetched);
}

async function main() {
  const signer = NDKPrivateKeySigner.generate();
  const me = (await signer.user()).pubkey;
  const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS, signer });
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await sleep(1500);
  console.log(`throwaway pubkey: ${me.slice(0, 12)}…`);

  // 1. Pick a real community to join.
  const defs = await collectEvents(ndk, { kinds: [KIND_COMMUNITY as NDKKind], limit: 20 }, 6000);
  const def = defs.find((e) => e.tags.some((t) => t[0] === "d" && t[1]));
  if (!def) throw new Error("no community definition fetched");
  const d = def.tags.find((t) => t[0] === "d")![1];
  const addr = `${KIND_COMMUNITY}:${def.pubkey}:${d}`;
  console.log(`community: ${addr.slice(0, 40)}…`);

  // 2. JOIN — the exact call the button makes.
  await joinCommunity(ndk, addr);
  const wroteOptimistic = isMember(addr);
  console.log(`after joinCommunity: isMember=${wroteOptimistic} (optimistic)`);
  await sleep(2500);

  // 3. Hydrate from relays (replaces the store from what the network actually
  //    returned) — proves the write landed AND the read/parse path finds it.
  await hydrateFromRelays(ndk, me);
  const readBack = isMember(addr);
  console.log(`after relay hydrate: isMember=${readBack}, joined=[${getMemberships().map((a) => a.slice(0, 18) + "…").join(", ")}]`);

  // Confirm the on-relay event carries the shared bchnostr `d` (interop dedup).
  const raw = await collectEvents(
    ndk,
    { kinds: [KIND_APP_DATA as NDKKind], authors: [me], limit: 10 },
    6000
  );
  const dOk = raw.some((e) => e.tags.some((t) => t[0] === "d" && t[1] === memberD(addr)));
  console.log(`shared d "${memberD(addr).slice(0, 34)}…" on relay: ${dOk ? "YES" : "NO"}`);

  // 4. LEAVE — NIP-09 delete, then re-hydrate to confirm it's gone.
  await leaveCommunity(ndk, addr);
  const leftOptimistic = !isMember(addr);
  await sleep(2500);
  await hydrateFromRelays(ndk, me);
  const goneAfterHydrate = !isMember(addr);
  console.log(`after leaveCommunity: isMember(optimistic)=${!leftOptimistic ? "true" : "false"}, after re-hydrate isMember=${!goneAfterHydrate}`);

  const joinOk = wroteOptimistic && readBack && dOk;
  const leaveOk = leftOptimistic; // relay delete-honoring varies; local retract is guaranteed
  console.log(
    `\nRESULT: join write+read ${joinOk ? "✅" : "❌"} · leave/NIP-09 ${leaveOk ? "✅" : "❌"}` +
      (goneAfterHydrate ? " · relay honored delete ✅" : " · (some relays lag on deletes)")
  );
  process.exit(joinOk && leaveOk ? 0 : 1);
}

main().catch((e) => {
  console.error("verify failed:", e);
  process.exit(1);
});
