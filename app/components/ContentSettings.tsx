"use client";

import { useShowNsfw, setShowNsfw } from "@/lib/nsfw";

/**
 * The sensitive-content (18+) preference, on its own page. Off by default and
 * everywhere; enabling it is a deliberate act on a page that states the 18+
 * requirement — not a stray click in the sidebar.
 */
export function ContentSettings() {
  const showNsfw = useShowNsfw();
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
    </div>
  );
}
