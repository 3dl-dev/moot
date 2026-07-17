"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useRef, useState, type ReactNode } from "react";
import { useNdk } from "@/app/providers";
import { shareLink } from "@/lib/nostr";
import { toggleBookmark, useBookmarks } from "@/lib/bookmarks";

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
const Bookmark = ({ filled }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

/** Save/unsave toggle. Bookmarks are local-first and sync to NIP-51 kind:10003
 *  once logged in (see lib/bookmarks.ts), so this works logged out too. */
function BookmarkBtn({ event }: { event: NDKEvent }) {
  const ids = useBookmarks();
  const saved = event.id ? ids.includes(event.id) : false;
  return (
    <Btn
      onClick={() => event.id && toggleBookmark(event.id)}
      active={saved}
      label={saved ? "Saved — click to remove" : "Save"}
    >
      <Bookmark filled={saved} />
    </Btn>
  );
}

/**
 * Up/down voting via NIP-25 reactions ("+" / "-"). Switching sides or toggling
 * off retracts the prior reaction with a NIP-09 deletion, so a user's net vote
 * is always correct on the network — not two contradictory reactions. `baseline`
 * is the network's current net score; the control shows baseline + your vote.
 */
function useVote(event: NDKEvent, baseline: number) {
  const { user, login, canSign } = useNdk();
  // Read-only npub: identity attached but no signer. Voting calls event.react()
  // which needs to sign, so it would silently fail — disable it instead.
  const readOnly = !!user && !canSign;
  const [vote, setVote] = useState<0 | 1 | -1>(0);
  const [busy, setBusy] = useState(false);
  const last = useRef<NDKEvent | null>(null);

  const cast = async (dir: 1 | -1) => {
    if (!user) return login(); // logged out → funnel to the login modal
    if (readOnly || busy) return; // read-only can't sign; ignore the click
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

  return { vote, score: baseline + vote, readOnly, up: () => cast(1), down: () => cast(-1) };
}

/** Reddit-style ▲ score ▼ control. The heart is dead; long live the downvote. */
function VoteControl({ event, baseline = 0 }: { event: NDKEvent; baseline?: number }) {
  const { vote, score, readOnly, up, down } = useVote(event, baseline);
  // Read-only sessions see the score but greyed, non-interactive arrows.
  const arrowTip = readOnly ? "Log in with a signing key to vote" : undefined;
  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        aria-label="Upvote"
        aria-pressed={vote === 1}
        onClick={up}
        disabled={readOnly}
        title={arrowTip}
        className={`rounded p-1 transition-colors ${
          readOnly
            ? "cursor-not-allowed text-muted/40"
            : `hover:bg-panel-2 ${vote === 1 ? "text-accent" : "text-muted hover:text-text"}`
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
        disabled={readOnly}
        title={arrowTip}
        className={`rounded p-1 transition-colors ${
          readOnly
            ? "cursor-not-allowed text-muted/40"
            : `hover:bg-panel-2 ${vote === -1 ? "text-sky-400" : "text-muted hover:text-text"}`
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
      <BookmarkBtn event={event} />
      <Btn onClick={share} active={shared} label="Share">
        <Share />
        {shared && <span className="text-accent">copied</span>}
      </Btn>
    </div>
  );
}

/** Comment footer: vote ▲▼ · Reply · Expand · Save · Share. */
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
      <BookmarkBtn event={event} />
      <Btn onClick={share} active={shared} label="Share">
        <Share />
        <span>{shared ? "copied" : "Share"}</span>
      </Btn>
    </div>
  );
}
