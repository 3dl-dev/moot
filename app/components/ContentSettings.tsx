"use client";

import type { ReactNode } from "react";
import { useShowNsfw, setShowNsfw } from "@/lib/nsfw";
import { usePrefs, setPref, type Prefs } from "@/lib/prefs";

/** A labelled on/off switch row, reused across settings. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-panel-2 ring-1 ring-inset ring-border"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * The sensitive-content (18+) preference, on its own page. Off by default and
 * everywhere; enabling it is a deliberate act on a page that states the 18+
 * requirement — not a stray click in the sidebar.
 */
export function ContentSettings() {
  const showNsfw = useShowNsfw();
  const prefs = usePrefs();
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPref(k, v);
  return (
    <div className="mx-auto max-w-lg p-6 sm:p-8">
      <div className="eyebrow mb-1">settings</div>
      <h2 className="mb-2 text-base font-semibold text-text">Sensitive content</h2>
      <p className="text-sm leading-relaxed text-muted">
        moot keeps NSFW and other sensitive content{" "}
        <span className="text-text">off every default feed</span> — it&rsquo;s here for those who seek
        it and invisible to everyone else. Even when shown, each flagged post stays blurred until you
        tap to reveal it.
      </p>

      <div className="mt-6 rounded-md border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">Show sensitive content</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              You must be <span className="text-text">18 or older</span>. Turning this on confirms you
              are 18+.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showNsfw}
            aria-label="Show sensitive content"
            onClick={() => setShowNsfw(!showNsfw)}
            className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
              showNsfw ? "bg-accent" : "bg-panel-2 ring-1 ring-inset ring-border"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                showNsfw ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <p className={`mt-3 text-xs ${showNsfw ? "text-brass" : "text-muted"}`}>
          {showNsfw
            ? "On — sensitive content can appear in your feeds, blurred until revealed."
            : "Off — sensitive content is hidden everywhere."}
        </p>
      </div>

      <h2 className="mb-2 mt-8 text-base font-semibold text-text">Reading</h2>
      <div className="rounded-md border border-border px-4">
        <ToggleRow
          label="Compact mode"
          description="Denser rows — more posts on screen, less padding."
          checked={prefs.compact}
          onChange={set("compact")}
        />
        <ToggleRow
          label="Live scroll"
          description="New posts stream in as they arrive instead of waiting behind a “N new posts” pill."
          checked={prefs.liveScroll}
          onChange={set("liveScroll")}
        />
      </div>

      <h2 className="mb-2 mt-8 text-base font-semibold text-text">Notifications</h2>
      <div className="rounded-md border border-border px-4">
        <ToggleRow
          label="Replies"
          description="Show replies to your posts and comments."
          checked={prefs.notifReplies}
          onChange={set("notifReplies")}
        />
        <ToggleRow
          label="Mentions"
          description="Show posts that @-mention you."
          checked={prefs.notifMentions}
          onChange={set("notifMentions")}
        />
      </div>
    </div>
  );
}
