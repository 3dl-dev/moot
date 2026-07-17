"use client";

import { useState } from "react";
import { useNdk } from "@/app/providers";
import { updateCommunity, type Community } from "@/lib/nostr";
import { toHexPubkey } from "@/lib/lists";
import { nip19 } from "nostr-tools";

/** Short npub for display, e.g. npub1abc…wxyz. */
function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

/**
 * Owner-only community settings: edit name/description and manage the moderator
 * set. Republishes the addressable kind:34550 definition (only the owner can —
 * a non-owner republish would fork the community). The owner is always an
 * implicit moderator and can't be removed here.
 */
export function ManageCommunity({
  community,
  onSaved,
  onClose,
}: {
  community: Community;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { ndk } = useNdk();
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description);
  // Moderators other than the owner (the owner is implicit and always a mod).
  const [mods, setMods] = useState<string[]>(community.moderators.filter((m) => m !== community.author));
  const [newMod, setNewMod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMod = () => {
    const hex = toHexPubkey(newMod);
    if (!hex) {
      setError("Enter a valid npub or hex pubkey.");
      return;
    }
    if (hex === community.author || mods.includes(hex)) {
      setError("Already a moderator.");
      return;
    }
    setMods((cur) => [...cur, hex]);
    setNewMod("");
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Owner stays first in the moderator set.
      await updateCommunity(ndk, community, {
        name: name.trim() || community.name,
        description: description.trim(),
        moderators: [community.author, ...mods],
      });
      onSaved();
      onClose();
    } catch {
      setError("Couldn’t publish the update. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded border border-border bg-panel px-2.5 py-1.5 text-sm text-text outline-none focus:border-brass";

  return (
    <div className="space-y-3 border-b border-border bg-panel/40 p-4">
      <h2 className="wordmark text-sm font-semibold text-text">Manage community</h2>

      <label className="block space-y-1">
        <span className="meta">Name</span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>

      <label className="block space-y-1">
        <span className="meta">Description</span>
        <textarea
          className={`${field} min-h-[3rem] resize-y`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </label>

      <div className="space-y-1.5">
        <span className="meta">Moderators</span>
        <ul className="space-y-1">
          <li className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
            <span className="text-text">{shortNpub(community.author)}</span>
            <span className="meta">owner</span>
          </li>
          {mods.map((m) => (
            <li key={m} className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
              <span className="text-text">{shortNpub(m)}</span>
              <button
                type="button"
                onClick={() => setMods((cur) => cur.filter((x) => x !== m))}
                className="meta hover:text-red-400"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1.5">
          <input
            className={field}
            value={newMod}
            onChange={(e) => setNewMod(e.target.value)}
            placeholder="Add moderator by npub or hex"
            onKeyDown={(e) => e.key === "Enter" && addMod()}
          />
          <button type="button" onClick={addMod} className="rounded border border-border px-2.5 py-1.5 text-xs text-muted hover:text-text">
            add
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose} className="meta hover:text-text">
          cancel
        </button>
      </div>
    </div>
  );
}
