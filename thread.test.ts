import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { buildThread, parentId, isTopLevelNote } from "./lib/nostr.ts";

// Synthetic events mixing both threading conventions:
//   root ── c1 (NIP-22 kind:1111) ── c3 (NIP-22 nested)
//        └─ c2 (NIP-10 kind:1, "reply" marker) ── c4 (NIP-10 root+reply markers)
const ev = (o: Partial<NDKEvent> & { id: string }) => o as unknown as NDKEvent;
const root = ev({ id: "root", kind: 1, pubkey: "rp", created_at: 1, tags: [] });
const c1 = ev({ id: "c1", kind: 1111, pubkey: "a", created_at: 2, tags: [["E", "root", "", "rp"], ["e", "root", "", "rp"]] });
const c2 = ev({ id: "c2", kind: 1, pubkey: "b", created_at: 3, tags: [["e", "root", "", "reply"]] });
const c3 = ev({ id: "c3", kind: 1111, pubkey: "c", created_at: 4, tags: [["E", "root"], ["e", "c1"]] });
const c4 = ev({ id: "c4", kind: 1, pubkey: "d", created_at: 5, tags: [["e", "root", "", "root"], ["e", "c2", "", "reply"]] });

test("parentId resolves NIP-22 and NIP-10 parents", () => {
  assert.equal(parentId(c1), "root"); // NIP-22 lowercase e
  assert.equal(parentId(c2), "root"); // NIP-10 reply marker
  assert.equal(parentId(c3), "c1");   // NIP-22 nested
  assert.equal(parentId(c4), "c2");   // NIP-10 reply marker (not the root marker)
  assert.equal(parentId(root), null);
});

test("isTopLevelNote distinguishes roots from replies", () => {
  assert.equal(isTopLevelNote(root), true);
  assert.equal(isTopLevelNote(c2), false); // kind:1 but has an e tag
  assert.equal(isTopLevelNote(c1), false); // kind:1111 comment
});

test("buildThread nests both conventions into one tree", () => {
  // Deliberately shuffled input order.
  const tree = buildThread([c4, c1, c3, c2], "root");
  assert.equal(tree.length, 2); // c1, c2 under root
  assert.equal(tree[0].event.id, "c1"); // sorted oldest-first
  assert.equal(tree[1].event.id, "c2");
  assert.equal(tree[0].children[0].event.id, "c3"); // NIP-22 nested
  assert.equal(tree[1].children[0].event.id, "c4"); // NIP-10 nested
  const total = (n: typeof tree): number => n.reduce((s, x) => s + 1 + total(x.children), 0);
  assert.equal(total(tree), 4);
});
