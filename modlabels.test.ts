import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  buildLabelTags,
  parseLabel,
  reduceModState,
  resolvedTargets,
  NS_MOD,
  NS_FLAIR,
} from "./lib/modlabels.ts";

const ev = (o: Partial<NDKEvent> & { pubkey: string; tags: string[][] }) =>
  ({ id: "id-" + Math.random(), content: "", created_at: 1, ...o }) as unknown as NDKEvent;

const ADDR = "34550:owner:builders";
const MOD = "modpubkey";
const NOTMOD = "randopubkey";

test("buildLabelTags emits NIP-32 L/l plus community and targets", () => {
  const tags = buildLabelTags({
    namespace: NS_MOD,
    value: "pin",
    community: ADDR,
    targetEvent: "post1",
    targetPubkey: "author1",
  });
  assert.deepEqual(tags[0], ["L", NS_MOD]);
  assert.deepEqual(tags[1], ["l", "pin", NS_MOD]);
  assert.deepEqual(tags[2], ["a", ADDR]);
  assert.deepEqual(tags[3], ["e", "post1"]);
  assert.deepEqual(tags[4], ["p", "author1"]);
});

test("parseLabel round-trips a moot label and rejects foreign namespaces", () => {
  const l = parseLabel(
    ev({ pubkey: MOD, content: "spam", tags: buildLabelTags({ namespace: NS_MOD, value: "remove", community: ADDR, targetEvent: "post1" }) })
  );
  assert.ok(l);
  assert.equal(l!.value, "remove");
  assert.equal(l!.community, ADDR);
  assert.equal(l!.targetEvent, "post1");
  assert.equal(l!.note, "spam");
  // A label in someone else's namespace isn't a moot moderation label.
  const foreign = parseLabel(ev({ pubkey: MOD, tags: [["L", "com.example"], ["l", "x", "com.example"], ["a", ADDR]] }));
  assert.equal(foreign, null);
});

test("reduceModState honours only moderator-authored labels", () => {
  const labels = [
    parseLabel(ev({ pubkey: MOD, tags: buildLabelTags({ namespace: NS_MOD, value: "pin", community: ADDR, targetEvent: "p1" }) }))!,
    parseLabel(ev({ pubkey: MOD, tags: buildLabelTags({ namespace: NS_MOD, value: "lock", community: ADDR, targetEvent: "p2" }) }))!,
    parseLabel(ev({ pubkey: MOD, tags: buildLabelTags({ namespace: NS_MOD, value: "ban", community: ADDR, targetPubkey: "baddie" }) }))!,
    parseLabel(ev({ pubkey: MOD, tags: buildLabelTags({ namespace: NS_FLAIR, value: "OC", community: ADDR, targetEvent: "p1" }) }))!,
    // A non-moderator's label must be ignored (advisory, unauthorized).
    parseLabel(ev({ pubkey: NOTMOD, tags: buildLabelTags({ namespace: NS_MOD, value: "pin", community: ADDR, targetEvent: "p99" }) }))!,
  ];
  const st = reduceModState(labels, [MOD]);
  assert.deepEqual([...st.pinned], ["p1"]);
  assert.deepEqual([...st.locked], ["p2"]);
  assert.deepEqual([...st.banned], ["baddie"]);
  assert.deepEqual(st.flairs.get("p1"), ["OC"]);
  assert.equal(st.pinned.has("p99"), false); // non-mod pin ignored
});

test("reduceModState collects removals", () => {
  const labels = [
    parseLabel(ev({ pubkey: MOD, tags: buildLabelTags({ namespace: NS_MOD, value: "remove", community: ADDR, targetEvent: "spam1" }) }))!,
    parseLabel(ev({ pubkey: NOTMOD, tags: buildLabelTags({ namespace: NS_MOD, value: "remove", community: ADDR, targetEvent: "ok1" }) }))!,
  ];
  const st = reduceModState(labels, [MOD]);
  assert.deepEqual([...st.removed], ["spam1"]);
  assert.equal(st.removed.has("ok1"), false); // non-mod removal ignored
});

test("resolvedTargets collects remove/dismiss actions from mods only", () => {
  const labels = [
    parseLabel(ev({ pubkey: MOD, tags: buildLabelTags({ namespace: NS_MOD, value: "remove", community: ADDR, targetEvent: "p1" }) }))!,
    parseLabel(ev({ pubkey: MOD, tags: buildLabelTags({ namespace: NS_MOD, value: "dismiss", community: ADDR, targetEvent: "p2" }) }))!,
    parseLabel(ev({ pubkey: MOD, tags: buildLabelTags({ namespace: NS_MOD, value: "pin", community: ADDR, targetEvent: "p3" }) }))!,
    parseLabel(ev({ pubkey: NOTMOD, tags: buildLabelTags({ namespace: NS_MOD, value: "remove", community: ADDR, targetEvent: "p4" }) }))!,
  ];
  const resolved = resolvedTargets(labels, [MOD]);
  assert.deepEqual([...resolved].sort(), ["p1", "p2"]); // pin isn't a resolution; non-mod ignored
});
