/**
 * Verify the downvote WRITE path end-to-end with a throwaway key — the exact
 * NDK calls the vote UI makes (`event.react("-")` then `.delete()` to retract).
 * Browsers can't reach these relays; Node can (see repo memory). Proves the new
 * capability actually lands on the network and reads back.
 *
 *   node scripts/verify-downvote.ts
 */
import NDK, { NDKEvent, NDKPrivateKeySigner, type NDKKind } from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import { collectEvents, KIND_TEXT, KIND_REACTION } from "../lib/nostr.ts";

function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}

async function main() {
  const signer = NDKPrivateKeySigner.generate();
  const me = (await signer.user()).pubkey;
  const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS, signer });
  await withTimeout(ndk.connect(3000), 5000, undefined);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`throwaway pubkey: ${me.slice(0, 12)}…`);

  // 1. Grab any recent note to react to.
  const notes = await collectEvents(ndk, { kinds: [KIND_TEXT as NDKKind], limit: 5 }, 6000);
  const target = notes[0];
  if (!target) throw new Error("no target note fetched");
  console.log(`target note: ${target.id.slice(0, 12)}…`);

  // 2. Downvote it — the exact call the UI makes.
  const reaction = await target.react("-");
  console.log(`published downvote: ${reaction.id.slice(0, 12)}… (content="${reaction.content}")`);
  await new Promise((r) => setTimeout(r, 2000));

  // 3. Read it back from the relays.
  const back = await collectEvents(
    ndk,
    { kinds: [KIND_REACTION as NDKKind], authors: [me], "#e": [target.id] },
    6000
  );
  const found = back.find((e) => e.id === reaction.id);
  console.log(`read back: ${found ? "FOUND" : "NOT FOUND"} — content="${found?.content ?? ""}"`);
  const downvoteOk = !!found && found.content.trim() === "-";

  // 4. Retract it (NIP-09) — the switch/toggle-off path.
  const del = await reaction.delete();
  console.log(`published NIP-09 retraction: kind ${del.kind}, targets ${del.tags.filter((t) => t[0] === "e").length} event(s)`);
  const retractOk = del.kind === 5 && del.tags.some((t) => t[0] === "e" && t[1] === reaction.id);

  console.log(`\nRESULT: downvote write ${downvoteOk ? "✅" : "❌"} · NIP-09 retract ${retractOk ? "✅" : "❌"}`);
  process.exit(downvoteOk && retractOk ? 0 : 1);
}

main().catch((e) => {
  console.error("verify failed:", e);
  process.exit(1);
});
