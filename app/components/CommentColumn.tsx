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
  type ThreadNode,
} from "@/lib/nostr";
import { isMuted, useMutes } from "@/lib/mute";
import { CommentHeader, ContentBody, ReplyBox } from "./parts";
import { CommentActionBar } from "./PostActions";

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
  const { ndk, canSign } = useNdk();
  const mutes = useMutes(); // re-render + re-prune when the mute list changes
  const [tree, setTree] = useState<ThreadNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [replyingRoot, setReplyingRoot] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!root.id) return;
    setLoading(true);
    try {
      // Reads BOTH conventions (NIP-10 kind:1 + NIP-22 kind:1111) with a
      // hard time cap so the column never hangs on a silent relay.
      const events = await fetchReplies(ndk, root.id);
      setTree(buildThread(events, root.id));
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [ndk, root.id]);

  // Fetch once, when the row scrolls near the viewport.
  useEffect(() => {
    if (active && !loaded && !loading) load();
  }, [active, loaded, loading, load]);

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
        {canSign && (
          <button
            type="button"
            onClick={() => setReplyingRoot((v) => !v)}
            className="meta hover:text-text"
          >
            {replyingRoot ? "cancel" : "reply"}
          </button>
        )}
      </div>

      {replyingRoot && (
        <div className="mb-2">
          <ReplyBox placeholder="Add a reply…" busy={busy} autoFocus onSubmit={replyToRoot} />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {!loaded && (loading || active) && (
          <p className="py-2 text-xs text-muted">Loading replies…</p>
        )}
        {loaded && tree.length === 0 && (
          <p className="py-2 text-xs text-muted">No replies yet.</p>
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
            onReply={canSign ? () => setReplying((v) => !v) : undefined}
            onToggle={() => setExpanded((v) => !v)}
            expanded={expanded}
            canToggle={hasChildren}
          />
        </div>
        {replying && (
          <div className="mt-1.5">
            <ReplyBox placeholder="Reply…" busy={busy} autoFocus onSubmit={submit} />
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
