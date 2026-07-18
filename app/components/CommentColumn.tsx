"use client";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNdk } from "@/app/providers";
import {
  buildThread,
  fetchReplies,
  imetaUrls,
  pruneMutedThread,
  publishReply,
  subscribeReplies,
  type ThreadNode,
} from "@/lib/nostr";
import { isMuted, useMutes } from "@/lib/mute";
import { getThread, setThread } from "@/lib/threadcache";
import { CommentHeader, ContentBody, ReplyBox, ThreadSkeleton } from "./parts";
import { CommentActionBar } from "./PostActions";
import { useMod } from "./ModContext";

const TOP_PREVIEW = 3; // top-level comments shown before "Expand"

export function CommentColumn({
  root,
  active,
  onCount,
}: {
  root: NDKEvent;
  active: boolean;
  onCount?: (n: number) => void;
}) {
  const { ndk, canSign, login } = useNdk();
  const mod = useMod();
  const locked = !!root.id && !!mod?.state.locked.has(root.id); // advisory thread lock
  const mutes = useMutes(); // re-render + re-prune when the mute list changes
  const [tree, setTree] = useState<ThreadNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [replyingRoot, setReplyingRoot] = useState(false);
  const [busy, setBusy] = useState(false);

  // Manual one-shot refresh (used after posting a reply). Streaming below is the
  // primary path; this just re-pulls once and updates the cache + tree.
  const load = useCallback(async () => {
    if (!root.id) return;
    const events = await fetchReplies(ndk, root.id);
    setThread(root.id, events);
    setTree(buildThread(events, root.id));
    setLoaded(true);
  }, [ndk, root.id]);

  // When the row scrolls near the viewport, paint any cached thread instantly,
  // then stream replies in progressively so the first ones show in ~200ms
  // instead of blocking on EOSE. Reads BOTH conventions (see subscribeReplies).
  useEffect(() => {
    if (!active || !root.id) return;
    const rootId = root.id;
    const cached = getThread(rootId);
    if (cached) {
      setTree(buildThread(cached, rootId));
      setLoaded(true);
    } else {
      setLoading(true);
    }
    const stop = subscribeReplies(ndk, rootId, (events) => {
      setThread(rootId, events);
      setTree(buildThread(events, rootId));
      setLoaded(true);
      setLoading(false);
    });
    return stop;
  }, [active, ndk, root.id]);

  const replyToRoot = async (text: string) => {
    setBusy(true);
    try {
      await publishReply(ndk, { root, parent: root, content: text });
      setReplyingRoot(false);
      setTimeout(load, 800);
    } finally {
      setBusy(false);
    }
  };

  // Hide muted authors (and their subtrees) from the rendered thread. Derived so
  // muting/unmuting reflects instantly without refetching. `mutes` is a dep so the
  // memo recomputes when the list changes (isMuted reads the same store).
  const shownTree = useMemo(() => pruneMutedThread(tree, isMuted), [tree, mutes]);
  const count = useMemo(() => countNodes(shownTree), [shownTree]);

  // Report the visible count to the parent, kept in sync as mutes change.
  useEffect(() => {
    onCount?.(count);
  }, [count, onCount]);

  const visible = showAll ? shownTree : shownTree.slice(0, TOP_PREVIEW);
  const hidden = shownTree.length - visible.length;

  return (
    <div className="flex flex-col rounded-md border border-border border-l-2 border-l-brass/40 bg-panel/40 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">the record</span>
          <span className="meta">· sorted by likes</span>
        </div>
        {canSign && !locked && (
          <button
            type="button"
            onClick={() => setReplyingRoot((v) => !v)}
            className="meta hover:text-text"
          >
            {replyingRoot ? "cancel" : "reply"}
          </button>
        )}
      </div>

      {locked && (
        <div className="mb-2 rounded border border-brass/40 bg-brass/5 px-2 py-1.5 text-[11px] text-muted">
          🔒 A moderator locked this thread. moot honors the lock and disables
          replies here; a permissionless network can’t enforce it, so other
          clients may still allow replies.
        </div>
      )}

      {replyingRoot && !locked && (
        <div className="mb-2">
          <ReplyBox placeholder="Add a reply…" busy={busy} autoFocus onSubmit={replyToRoot} draftKey={`reply:${root.id}`} />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {!loaded && (loading || active) && <ThreadSkeleton />}
        {loaded && tree.length === 0 && !replyingRoot && (
          locked ? (
            <p className="py-2 text-xs text-muted">No replies — thread locked.</p>
          ) : (
            // An empty thread is an invitation, not a tombstone. Turn the dead
            // "No replies yet." into an open-mic call so a quiet firehose feels
            // joinable instead of abandoned (the ghost-town antidote).
            <button
              type="button"
              onClick={() => (canSign ? setReplyingRoot(true) : login())}
              className="flex w-full flex-col items-center gap-0.5 rounded-md border border-dashed border-brass/30 px-3 py-4 text-center transition-colors hover:border-brass/60 hover:bg-brass/5"
            >
              <span className="text-base leading-none">💬</span>
              <span className="text-xs font-medium text-text">Quiet in here — be the first</span>
              <span className="meta">{canSign ? "Start the discussion →" : "Log in to weigh in →"}</span>
            </button>
          )
        )}
        {visible.map((node) => (
          <CommentNode key={node.event.id} node={node} root={root} depth={0} onReplied={load} />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-1 w-full rounded border border-border py-1 text-xs text-muted hover:text-text"
          >
            Expand ⌄ {hidden} more
          </button>
        )}
      </div>
    </div>
  );
}

function CommentNode({
  node,
  root,
  depth,
  onReplied,
}: {
  node: ThreadNode;
  root: NDKEvent;
  depth: number;
  onReplied: () => void;
}) {
  const { ndk, canSign } = useNdk();
  const mod = useMod();
  const locked = !!root.id && !!mod?.state.locked.has(root.id);
  const [expanded, setExpanded] = useState(true);
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasChildren = node.children.length > 0;

  const submit = async (text: string) => {
    setBusy(true);
    try {
      await publishReply(ndk, { root, parent: node.event, content: text });
      setReplying(false);
      setTimeout(onReplied, 800);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={depth > 0 ? "ml-2 border-l border-border pl-2.5" : ""}>
      <div className="py-1.5">
        <CommentHeader event={node.event} />
        <div className="mt-1">
          <ContentBody text={node.event.content} imeta={imetaUrls(node.event)} />
        </div>
        <div className="mt-1">
          <CommentActionBar
            event={node.event}
            onReply={canSign && !locked ? () => setReplying((v) => !v) : undefined}
            onToggle={() => setExpanded((v) => !v)}
            expanded={expanded}
            canToggle={hasChildren}
          />
        </div>
        {replying && (
          <div className="mt-1.5">
            <ReplyBox placeholder="Reply…" busy={busy} autoFocus onSubmit={submit} draftKey={`reply:${node.event.id}`} />
          </div>
        )}
      </div>
      {expanded &&
        node.children.map((child) => (
          <CommentNode
            key={child.event.id}
            node={child}
            root={root}
            depth={depth + 1}
            onReplied={onReplied}
          />
        ))}
    </div>
  );
}

function countNodes(nodes: ThreadNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}
