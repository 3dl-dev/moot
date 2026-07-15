import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  matchesMute,
  parseMuteTags,
  buildMuteTags,
  mergeMutes,
  muteSuperset,
  isManagedMuteTag,
  type Mutes,
} from "./lib/mute.ts";

const ev = (o: Partial<NDKEvent>): NDKEvent =>
  ({ pubkey: "", content: "", tags: [], ...o }) as unknown as NDKEvent;

const NONE: Mutes = { pubkeys: [], words: [], communities: [] };
const ADDR = "34550:mod123:nostrplebs";

test("mutes an event by author pubkey", () => {
  const mutes: Mutes = { ...NONE, pubkeys: ["badactor"] };
  assert.equal(matchesMute(ev({ pubkey: "badactor" }), mutes), true);
  assert.equal(matchesMute(ev({ pubkey: "someoneelse" }), mutes), false);
});

test("mutes a community post via its A tag (NIP-22 kind:1111)", () => {
  const mutes: Mutes = { ...NONE, communities: [ADDR] };
  const post = ev({ pubkey: "author", tags: [["A", ADDR, "", "mod123"]] });
  assert.equal(matchesMute(post, mutes), true);
});

test("mutes a community post via its a tag (classic NIP-72 kind:1)", () => {
  const mutes: Mutes = { ...NONE, communities: [ADDR] };
  const post = ev({ pubkey: "author", tags: [["a", ADDR, "", "mod123"]] });
  assert.equal(matchesMute(post, mutes), true);
});

test("a post in a different community is not muted", () => {
  const mutes: Mutes = { ...NONE, communities: [ADDR] };
  const post = ev({ tags: [["A", "34550:other:room", "", "x"]] });
  assert.equal(matchesMute(post, mutes), false);
});

test("a non-community 'a' tag with a different value does not match", () => {
  const mutes: Mutes = { ...NONE, communities: [ADDR] };
  const post = ev({ tags: [["a", "30023:someone:article", "", "x"]] });
  assert.equal(matchesMute(post, mutes), false);
});

test("mutes by keyword, case-insensitively", () => {
  const mutes: Mutes = { ...NONE, words: ["airdrop"] };
  assert.equal(matchesMute(ev({ content: "Free AIRDROP now" }), mutes), true);
  assert.equal(matchesMute(ev({ content: "just vibes" }), mutes), false);
});

test("an empty mute list hides nothing", () => {
  assert.equal(matchesMute(ev({ pubkey: "x", content: "hi", tags: [["A", ADDR]] }), NONE), false);
});

/* ---------------------------- NIP-51 kind:10000 ---------------------------- */

test("parseMuteTags reads p/word/a and ignores unknown tags", () => {
  const parsed = parseMuteTags([
    ["p", "alice"],
    ["word", "AIRDROP"], // lowercased on read
    ["a", ADDR],
    ["t", "hashtag"], // ignored
    ["e", "someevent"], // ignored
    ["p"], // malformed, skipped
  ]);
  assert.deepEqual(parsed, {
    pubkeys: ["alice"],
    words: ["airdrop"],
    communities: [ADDR],
  });
});

test("buildMuteTags rebuilds managed tags and preserves unmanaged ones", () => {
  const mutes: Mutes = { pubkeys: ["alice"], words: ["spam"], communities: [ADDR] };
  // Existing event had a stale p tag, a hashtag mute, and encrypted-thread e tag.
  const preserved = [
    ["p", "stale-should-be-dropped"],
    ["t", "bitcoin"],
    ["e", "thread1"],
  ];
  const tags = buildMuteTags(mutes, preserved);
  // managed tags come from current state (stale p dropped, not duplicated)
  assert.deepEqual(tags.filter((t) => t[0] === "p"), [["p", "alice"]]);
  assert.deepEqual(tags.filter((t) => t[0] === "word"), [["word", "spam"]]);
  assert.deepEqual(tags.filter((t) => t[0] === "a"), [["a", ADDR]]);
  // unmanaged tags carried through untouched — never clobbered
  assert.ok(tags.some((t) => t[0] === "t" && t[1] === "bitcoin"));
  assert.ok(tags.some((t) => t[0] === "e" && t[1] === "thread1"));
});

test("isManagedMuteTag marks only p/word/a", () => {
  assert.equal(isManagedMuteTag(["p", "x"]), true);
  assert.equal(isManagedMuteTag(["word", "x"]), true);
  assert.equal(isManagedMuteTag(["a", "x"]), true);
  assert.equal(isManagedMuteTag(["t", "x"]), false);
  assert.equal(isManagedMuteTag(["e", "x"]), false);
});

test("mergeMutes unions and de-dupes local + remote", () => {
  const local: Mutes = { pubkeys: ["alice"], words: ["spam"], communities: [] };
  const remote = { pubkeys: ["alice", "bob"], words: ["scam"], communities: [ADDR] };
  assert.deepEqual(mergeMutes(local, remote), {
    pubkeys: ["alice", "bob"],
    words: ["spam", "scam"],
    communities: [ADDR],
  });
});

test("muteSuperset detects when the remote list already covers local", () => {
  const local: Mutes = { pubkeys: ["alice"], words: [], communities: [] };
  const coversAll = { pubkeys: ["alice", "bob"], words: [], communities: [] };
  const missesOne = { pubkeys: ["bob"], words: [], communities: [] };
  assert.equal(muteSuperset(coversAll, local), true); // no republish needed
  assert.equal(muteSuperset(missesOne, local), false); // local has an extra -> republish
});
