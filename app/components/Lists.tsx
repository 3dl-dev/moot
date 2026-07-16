"use client";

import { useMemo, useState } from "react";
import { isTopLevelNote, publishNote } from "@/lib/nostr";
import { createList, parseMembers, useLists, type UserList } from "@/lib/lists";
import type { View } from "@/lib/nav";
import { Feed } from "./Feed";

/** A named list as a feed: the left column scoped to the list's members. */
export function ListFeed({ id, onManage }: { id: string; onManage: () => void }) {
  const lists = useLists();
  const list = lists.find((l) => l.id === id);

  if (!list) {
    return (
      <div className="p-8 text-center text-sm text-muted">
        This list no longer exists.{" "}
        <button type="button" onClick={onManage} className="text-accent hover:underline">
          Make a new one
        </button>
        .
      </div>
    );
  }

  if (list.pubkeys.length === 0) {
    return (
      <div className="min-w-0 flex-1">
        <ListHeader list={list} />
        <div className="p-8 text-center text-sm text-muted">
          This list has no members yet.
        </div>
      </div>
    );
  }

  return (
    <Feed
      // Relays cap author lists; 500 covers all but the largest lists.
      filters={{ kinds: [1], authors: list.pubkeys.slice(0, 500), limit: 100 }}
      accept={isTopLevelNote}
      publish={(ndk, text) => publishNote(ndk, text)}
      toolbarLabel={`${list.title} · ${list.pubkeys.length} member${list.pubkeys.length === 1 ? "" : "s"}`}
      composerPlaceholder="Post to Nostr…"
      draftKey={`list:${id}`}
    />
  );
}

function ListHeader({ list }: { list: UserList }) {
  return (
    <div className="border-b border-border px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">{list.title}</span>
        <span className="meta">· {list.pubkeys.length} members</span>
      </div>
    </div>
  );
}

/** New-list editor: a title and a set of npubs/hex pubkeys. */
export function CreateList({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState("");
  const parsed = useMemo(() => parseMembers(members), [members]);
  const canCreate = title.trim().length > 0 && parsed.length > 0;

  const submit = () => {
    if (!canCreate) return;
    const list = createList(title, parsed);
    onNavigate({ kind: "list", id: list.id });
  };

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <button
        type="button"
        onClick={() => onNavigate({ kind: "home" })}
        className="meta mb-3 hover:text-text"
      >
        ‹ back
      </button>
      <div className="eyebrow mb-1">new list</div>
      <p className="mb-4 text-sm text-muted">
        A private, device-local list of people. Once you&rsquo;re logged in it syncs to your
        NIP-51 kind:30000 so it follows you across clients.
      </p>

      <label className="block">
        <span className="meta">name</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Bitcoin builders"
          className="mt-1 w-full rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brass/40 focus:outline-none"
        />
      </label>

      <label className="mt-3 block">
        <span className="meta">members — npubs or hex, separated by spaces/commas/newlines</span>
        <textarea
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          placeholder="npub1…&#10;npub1…&#10;npub1…"
          rows={5}
          className="mt-1 w-full resize-y rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brass/40 focus:outline-none"
        />
      </label>
      <p className="mt-1 text-xs text-muted">
        {parsed.length} valid member{parsed.length === 1 ? "" : "s"} recognised.
      </p>

      <button
        type="button"
        onClick={submit}
        disabled={!canCreate}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-black transition-opacity disabled:opacity-40"
      >
        Create list
      </button>
    </div>
  );
}
