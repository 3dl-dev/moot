"use client";

import { useState, type ReactNode } from "react";
import { useNdk } from "@/app/providers";
import { nip19 } from "nostr-tools";
import { useShowNsfw, setShowNsfw } from "@/lib/nsfw";
import { usePrefs, setPref, type Prefs } from "@/lib/prefs";
import { POW_LEVELS } from "@/lib/pow";
import { importMuteListFrom } from "@/lib/mutesync";

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

/** Segmented Off / N-bit selector for the minimum-PoW feed filter. */
function MinPowSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">Minimum proof-of-work</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Require NIP-13 proof-of-work on notes in your feeds — spammers rarely pay to mint it, so a
          bar drops the cheap firehose. Higher = stricter (and fewer posts).
        </p>
      </div>
      <div className="flex shrink-0 rounded-md border border-border p-0.5">
        {POW_LEVELS.map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => onChange(lvl)}
            aria-pressed={value === lvl}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              value === lvl ? "bg-panel-2 text-brass" : "text-muted hover:text-text"
            }`}
          >
            {lvl === 0 ? "Off" : `${lvl}-bit`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Resolve an npub / nprofile / hex pubkey to a 32-byte hex pubkey, or null. */
function resolvePubkey(raw: string): string | null {
  const t = raw.trim().replace(/^nostr:/, "");
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase();
  try {
    const dec = nip19.decode(t);
    if (dec.type === "npub") return dec.data as string;
    if (dec.type === "nprofile") return (dec.data as { pubkey: string }).pubkey;
  } catch {
    /* not a NIP-19 entity */
  }
  return null;
}

/**
 * Import someone else's public NIP-51 mute list into your local filter
 * (delegated trust — "score the messenger" outsourced to a curator you pick).
 */
function ImportBlockList() {
  const { ndk } = useNdk();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = async () => {
    const pubkey = resolvePubkey(input);
    if (!pubkey) {
      setStatus("Enter a valid npub or hex pubkey.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const { added, found } = await importMuteListFrom(ndk, pubkey);
      if (!found) setStatus("No public mute list found for that account.");
      else if (added === 0) setStatus("Already imported — nothing new to add.");
      else setStatus(`Imported ${added} new block${added === 1 ? "" : "s"} into your filter.`);
      if (found) setInput("");
    } catch {
      setStatus("Couldn’t reach the relays. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-border py-3">
      <div className="text-sm font-medium text-text">Import a block list</div>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        Paste an npub whose public mute list you trust — their blocked accounts, words and
        communities merge into your local filter. Only their public entries are readable. If
        you&rsquo;re logged in, these entries also join your own published mute list.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && run()}
          placeholder="npub1… or hex pubkey"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-muted focus:border-brass/50"
        />
        <button
          type="button"
          onClick={run}
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      {status && <p className="mt-2 text-xs text-brass">{status}</p>}
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

      <h2 className="mb-2 mt-8 text-base font-semibold text-text">Anti-spam</h2>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        moot scores the messenger, not the message. These filters raise the cost of reaching your
        feeds without any content classifier.
      </p>
      <div className="rounded-md border border-border px-4">
        <MinPowSelector value={prefs.minPow} onChange={set("minPow")} />
        <ImportBlockList />
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
