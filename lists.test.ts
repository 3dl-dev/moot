import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  buildListTags,
  createList,
  deleteList,
  getLists,
  parseListEvent,
  parseMembers,
  toHexPubkey,
  updateList,
} from "./lib/lists.ts";

const FIATJAF_NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
const FIATJAF_HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

test("toHexPubkey decodes npub, passes through hex, rejects junk", () => {
  assert.equal(toHexPubkey(FIATJAF_NPUB), FIATJAF_HEX);
  assert.equal(toHexPubkey("nostr:" + FIATJAF_NPUB), FIATJAF_HEX);
  assert.equal(toHexPubkey(FIATJAF_HEX.toUpperCase()), FIATJAF_HEX);
  assert.equal(toHexPubkey("not-a-key"), null);
});

test("parseMembers splits on commas/space/newlines, dedupes, drops invalid", () => {
  const input = `${FIATJAF_NPUB}, ${FIATJAF_HEX}\nnot-a-key  ${FIATJAF_NPUB}`;
  assert.deepEqual(parseMembers(input), [FIATJAF_HEX]); // one valid pubkey, deduped
});

test("parseListEvent reads d/title/p from a kind:30000 event", () => {
  const ev = {
    tags: [
      ["d", "friends"],
      ["title", "My Friends"],
      ["p", "aaaa"],
      ["p", "bbbb"],
      ["other", "ignored"],
    ],
  } as unknown as NDKEvent;
  assert.deepEqual(parseListEvent(ev), { id: "friends", title: "My Friends", pubkeys: ["aaaa", "bbbb"] });
});

test("buildListTags round-trips a list to d/title/p tags", () => {
  assert.deepEqual(buildListTags({ id: "devs", title: "Devs", pubkeys: ["aa", "bb"] }), [
    ["d", "devs"],
    ["title", "Devs"],
    ["p", "aa"],
    ["p", "bb"],
  ]);
});

test("create / update / delete a list, keyed by a slug id", () => {
  const l = createList("Bitcoin Builders", ["aa", "bb", "cc"]);
  assert.equal(l.id, "bitcoin-builders");
  assert.deepEqual(getLists().find((x) => x.id === l.id)?.pubkeys, ["aa", "bb", "cc"]);
  updateList(l.id, { pubkeys: ["aa"] });
  assert.deepEqual(getLists().find((x) => x.id === l.id)?.pubkeys, ["aa"]);
  // A second list with the same title gets a distinct id.
  const l2 = createList("Bitcoin Builders", ["dd"]);
  assert.equal(l2.id, "bitcoin-builders-2");
  deleteList(l.id);
  deleteList(l2.id);
  assert.equal(getLists().some((x) => x.id === l.id || x.id === l2.id), false);
});
