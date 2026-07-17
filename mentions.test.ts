import assert from "node:assert";
import { test } from "node:test";
import { nip19 } from "nostr-tools";
import { decodeNostrToken } from "./lib/mentions.ts";

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
