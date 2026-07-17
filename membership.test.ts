import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  memberD,
  buildMembershipTags,
  parseMembership,
  reduceMemberships,
  MEMBER_D_PREFIX,
} from "./lib/membership.ts";

const ev = (o: Partial<NDKEvent>): NDKEvent =>
  ({ pubkey: "", content: "", tags: [], created_at: 0, ...o }) as unknown as NDKEvent;

const ADDR = "34550:fe43ae68:move-eat-live-earn";
const ADDR2 = "34550:d046279e:the-zineverse";

test("memberD namespaces the coordinate under the shared bchnostr prefix", () => {
  assert.equal(memberD(ADDR), `${MEMBER_D_PREFIX}${ADDR}`);
  // Sharing the d with bchnostr is what makes a moot join and a bchnostr join
  // the SAME replaceable event — the whole point of the interop choice.
  assert.equal(memberD(ADDR), "bchnostr/community-member/34550:fe43ae68:move-eat-live-earn");
});

test("buildMembershipTags carries the shared d and the community a-coordinate", () => {
  const tags = buildMembershipTags(ADDR);
  assert.deepEqual(
    tags.find((t) => t[0] === "d"),
    ["d", memberD(ADDR)]
  );
  assert.deepEqual(tags.find((t) => t[0] === "a"), ["a", ADDR, "", "fe43ae68"]);
});

test("parseMembership reads the coordinate from a role=member record", () => {
  const m = ev({ content: '{"role":"member"}', tags: [["a", ADDR, "", "fe43ae68"]] });
  assert.equal(parseMembership(m), ADDR);
});

test("parseMembership tolerates extra content keys (e.g. paidSats)", () => {
  const m = ev({ content: '{"paidSats":458464,"role":"member"}', tags: [["a", ADDR]] });
  assert.equal(parseMembership(m), ADDR);
});

test("parseMembership rejects a community-pin (same a-tag, different role)", () => {
  // bchnostr's community-pin app-data ALSO carries a 34550: a-tag — it must not
  // be read as membership. Gating on role=member is what keeps them apart.
  const pin = ev({ content: '{"eventId":"abc123"}', tags: [["a", ADDR]] });
  assert.equal(parseMembership(pin), null);
});

test("parseMembership rejects non-JSON and non-community records", () => {
  assert.equal(parseMembership(ev({ content: "not json", tags: [["a", ADDR]] })), null);
  assert.equal(
    parseMembership(ev({ content: '{"role":"member"}', tags: [["a", "30000:x:list"]] })),
    null
  );
  assert.equal(parseMembership(ev({ content: '{"role":"member"}', tags: [] })), null);
});

test("reduceMemberships keeps the newest record per community and drops non-members", () => {
  const events = [
    ev({ content: '{"role":"member"}', tags: [["a", ADDR]], created_at: 100 }),
    ev({ content: '{"role":"member"}', tags: [["a", ADDR]], created_at: 200 }), // newer wins
    ev({ content: '{"role":"member"}', tags: [["a", ADDR2]], created_at: 50 }),
    ev({ content: '{"eventId":"x"}', tags: [["a", ADDR]], created_at: 300 }), // pin, ignored
    ev({ content: "seen_notifications_at", tags: [["d", "seen_notifications_at"]] }), // unrelated 30078
  ];
  const map = reduceMemberships(events);
  assert.deepEqual([...map.keys()].sort(), [ADDR, ADDR2].sort());
  assert.equal(map.get(ADDR)?.created_at, 200);
});
