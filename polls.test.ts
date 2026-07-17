import assert from "node:assert";
import { test } from "node:test";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  parsePoll,
  pollClosed,
  responseSelections,
  tallyPoll,
  buildVoteTags,
  isPoll,
  type Poll,
} from "./lib/polls.ts";

const ev = (o: Partial<NDKEvent> & { tags: string[][]; pubkey?: string }) =>
  ({ id: "e" + Math.random(), content: "", created_at: 100, pubkey: "author", ...o }) as unknown as NDKEvent;

const pollEv = ev({
  id: "poll1",
  kind: 1068,
  content: "Best client?",
  pubkey: "creator",
  tags: [
    ["option", "a", "moot"],
    ["option", "b", "damus"],
    ["option", "c", "amethyst"],
    ["polltype", "singlechoice"],
    ["endsAt", "1000"],
  ],
});

test("isPoll / parsePoll read NIP-88 kind:1068", () => {
  assert.equal(isPoll(pollEv), true);
  const p = parsePoll(pollEv)!;
  assert.equal(p.question, "Best client?");
  assert.equal(p.type, "singlechoice");
  assert.equal(p.endsAt, 1000);
  assert.deepEqual(p.options.map((o) => o.id), ["a", "b", "c"]);
  assert.equal(p.options[0].label, "moot");
  // An event with no option tags is not a poll.
  assert.equal(parsePoll(ev({ kind: 1068, tags: [["polltype", "singlechoice"]] })), null);
});

test("pollClosed respects endsAt", () => {
  const p = parsePoll(pollEv)!;
  assert.equal(pollClosed(p, 999), false);
  assert.equal(pollClosed(p, 1000), true);
  const openEnded: Poll = { ...p, endsAt: undefined };
  assert.equal(pollClosed(openEnded, 9e9), false);
});

test("responseSelections honours single vs multiple choice", () => {
  const r = ev({ tags: [["e", "poll1"], ["response", "a"], ["response", "b"]] });
  assert.deepEqual(responseSelections(r, "singlechoice"), ["a"]); // first only
  assert.deepEqual(responseSelections(r, "multiplechoice"), ["a", "b"]);
});

test("tallyPoll: one vote per pubkey, latest wins, closed/invalid votes dropped", () => {
  const p = parsePoll(pollEv)!; // ends at 1000
  const responses = [
    ev({ pubkey: "u1", created_at: 200, tags: [["e", "poll1"], ["response", "a"]] }),
    ev({ pubkey: "u1", created_at: 300, tags: [["e", "poll1"], ["response", "b"]] }), // re-vote → b wins
    ev({ pubkey: "u2", created_at: 250, tags: [["e", "poll1"], ["response", "a"]] }),
    ev({ pubkey: "u3", created_at: 1500, tags: [["e", "poll1"], ["response", "a"]] }), // after close → ignored
    ev({ pubkey: "u4", created_at: 260, tags: [["e", "poll1"], ["response", "zzz"]] }), // invalid option → ignored
  ];
  const t = tallyPoll(p, responses);
  assert.equal(t.total, 2); // u1 (b) and u2 (a)
  assert.equal(t.counts.get("a"), 1);
  assert.equal(t.counts.get("b"), 1);
  assert.equal(t.counts.get("zzz"), undefined);
});

test("buildVoteTags emits e + response tags", () => {
  assert.deepEqual(buildVoteTags("poll1", ["a", "b"]), [
    ["e", "poll1"],
    ["response", "a"],
    ["response", "b"],
  ]);
});
