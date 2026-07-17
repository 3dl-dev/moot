import assert from "node:assert";
import { test } from "node:test";
import { nip19 } from "nostr-tools";
import {
  decodeNostrToken,
  findMentionQuery,
  rankMentions,
  insertMention,
  type MentionCandidate,
} from "./lib/mentions.ts";

const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

test("decodes npub with nostr: prefix and trailing punctuation", () => {
  const t = decodeNostrToken(`nostr:${nip19.npubEncode(hex)},`);
  assert.equal(t.kind, "npub");
  if (t.kind === "npub") {
    assert.equal(t.pubkey, hex);
    assert.equal(t.rest, ","); // trailing char split off as text
  }
});

test("decodes nprofile to its pubkey", () => {
  const nprofile = nip19.nprofileEncode({ pubkey: hex, relays: [] });
  const t = decodeNostrToken(`nostr:${nprofile}`);
  assert.equal(t.kind, "npub");
  if (t.kind === "npub") assert.equal(t.pubkey, hex);
});

test("classifies note/nevent as a ref, not a mention", () => {
  assert.equal(decodeNostrToken(nip19.noteEncode(hex)).kind, "ref");
});

test("plain words are not entities", () => {
  assert.equal(decodeNostrToken("hello").kind, null);
  assert.equal(decodeNostrToken("npubbish").kind, null);
});

test("decodes an naddr community (kind:34550) to its coordinate", () => {
  const naddr = nip19.naddrEncode({ kind: 34550, pubkey: hex, identifier: "photography", relays: [] });
  const t = decodeNostrToken(`nostr:${naddr}!`);
  assert.equal(t.kind, "community");
  if (t.kind === "community") {
    assert.equal(t.addr, `34550:${hex}:photography`);
    assert.equal(t.rest, "!");
  }
});

test("a non-community naddr stays a generic ref", () => {
  const naddr = nip19.naddrEncode({ kind: 30023, pubkey: hex, identifier: "my-article", relays: [] });
  assert.equal(decodeNostrToken(naddr).kind, "ref");
});

/* ------------------------------------------------ @mention autocomplete */

test("findMentionQuery: detects a fresh @token at the caret", () => {
  const text = "hey @ali";
  const q = findMentionQuery(text, text.length);
  assert.deepEqual(q, { query: "ali", start: 4, end: 8 });
});

test("findMentionQuery: bare @ yields an empty query (still active)", () => {
  const q = findMentionQuery("hey @", 5);
  assert.deepEqual(q, { query: "", start: 4, end: 5 });
});

test("findMentionQuery: @ at string start triggers", () => {
  assert.deepEqual(findMentionQuery("@bob", 4), { query: "bob", start: 0, end: 4 });
});

test("findMentionQuery: mid-word @ (email) does not trigger", () => {
  assert.equal(findMentionQuery("mail me@host", 12), null);
});

test("findMentionQuery: caret after whitespace has no active token", () => {
  assert.equal(findMentionQuery("@bob ", 5), null);
});

test("findMentionQuery: honors caret position mid-token", () => {
  // caret between the "l" and "i" of "@ali" -> query is "al"
  const q = findMentionQuery("hey @ali there", 7);
  assert.deepEqual(q, { query: "al", start: 4, end: 7 });
});

const cands: MentionCandidate[] = [
  { pubkey: "a".repeat(64), name: "Alice", nip05: "alice@example.com" },
  { pubkey: "b".repeat(64), name: "Bob", nip05: "bob@nostr.io" },
  { pubkey: "c".repeat(64), name: "Alicia", nip05: "" },
  { pubkey: "d".repeat(64), name: "Carol", nip05: "al@relay.io" },
];

test("rankMentions: name prefix ranks first, alphabetical tie-break", () => {
  const r = rankMentions(cands, "al");
  assert.deepEqual(
    r.map((c) => c.name),
    ["Alice", "Alicia", "Carol"] // name-prefix (Alice, Alicia) before nip05-prefix (Carol via al@)
  );
});

test("rankMentions: empty query returns the head of the list", () => {
  assert.deepEqual(rankMentions(cands, "", 2).length, 2);
});

test("rankMentions: matches nip05 when name misses", () => {
  const r = rankMentions(cands, "nostr.io");
  assert.deepEqual(r.map((c) => c.name), ["Bob"]);
});

test("insertMention: replaces the @query with a nostr:npub token + space", () => {
  const pk = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const { text, caret } = insertMention("hey @ali", 4, 8, pk);
  const npub = nip19.npubEncode(pk);
  assert.equal(text, `hey nostr:${npub} `);
  assert.equal(caret, text.length);
  // round-trips: the inserted token decodes back to the same pubkey
  assert.equal(decodeNostrToken(`nostr:${npub}`).kind, "npub");
});
