"use client";

import { useEffect, useMemo, useState } from "react";
import { useNdk } from "@/app/providers";
import { useLastRead, markRead, type Notification } from "@/lib/notifications";
import { useNotifications } from "@/lib/useNotifications";
import { imetaUrls, shareLink } from "@/lib/nostr";
import { CommentHeader, ContentBody, Foldable } from "./parts";

/**
 * The notifications panel: every reply to your notes and every @-mention of
 * your pubkey, newest first. Opening it advances the read watermark so the nav
 * badge clears; rows that were unread when you arrived keep a brass accent.
 */
export function Notifications() {
  const { user, connecting } = useNdk();
  const items = useNotifications(user?.pubkey);
  const liveLastRead = useLastRead(user?.pubkey);

  // Freeze the watermark at mount so newly-arriving/opened rows stay marked as
  // "new" for this visit, even as we advance the stored watermark below.
  const [seenAt] = useState(() => liveLastRead);

  // While the panel is open, keep the watermark at "now" so the badge stays
  // clear as replies stream in. markRead never moves backwards.
  useEffect(() => {
    if (user?.pubkey) markRead(user.pubkey, Math.floor(Date.now() / 1000));
  }, [user?.pubkey, items.length]);

  if (!user) {
    return (
      <div className="p-8 text-center text-sm text-muted">
        Log in to see replies and mentions.
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">notifications</span>
          <span className="meta">· replies &amp; mentions of you</span>
        </div>
      </div>

      {items.length === 0 && (
        <div className="p-8 text-center text-sm text-muted">
          {connecting ? "Connecting to relays…" : "No replies or mentions yet."}
        </div>
      )}

      {items.map((n) => (
        <NotificationRow key={n.event.id} n={n} unread={(n.event.created_at ?? 0) > seenAt} />
      ))}
    </div>
  );
}

function NotificationRow({ n, unread }: { n: Notification; unread: boolean }) {
  const imeta = useMemo(() => imetaUrls(n.event), [n.event]);
  return (
    <div
      className={`border-b border-border px-4 py-3 ${
        unread ? "bg-panel/40" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass" />}
        <CommentHeader event={n.event} />
        <span className="meta ml-auto shrink-0 rounded border border-border px-1.5 py-0.5">
          {n.kind === "reply" ? "replied" : "mentioned you"}
        </span>
      </div>
      <div className="mt-2 pl-7">
        <Foldable max={200}>
          <ContentBody text={n.event.content} imeta={imeta} />
        </Foldable>
        <a
          href={shareLink(n.event)}
          target="_blank"
          rel="noopener noreferrer"
          className="meta mt-1.5 inline-block hover:text-text"
        >
          view thread ›
        </a>
      </div>
    </div>
  );
}
