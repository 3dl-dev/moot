/**
 * End-to-end verification of Phase 3 (community moderation) against live relays,
 * using two throwaway keys (an owner/mod and a member). Exercises the real write
 * paths the UI uses and reads them back through the same lib functions.
 *
 *   node scripts/verify-moderation.ts
 *
 * Node reaches relays that the browser can't, so this is how we prove the
 * relay-write features actually work end to end.
 */
import NDK, { NDKEvent, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { DEFAULT_RELAYS } from "../lib/ndk.ts";
import {
  publishCommunity,
  publishCommunityPost,
  publishApproval,
  fetchCommunityApprovals,
  publishReport,
  fetchReports,
  parseReport,
  updateCommunity,
  fetchCommunities,
  isModerator,
} from "../lib/nostr.ts";
import {
  publishLabel,
  fetchCommunityLabels,
  reduceModState,
  NS_MOD,
  NS_FLAIR,
} from "../lib/modlabels.ts";
import { publishVote, fetchPollResponses, parsePoll, tallyPoll } from "../lib/polls.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures++;
};

async function main() {
  const ndk = new NDK({ explicitRelayUrls: DEFAULT_RELAYS });
  await Promise.race([ndk.connect(3000), wait(5000)]);
  await wait(1500);

  const owner = NDKPrivateKeySigner.generate();
  const member = NDKPrivateKeySigner.generate();
  const ownerPk = (await owner.user()).pubkey;
  const memberPk = (await member.user()).pubkey;
  console.log(`owner  ${ownerPk.slice(0, 12)}…`);
  console.log(`member ${memberPk.slice(0, 12)}…\n`);

  // 1. Owner creates a community.
  ndk.signer = owner;
  const community = await publishCommunity(ndk, {
    name: `Verify ${Date.now()}`,
    description: "e2e moderation test",
  });
  console.log(`community ${community.addr}`);
  await wait(1200);

  // 2. Member posts twice (one good, one to be reported/removed).
  ndk.signer = member;
  const good = await publishCommunityPost(ndk, community, "a fine on-topic post");
  const bad = await publishCommunityPost(ndk, community, "SPAM SPAM buy my coin");
  await wait(1200);

  // 3. Owner approves the good post (NIP-72 kind:4550).
  ndk.signer = owner;
  await publishApproval(ndk, community, good);
  await wait(1500);
  const approvals = await fetchCommunityApprovals(ndk, community.addr);
  check(approvals.ids.has(good.id), "approve → kind:4550 approval readable");

  // 4. Owner pins + locks + flairs the good post; removes the bad one.
  await publishLabel(ndk, { namespace: NS_MOD, value: "pin", community: community.addr, targetEvent: good.id });
  await publishLabel(ndk, { namespace: NS_MOD, value: "lock", community: community.addr, targetEvent: good.id });
  await publishLabel(ndk, { namespace: NS_FLAIR, value: "OC", community: community.addr, targetEvent: good.id });
  await publishLabel(ndk, { namespace: NS_MOD, value: "remove", community: community.addr, targetEvent: bad.id, targetPubkey: bad.pubkey });
  await publishLabel(ndk, { namespace: NS_MOD, value: "ban", community: community.addr, targetPubkey: bad.pubkey });
  await wait(1500);
  const labels = await fetchCommunityLabels(ndk, community.addr);
  const state = reduceModState(labels, [community.author, ...community.moderators]);
  check(state.pinned.has(good.id), "pin label → reduceModState.pinned");
  check(state.locked.has(good.id), "lock label → reduceModState.locked (advisory)");
  check(state.flairs.get(good.id)?.includes("OC") ?? false, "flair label → reduceModState.flairs");
  check(state.removed.has(bad.id), "remove label → reduceModState.removed");
  check(state.banned.has(bad.pubkey), "ban label → reduceModState.banned (advisory)");

  // 5. Member reports the bad post (NIP-56 kind:1984, community-tagged).
  ndk.signer = member;
  await publishReport(ndk, { type: "spam", targetEvent: bad.id, targetPubkey: bad.pubkey, community: community.addr, reason: "obvious spam" });
  await wait(1500);
  const reportEvents = await fetchReports(ndk, [community.addr]);
  const reports = reportEvents.map(parseReport).filter((r) => r);
  check(reports.some((r) => r!.targetEvent === bad.id && r!.type === "spam"), "report → kind:1984 in community queue");

  // 6. Owner adds member as a moderator (edit the definition).
  ndk.signer = owner;
  await updateCommunity(ndk, community, { moderators: [community.author, memberPk] });
  await wait(1500);
  const comms = await fetchCommunities(ndk);
  const reloaded = comms.find((c) => c.addr === community.addr);
  check(!!reloaded && isModerator(reloaded, memberPk), "mod-list edit → member is now a moderator");

  // 7. Owner posts a NIP-88 poll; member votes; tally reflects it.
  const poll = new NDKEvent(ndk);
  poll.kind = 1068;
  poll.content = "Ship it?";
  poll.tags = [
    ["option", "yes", "Yes"],
    ["option", "no", "No"],
    ["polltype", "singlechoice"],
  ];
  await poll.publish();
  await wait(1200);
  ndk.signer = member;
  await publishVote(ndk, poll.id, ["yes"]);
  await wait(1500);
  const parsed = parsePoll(poll);
  const responses = await fetchPollResponses(ndk, poll.id);
  const tally = parsed ? tallyPoll(parsed, responses) : { counts: new Map(), total: 0 };
  check((tally.counts.get("yes") ?? 0) >= 1, "poll vote → kind:1018 counted in tally");

  console.log(`\n${failures === 0 ? "✅ all moderation paths verified" : `❌ ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("failed:", e);
  process.exit(1);
});
