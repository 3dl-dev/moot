import NDK, { NDKEvent, type NDKFilter, type NDKKind } from "@nostr-dev-kit/ndk";
import { collectEvents } from "./nostr.ts";

/**
 * NIP-88 polls. A poll is a kind:1068 event carrying `option` tags; a vote is a
 * kind:1018 response referencing the poll (`e`) with one `response` tag per
 * chosen option. moot READS polls posted anywhere (a superset reader) and lets a
 * logged-in user cast a vote — the conservative write is exactly the NIP-88
 * response event.
 */
export const KIND_POLL = 1068;
export const KIND_POLL_RESPONSE = 1018;

export type PollType = "singlechoice" | "multiplechoice";

export interface PollOption {
  id: string;
  label: string;
}

export interface Poll {
  id: string;
  question: string; // the poll event's content
  options: PollOption[];
  type: PollType;
  endsAt?: number; // unix seconds; undefined = open-ended
  author: string;
}

/** True if this event is a NIP-88 poll. */
export function isPoll(ev: NDKEvent): boolean {
  return ev.kind === KIND_POLL;
}

/** Parse a kind:1068 poll event. Returns null if it carries no options. */
export function parsePoll(ev: NDKEvent): Poll | null {
  const options: PollOption[] = [];
  for (const t of ev.tags) {
    if (t[0] === "option" && t[1]) options.push({ id: t[1], label: t[2] ?? "" });
  }
  if (options.length === 0) return null;
  const polltype = ev.tags.find((t) => t[0] === "polltype")?.[1];
  const endsAtRaw = ev.tags.find((t) => t[0] === "endsAt")?.[1];
  const endsAt = endsAtRaw ? Number(endsAtRaw) : undefined;
  return {
    id: ev.id ?? "",
    question: ev.content ?? "",
    options,
    type: polltype === "multiplechoice" ? "multiplechoice" : "singlechoice",
    endsAt: endsAt && Number.isFinite(endsAt) ? endsAt : undefined,
    author: ev.pubkey,
  };
}

/** True once a poll's endsAt has passed (open-ended polls never close). */
export function pollClosed(poll: Poll, now = Math.floor(Date.now() / 1000)): boolean {
  return poll.endsAt !== undefined && now >= poll.endsAt;
}

/** The option ids a single response event selected, honouring poll type. */
export function responseSelections(ev: NDKEvent, type: PollType): string[] {
  const chosen = ev.tags.filter((t) => t[0] === "response" && t[1]).map((t) => t[1]);
  if (chosen.length === 0) return [];
  // NIP-88: singlechoice counts only the first response; multiplechoice counts
  // the first response pointing to each distinct id.
  return type === "singlechoice" ? [chosen[0]] : [...new Set(chosen)];
}

export interface PollTally {
  counts: Map<string, number>; // optionId → vote count
  total: number; // distinct voters
}

/**
 * Tally responses to a poll: one vote per pubkey (their latest response wins),
 * ignoring votes cast after the poll closed and any option id not on the poll.
 */
export function tallyPoll(poll: Poll, responses: NDKEvent[]): PollTally {
  const validOptions = new Set(poll.options.map((o) => o.id));
  // Latest response per author (a re-vote replaces an earlier one).
  const latest = new Map<string, NDKEvent>();
  for (const r of responses) {
    if (poll.endsAt !== undefined && (r.created_at ?? 0) >= poll.endsAt) continue;
    const prev = latest.get(r.pubkey);
    if (!prev || (r.created_at ?? 0) > (prev.created_at ?? 0)) latest.set(r.pubkey, r);
  }
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of latest.values()) {
    const sels = responseSelections(r, poll.type).filter((id) => validOptions.has(id));
    if (sels.length === 0) continue;
    total++;
    for (const id of sels) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { counts, total };
}

/** Tags for a NIP-88 vote (kind:1018) on a poll. */
export function buildVoteTags(pollId: string, optionIds: string[]): string[][] {
  return [["e", pollId], ...optionIds.map((id) => ["response", id])];
}

/** Fetch all responses (kind:1018) to a poll. */
export function fetchPollResponses(ndk: NDK, pollId: string, capMs = 5000): Promise<NDKEvent[]> {
  const filter: NDKFilter = { kinds: [KIND_POLL_RESPONSE as NDKKind], "#e": [pollId] };
  return collectEvents(ndk, filter, capMs);
}

/** Publish a vote (kind:1018) on a poll. Requires a signer. */
export async function publishVote(
  ndk: NDK,
  pollId: string,
  optionIds: string[]
): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_POLL_RESPONSE as NDKKind;
  ev.tags = buildVoteTags(pollId, optionIds);
  await ev.publish();
  return ev;
}
