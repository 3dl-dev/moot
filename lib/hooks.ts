"use client";

import { useEffect, useRef, useState } from "react";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import { getNdk } from "@/lib/ndk";

// Module-level cache so avatars/names don't refetch as you scroll.
const cache = new Map<string, NDKUserProfile>();

/** Lazily fetch and cache a user's kind:0 profile. */
export function useProfile(pubkey?: string): NDKUserProfile | null {
  const [profile, setProfile] = useState<NDKUserProfile | null>(
    pubkey ? cache.get(pubkey) ?? null : null
  );

  useEffect(() => {
    if (!pubkey) return;
    const cached = cache.get(pubkey);
    if (cached) {
      setProfile(cached);
      return;
    }
    let alive = true;
    getNdk()
      .getUser({ pubkey })
      .fetchProfile()
      .then((p) => {
        if (p) cache.set(pubkey, p);
        if (alive) setProfile(p ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pubkey]);

  return profile;
}

/** Display name for a pubkey, falling back to a short hex. */
export function displayName(pubkey: string, profile?: NDKUserProfile | null): string {
  return (
    profile?.displayName ||
    profile?.name ||
    `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
  );
}

/** Short @handle: NIP-05 local part, else short hex. */
export function handle(pubkey: string, profile?: NDKUserProfile | null): string {
  const nip05 = profile?.nip05;
  if (nip05) return `@${nip05.split("@")[0]}`;
  return `@${pubkey.slice(0, 10)}`;
}

/**
 * Fire `true` once when the element scrolls near the viewport, then stop
 * observing. Used to lazily fetch each post's comment thread only when needed.
 */
export function useInView<T extends Element>(
  rootMargin = "300px"
): readonly [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView] as const;
}
