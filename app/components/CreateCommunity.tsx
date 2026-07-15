"use client";

import { useState } from "react";
import { useNdk } from "@/app/providers";
import { publishCommunity, slugify, type Community } from "@/lib/nostr";
import { AttachButton } from "./AttachButton";

export function CreateCommunity({
  onCreated,
  onCancel,
}: {
  onCreated: (c: Community) => void;
  onCancel: () => void;
}) {
  const { ndk, user } = useNdk();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      const c = await publishCommunity(ndk, {
        name: n,
        description: description.trim(),
        image: image.trim() || undefined,
      });
      onCreated(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create community.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg p-4">
      <button type="button" onClick={onCancel} className="meta mb-3 hover:text-text">
        ‹ all communities
      </button>
      <div className="eyebrow mb-1">new community</div>
      <p className="mb-4 text-sm text-muted">
        You’ll be its first moderator. It publishes as a NIP-72 event, so it shows up in every
        Nostr client — not just moot.
      </p>

      {!user && (
        <p className="rounded-md border border-border bg-panel p-3 text-sm text-muted">
          Log in to create a community.
        </p>
      )}

      {user && (
        <div className="space-y-3">
          <label className="block">
            <span className="meta">name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bitcoin builders"
              className="mt-1 w-full rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brass/40 focus:outline-none"
            />
            {name.trim() && (
              <span className="meta mt-1 block">
                /c/{slugify(name) || "…"}
              </span>
            )}
          </label>
          <label className="block">
            <span className="meta">description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What is this community for?"
              className="mt-1 w-full resize-y rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brass/40 focus:outline-none"
            />
          </label>
          <label className="block">
            <div className="flex items-center justify-between">
              <span className="meta">image (optional)</span>
              <AttachButton onUploaded={setImage} />
            </div>
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://…  or attach"
              className="mt-1 w-full rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brass/40 focus:outline-none"
            />
            {image.trim() && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                className="mt-2 h-20 w-20 rounded-md border border-border object-cover"
              />
            )}
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-black transition-opacity disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create community"}
          </button>
        </div>
      )}
    </div>
  );
}
