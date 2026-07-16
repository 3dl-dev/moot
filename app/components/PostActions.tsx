"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useRef, useState, type ReactNode } from "react";
import { useNdk } from "@/app/providers";
import { shareLink } from "@/lib/nostr";

/* Inline icons */
const Arrow = ({ dir }: { dir: "up" | "down" }) => (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: dir === "down" ? "rotate(180deg)" : "none" }}
  >
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const Bubble = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" />
  </svg>
);
const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const Share = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
  </svg>
);

/**
 * Up/down voting via NIP-25 reactions ("+" / "-"). Switching sides or toggling
 * off retracts the prior reaction with a NIP-09 deletion, so a user's net vote
 * is always correct on the network — not two contradictory reactions. `baseline`
 * is the network's current net score; the control shows baseline + your vote.
 */
function useVote(event: NDKEvent, baseline: number) {
  const { user, login } = useNdk();
  const [vote, setVote] = useState<0 | 1 | -1>(0);
  const [busy, setBusy] = useState(false);
  const last = useRef<NDKEvent | null>(null);

  const cast = async (dir: 1 | -1) => {
    if (!user) return login();
    if (busy) return;
    setBusy(true);
    try {
      // Retract any prior reaction first (switching sides or toggling off).
      if (last.current) {
        try {
          await last.current.delete();
        } catch {
          /* deletion is best-effort */
        }
        last.current = null;
      }
      if (vote === dir) {
        setVote(0); // clicked the same arrow again → un-voted
      } else {
        last.current = await event.react(dir === 1 ? "+" : "-");
        setVote(dir);
      }
    } catch {
      /* relay rejected / cancelled */
    } finally {
      setBusy(false);
    }
  };

  return { vote, score: baseline + vote, up: () => cast(1), down: () => cast(-1) };
}

/** Reddit-style ▲ score ▼ control. The heart is dead; long live the downvote. */
function VoteControl({ event, baseline = 0 }: { event: NDKEvent; baseline?: number }) {
  const { vote, score, up, down } = useVote(event, baseline);
  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        aria-label="Upvote"
        aria-pressed={vote === 1}
        onClick={up}
        className={`rounded p-1 transition-colors hover:bg-panel-2 ${
          vote === 1 ? "text-accent" : "text-muted hover:text-text"
        }`}
      >
        <Arrow dir="up" />
      </button>
      <span
        className={`min-w-[1.5rem] text-center text-xs font-medium tabular-nums ${
          vote === 1 ? "text-accent" : vote === -1 ? "text-sky-400" : "text-muted"
        }`}
      >
        {score}
      </span>
      <button
        type="button"
        aria-label="Downvote"
        aria-pressed={vote === -1}
        onClick={down}
        className={`rounded p-1 transition-colors hover:bg-panel-2 ${
          vote === -1 ? "text-sky-400" : "text-muted hover:text-text"
        }`}
      >
        <Arrow dir="down" />
      </button>
    </div>
  );
}

function Btn({
  onClick,
  active,
  label,
  children,
}: {
  onClick?: () => void;
  active?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-panel-2 ${
        active ? "text-accent" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

/** Post footer: vote ▲▼ · comments · share. */
export function PostActionBar({
  event,
  replyCount,
  netScore,
  onExpand,
}: {
  event: NDKEvent;
  replyCount?: number;
  netScore?: number;
  onExpand?: () => void;
}) {
  const [shared, setShared] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareLink(event));
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="flex items-center text-muted">
      <VoteControl event={event} baseline={netScore ?? 0} />
      <Btn onClick={onExpand} label="Comments">
        <Bubble />
        {replyCount != null && replyCount > 0 && (
          <span className="meta text-inherit">{replyCount}</span>
        )}
      </Btn>
      <div className="flex-1" />
      <Btn onClick={share} active={shared} label="Share">
        <Share />
        {shared && <span className="text-accent">copied</span>}
      </Btn>
    </div>
  );
}

/** Comment footer: vote ▲▼ · Reply · Expand · Share. */
export function CommentActionBar({
  event,
  netScore,
  onReply,
  onToggle,
  expanded,
  canToggle,
}: {
  event: NDKEvent;
  netScore?: number;
  onReply?: () => void;
  onToggle?: () => void;
  expanded?: boolean;
  canToggle?: boolean;
}) {
  const [shared, setShared] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareLink(event));
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="flex items-center gap-1 text-muted">
      <VoteControl event={event} baseline={netScore ?? 0} />
      {/* No handler (read-only / logged out) → no Reply affordance at all. */}
      {onReply && (
        <Btn onClick={onReply} label="Reply">
          <Bubble />
          <span>Reply</span>
        </Btn>
      )}
      {canToggle && (
        <Btn onClick={onToggle} label={expanded ? "Collapse" : "Expand"}>
          <Chevron open={!!expanded} />
          <span>{expanded ? "Collapse" : "Expand"}</span>
        </Btn>
      )}
      <Btn onClick={share} active={shared} label="Share">
        <Share />
        <span>{shared ? "copied" : "Share"}</span>
      </Btn>
    </div>
  );
}
