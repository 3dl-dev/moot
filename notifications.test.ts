import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  classifyNotification,
  unreadCount,
  notificationFilters,
  type Notification,
} from "./lib/notifications.ts";

const ev = (o: Partial<NDKEvent> & { id: string }) => o as unknown as NDKEvent;
const ME = "me-pubkey";

test("classifyNotification: NIP-10 reply to my note is a reply", () => {
  // kind:1 with an e reply tag and a p tag pointing at me.
  const e = ev({ id: "r1", kind: 1, pubkey: "them", tags: [["e", "mynote", "", "reply"], ["p", ME]] });
  assert.equal(classifyNotification(e, ME), "reply");
});

test("classifyNotification: NIP-22 comment tagging me is a reply", () => {
  const e = ev({ id: "r2", kind: 1111, pubkey: "them", tags: [["e", "mynote", "", "them"], ["p", ME]] });
  assert.equal(classifyNotification(e, ME), "reply");
});

test("classifyNotification: top-level note tagging me is a mention", () => {
  const e = ev({ id: "m1", kind: 1, pubkey: "them", tags: [["p", ME]] });
  assert.equal(classifyNotification(e, ME), "mention");
});

test("classifyNotification: my own event is never a notification", () => {
  const e = ev({ id: "s1", kind: 1, pubkey: ME, tags: [["p", ME]] });
  assert.equal(classifyNotification(e, ME), null);
});

test("classifyNotification: an event that doesn't tag me is dropped", () => {
  const e = ev({ id: "o1", kind: 1, pubkey: "them", tags: [["p", "someone-else"]] });
  assert.equal(classifyNotification(e, ME), null);
});

test("classifyNotification: a reply that also mentions me stays a reply", () => {
  // Reply into someone else's thread that p-tags me inline — bucketed as reply.
  const e = ev({ id: "r3", kind: 1, pubkey: "them", tags: [["e", "otherroot", "", "root"], ["p", ME]] });
  assert.equal(classifyNotification(e, ME), "reply");
});

test("unreadCount counts only items newer than the watermark", () => {
  const n = (created_at: number): Notification => ({
    event: ev({ id: `n${created_at}`, kind: 1, created_at, tags: [] }),
    kind: "mention",
  });
  const items = [n(300), n(200), n(100)];
  assert.equal(unreadCount(items, 150), 2); // 300, 200
  assert.equal(unreadCount(items, 0), 3); // never read → all unread
  assert.equal(unreadCount(items, 300), 0); // caught up
});

test("notificationFilters targets both kinds with a #p on the user", () => {
  const f = notificationFilters(ME);
  assert.deepEqual(f.kinds, [1, 1111]);
  assert.deepEqual(f["#p"], [ME]);
});
