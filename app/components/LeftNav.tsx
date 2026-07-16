"use client";

import { useState, type ReactNode } from "react";
import type { View } from "@/lib/nav";
import { useMutes, muteWord, unmuteWord, clearMutes } from "@/lib/mute";
import { useShowNsfw } from "@/lib/nsfw";
import { useNdk } from "@/app/providers";
import { useLastRead, unreadCount } from "@/lib/notifications";
import { useNotifications } from "@/lib/useNotifications";

/* Clean inline icons (stroke, 16px) — no glyph-font guesswork. */
const I = {
  all: <path d="M4 6h16M4 12h16M4 18h16" />,
  home: <path d="M4 11l8-7 8 7M6 10v9h12v-9" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" />
    </>
  ),
  communities: (
    <>
      <path d="M3 21V9l6-4 6 4M15 21V9l6 4v8" />
      <path d="M3 21h18M9 21v-5h3v5" />
    </>
  ),
  topics: <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />,
  saved: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  explore: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
};

export function LeftNav({
  current,
  onNavigate,
}: {
  current: View;
  onNavigate: (v: View) => void;
}) {
  const mutes = useMutes();
  const showNsfw = useShowNsfw();
  const { user } = useNdk();
  const notifs = useNotifications(user?.pubkey);
  const lastRead = useLastRead(user?.pubkey);
  const unread = unreadCount(notifs, lastRead);
  const [word, setWord] = useState("");
  const items: {
    label: string;
    icon: ReactNode;
    view?: View;
    activeKinds: View["kind"][];
    badge?: number;
  }[] = [
    { label: "Home", icon: I.home, view: { kind: "home" }, activeKinds: ["home"] },
    { label: "Topics", icon: I.topics, view: { kind: "topics" }, activeKinds: ["topics", "topic"] },
    { label: "Following", icon: I.people, view: { kind: "following" }, activeKinds: ["following"] },
    ...(user
      ? [
          {
            label: "Notifications",
            icon: I.bell,
            view: { kind: "notifications" } as View,
            activeKinds: ["notifications"] as View["kind"][],
            badge: unread,
          },
        ]
      : []),
    { label: "Saved", icon: I.saved, view: { kind: "saved" }, activeKinds: ["saved"] },
    { label: "All", icon: I.all, view: { kind: "feed" }, activeKinds: ["feed"] },
    {
      label: "Communities",
      icon: I.communities,
      view: { kind: "communities" },
      activeKinds: ["communities", "community", "create-community"],
    },
    {
      label: "Explore",
      icon: I.explore,
      view: { kind: "discover" },
      activeKinds: ["discover", "dvm"],
    },
    { label: "About", icon: I.about, activeKinds: [] },
  ];

  return (
    <nav className="hidden w-52 shrink-0 border-r border-border p-3 md:block">
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = item.activeKinds.includes(current.kind);
          return (
            <li key={item.label} className="relative">
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brass" />
              )}
              <button
                type="button"
                disabled={!item.view}
                onClick={() => item.view && onNavigate(item.view)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] transition-colors ${
                  active
                    ? "bg-panel-2 font-medium text-text"
                    : item.view
                      ? "text-muted hover:bg-panel hover:text-text"
                      : "cursor-default text-muted/40"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={active ? "text-brass" : ""}
                >
                  {item.icon}
                </svg>
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge ? (
                  <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-brass px-1 text-[0.6875rem] font-semibold leading-none text-black">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 rounded-md border border-border p-3">
        <div className="eyebrow mb-1.5">Communities</div>
        <p className="mb-2 text-xs leading-relaxed text-muted">
          User-run, moderated on NIP-72 — federated across every Nostr client.
        </p>
        <button
          type="button"
          onClick={() => onNavigate({ kind: "communities" })}
          className="meta hover:text-text"
        >
          browse all ›
        </button>
      </div>

      <button
        type="button"
        onClick={() => onNavigate({ kind: "settings" })}
        className={`mt-4 flex w-full items-center justify-between rounded-md border border-border p-3 text-left transition-colors ${
          current.kind === "settings" ? "bg-panel-2" : "hover:bg-panel"
        }`}
      >
        <div className="min-w-0">
          <div className="eyebrow">Sensitive content</div>
          <p className="text-xs leading-relaxed text-muted">
            {showNsfw ? "shown · 18+" : "hidden · 18+ to enable"}
          </p>
        </div>
        <span className="meta">›</span>
      </button>

      <div className="mt-4 rounded-md border border-border p-3">
        <div className="eyebrow mb-1.5">Muted</div>
        <p className="mb-2 text-xs leading-relaxed text-muted">
          {mutes.pubkeys.length} account{mutes.pubkeys.length === 1 ? "" : "s"},{" "}
          {mutes.words.length} word{mutes.words.length === 1 ? "" : "s"} — local, no login.
        </p>
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              muteWord(word);
              setWord("");
            }
          }}
          placeholder="mute a word…"
          className="w-full rounded border border-border bg-panel-2 px-2 py-1 text-xs text-text placeholder:text-muted focus:border-brass/40 focus:outline-none"
        />
        {mutes.words.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {mutes.words.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => unmuteWord(w)}
                title="Unmute"
                className="meta rounded border border-border px-1.5 py-0.5 hover:border-red-400/50 hover:text-text"
              >
                {w} ✕
              </button>
            ))}
          </div>
        )}
        {(mutes.pubkeys.length > 0 || mutes.words.length > 0) && (
          <button type="button" onClick={clearMutes} className="meta mt-2 hover:text-text">
            clear all
          </button>
        )}
      </div>
    </nav>
  );
}
