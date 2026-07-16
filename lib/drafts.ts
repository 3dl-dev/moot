"use client";

/**
 * Composer draft persistence: keep unsent text in localStorage so navigating
 * away and back (or an accidental reload) doesn't lose what you were writing.
 * Each composer passes a stable key (e.g. `reply:<eventId>`, `community:<addr>`);
 * saving empty text removes the entry, so a cleared/sent composer leaves nothing
 * behind. SSR-safe (no-ops without `window`).
 */
const PREFIX = "moot.draft.";

export function getDraft(key: string): string {
  if (typeof window === "undefined" || !key) return "";
  try {
    return localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

/** Persist a draft, or remove it when the text is blank (so sent/emptied composers clear). */
export function saveDraft(key: string, value: string): void {
  if (typeof window === "undefined" || !key) return;
  try {
    if (value.trim()) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage full / blocked — a lost draft is non-fatal */
  }
}

export function clearDraft(key: string): void {
  if (typeof window === "undefined" || !key) return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
