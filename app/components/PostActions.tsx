"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useState, type ReactNode } from "react";
import { useNdk } from "@/app/providers";
import { shareLink } from "@/lib/nostr";

/* Inline icons */
const Heart = ({ fill }: { fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
    <path d="M12 21s-7.5-4.6-10-9.3C.6 8.8 2.2 5.5 5.5 5.5c2 0 3.3 1.2 4.5 2.8 1.2-1.6 2.5-2.8 4.5-2.8 3.3 0 4.9 3.3 3.5 6.2C19.5 16.4 12 21 12 21z" />
  </svg>
);
const Bubble = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" />
  </svg>
);
const Expand = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
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

/** Like/share logic shared by post and comment bars. */
function useReact(event: NDKEvent) {
  const { user, login } = useNdk();
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [shared, setShared] = useState(false);

  const like = async () => {
    if (!user) return login();
    if (liked) return;
    try {
      await event.react("+");
      setLiked(true);
      setLikes((n) => n + 1);
    } catch {
      /* relay rejected / cancelled */
    }
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareLink(event));
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return { liked, likes, shared, like, share };
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

/** Post footer: heart+count · bubble+count · expand, share on the right. */
export function PostActionBar({
  event,
  replyCount,
  onExpand,
}: {
  event: NDKEvent;
  replyCount?: number;
  onExpand?: () => void;
}) {
  const { liked, likes, shared, like, share } = useReact(event);
  return (
    <div className="flex items-center text-muted">
      <Btn onClick={like} active={liked} label="Like">
        <Heart fill={liked} />
        {likes > 0 && <span className="meta text-inherit">{likes}</span>}
      </Btn>
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

/** Comment footer: labeled Like / Reply / Expand / Share. */
export function CommentActionBar({
  event,
  onReply,
  onToggle,
  expanded,
  canToggle,
}: {
  event: NDKEvent;
  onReply?: () => void;
  onToggle?: () => void;
  expanded?: boolean;
  canToggle?: boolean;
}) {
  const { liked, likes, shared, like, share } = useReact(event);
  return (
    <div className="flex items-center gap-1 text-muted">
      <Btn onClick={like} active={liked} label="Like">
        <Heart fill={liked} />
        <span>Like{likes > 0 ? ` ${likes}` : ""}</span>
      </Btn>
      <Btn onClick={onReply} label="Reply">
        <Bubble />
        <span>Reply</span>
      </Btn>
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
