"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useNdk } from "@/app/providers";
import { uploadToNip96 } from "@/lib/nostr";

/** Upload an image/video via NIP-96 and hand back the hosted URL. */
export function AttachButton({ onUploaded }: { onUploaded: (url: string) => void }) {
  const { ndk, user } = useNdk();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const pick = () => input.current?.click();
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadToNip96(ndk, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        aria-label="Attach image or video"
        className="meta inline-flex items-center gap-1 hover:text-text disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8" />
        </svg>
        {busy ? "uploading…" : "attach"}
      </button>
      {error && <span className="meta text-red-400">{error}</span>}
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        onChange={onFile}
        className="hidden"
      />
    </>
  );
}
