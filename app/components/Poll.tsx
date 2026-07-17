"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useEffect, useState } from "react";
import { useNdk } from "@/app/providers";
import {
  parsePoll,
  tallyPoll,
  pollClosed,
  fetchPollResponses,
  publishVote,
  responseSelections,
} from "@/lib/polls";

/** Forward duration to a future unix time, e.g. "3h", "2d". */
function endsIn(unix: number): string {
  const s = Math.max(0, unix - Math.floor(Date.now() / 1000));
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Render a NIP-88 poll (kind:1068) with live tallies and, for a logged-in user,
 * voting (kind:1018). Reads any poll on the network — moot is a superset reader —
 * and writes the conservative NIP-88 response. Single- vs multiple-choice is
 * honoured per spec.
 */
export function Poll({ event }: { event: NDKEvent }) {
  const { ndk, user, canSign, login } = useNdk();
  const poll = parsePoll(event);
  const [responses, setResponses] = useState<NDKEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!poll?.id) return;
    let alive = true;
    (async () => {
      const rs = await fetchPollResponses(ndk, poll.id);
      if (!alive) return;
      setResponses(rs);
      setLoaded(true);
      // Reflect an existing vote by this user, if any.
      if (user) {
        const mine = rs
          .filter((r) => r.pubkey === user.pubkey)
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
        if (mine) setPicked(new Set(responseSelections(mine, poll.type)));
      }
    })();
    return () => {
      alive = false;
    };
  }, [ndk, poll?.id, poll?.type, user]);

  if (!poll) return null;

  const closed = pollClosed(poll);
  const tally = tallyPoll(poll, responses);
  const myVote = user ? responses.some((r) => r.pubkey === user.pubkey) : false;

  const toggle = (optId: string) => {
    if (poll.type === "singlechoice") setPicked(new Set([optId]));
    else
      setPicked((cur) => {
        const next = new Set(cur);
        next.has(optId) ? next.delete(optId) : next.add(optId);
        return next;
      });
  };

  const submit = async () => {
    if (!canSign) return login();
    if (picked.size === 0 || busy) return;
    setBusy(true);
    try {
      const ev = await publishVote(ndk, poll.id, [...picked]);
      setResponses((cur) => [...cur.filter((r) => r.pubkey !== user?.pubkey), ev]);
    } catch {
      /* relay rejected / cancelled */
    } finally {
      setBusy(false);
    }
  };

  // Show results once the user has voted, the poll closed, or votes exist.
  const showResults = myVote || closed;

  return (
    <div className="rounded-md border border-border bg-panel-2/40 p-3">
      {poll.question && <p className="mb-2 text-sm font-medium text-text">{poll.question}</p>}
      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          const count = tally.counts.get(opt.id) ?? 0;
          const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
          const mine = picked.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={closed || busy}
              onClick={() => !closed && toggle(opt.id)}
              aria-pressed={mine}
              className={`relative block w-full overflow-hidden rounded border px-2.5 py-1.5 text-left text-sm transition-colors ${
                mine ? "border-brass text-text" : "border-border text-muted hover:text-text"
              } ${closed ? "cursor-default" : "cursor-pointer"}`}
            >
              {showResults && (
                <span
                  className="absolute inset-y-0 left-0 bg-brass/15"
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
              )}
              <span className="relative flex items-center justify-between gap-2">
                <span>
                  {mine && "● "}
                  {opt.label || opt.id}
                </span>
                {showResults && (
                  <span className="tabular-nums text-xs text-muted">
                    {pct}% · {count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>
          {loaded ? `${tally.total} vote${tally.total === 1 ? "" : "s"}` : "…"}
          {poll.type === "multiplechoice" && " · multiple choice"}
          {poll.endsAt && (closed ? " · closed" : ` · ends in ${endsIn(poll.endsAt)}`)}
        </span>
        {!closed && (
          <button
            type="button"
            onClick={submit}
            disabled={busy || picked.size === 0}
            className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {myVote ? "Change vote" : "Vote"}
          </button>
        )}
      </div>
    </div>
  );
}
