"use client";

import { useEffect, useState } from "react";
import { useNdk } from "@/app/providers";
import { discoverDvmFeeds, type DvmProvider } from "@/lib/dvm";

export function DvmDirectory({ onOpen }: { onOpen: (p: DvmProvider) => void }) {
  const { ndk } = useNdk();
  const [items, setItems] = useState<DvmProvider[] | null>(null);

  useEffect(() => {
    let alive = true;
    discoverDvmFeeds(ndk).then((p) => alive && setItems(p));
    return () => {
      alive = false;
    };
  }, [ndk]);

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4">
        <div className="eyebrow">explore · feed providers</div>
        <p className="mt-0.5 text-sm text-muted">
          Feeds computed by independent providers (NIP-90 DVMs). moot reads their latest ranked
          result — pick any algorithm, no lock-in. Log in to request a fresh, personalized run.
          moot’s own Explore blends these into one discovery feed.
        </p>
      </div>

      {items === null && (
        <p className="p-6 text-center text-sm text-muted">Discovering feed providers…</p>
      )}
      {items?.length === 0 && (
        <p className="p-6 text-center text-sm text-muted">
          No content-discovery DVMs announced on these relays right now.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items?.map((p) => (
          <button
            key={p.pubkey + p.d}
            type="button"
            onClick={() => onOpen(p)}
            className="flex gap-3 rounded-md border border-border bg-panel p-3 text-left transition-colors hover:border-brass/40"
          >
            <Avatar provider={p} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text">{p.name}</div>
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">
                {p.about || "Algorithmic feed."}
              </p>
              <div className="meta mt-1.5">NIP-90 · kind 5300</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Avatar({ provider, size = 44 }: { provider: DvmProvider; size?: number }) {
  const hue = parseInt(provider.pubkey.slice(0, 6), 16) % 360;
  if (provider.picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={provider.picture}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-md object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, background: `hsl(${hue} 40% 40%)` }}
      className="flex shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white/90"
    >
      {provider.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
