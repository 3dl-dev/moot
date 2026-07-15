import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  parseCommunity,
  isTopLevelCommunityPost,
  communityPostFilters,
  slugify,
} from "./lib/nostr.ts";

const ev = (o: Partial<NDKEvent> & { id: string }) => o as unknown as NDKEvent;
const ADDR = "34550:owner:builders";

const def = ev({
  id: "def",
  kind: 34550,
  pubkey: "owner",
  created_at: 1,
  tags: [
    ["d", "builders"],
    ["name", "Bitcoin builders"],
    ["description", "ship things"],
    ["p", "owner", "", "moderator"],
    ["p", "mod2", "", "moderator"],
    ["p", "someoneelse", ""],
  ],
});

test("parseCommunity reads addr, metadata, and moderators", () => {
  const c = parseCommunity(def);
  assert.equal(c.addr, ADDR);
  assert.equal(c.name, "Bitcoin builders");
  assert.equal(c.description, "ship things");
  assert.deepEqual(c.moderators, ["owner", "mod2"]); // the non-moderator p is excluded
});

test("isTopLevelCommunityPost matches NIP-72 and NIP-22, rejects replies", () => {
  const classic = ev({ id: "a", kind: 1, tags: [["a", ADDR, "", "root"]] });
  const nip22 = ev({ id: "b", kind: 1111, tags: [["A", ADDR], ["a", ADDR]] });
  const reply = ev({ id: "c", kind: 1, tags: [["a", ADDR], ["e", "a"]] });
  const other = ev({ id: "d", kind: 1, tags: [["a", "34550:owner:other"]] });
  assert.equal(isTopLevelCommunityPost(classic, ADDR), true);
  assert.equal(isTopLevelCommunityPost(nip22, ADDR), true);
  assert.equal(isTopLevelCommunityPost(reply, ADDR), false); // has an e tag → a reply
  assert.equal(isTopLevelCommunityPost(other, ADDR), false); // different community
});

test("communityPostFilters queries both conventions", () => {
  const [classic, nip22] = communityPostFilters(ADDR);
  assert.deepEqual(classic["#a"], [ADDR]);
  assert.deepEqual(nip22["#A"], [ADDR]);
});

test("slugify makes safe community ids", () => {
  assert.equal(slugify("Bitcoin Builders!"), "bitcoin-builders");
  assert.equal(slugify("  Héllo World  "), "h-llo-world");
});
