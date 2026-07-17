"use client";

import { useEffect, useRef, useState } from "react";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import { getNdk } from "@/lib/ndk";
import { fetchCommunitiesByAddr, fetchFollows, fetchProfilesFor } from "@/lib/nostr";
import type { MentionCandidate } from "@/lib/mentions";

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

// Cache community display names by coordinate so inline naddr refs resolve once.
const communityNameCache = new Map<string, string>();

/**
 * Resolve a `34550:<pubkey>:<d>` community coordinate to its display name (for
 * inline naddr refs). Null until fetched; cached module-wide. Falls back to the
 * `d` identifier so a ref never renders blank.
 */
export function useCommunityName(addr?: string): string | null {
  const [name, setName] = useState<string | null>(addr ? communityNameCache.get(addr) ?? null : null);

  useEffect(() => {
    if (!addr) return;
    const cached = communityNameCache.get(addr);
    if (cached) {
      setName(cached);
      return;
    }
    let alive = true;
    fetchCommunitiesByAddr(getNdk(), [addr])
      .then((cs) => {
        const resolved = cs[0]?.name || addr.split(":").slice(2).join(":") || null;
        if (resolved) communityNameCache.set(addr, resolved);
        if (alive) setName(resolved);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [addr]);

  return name;
}

// Module-level cache of a user's mention candidates (follows + profiles), so the
// composer dropdown is instant after the first fetch and doesn't refetch per box.
const contactsCache = new Map<string, MentionCandidate[]>();

/**
 * The current user's @-mentionable contacts: their NIP-02 follows named via a
 * batched kind:0 profile fetch (see fetchProfilesFor), sorted alphabetically.
 * Fetched once per session per user and cached module-wide. Returns [] until
 * loaded or when logged out. Powers compose-time @mention autocomplete.
 */
export function useContacts(self?: string): MentionCandidate[] {
  const [contacts, setContacts] = useState<MentionCandidate[]>(() =>
    self ? contactsCache.get(self) ?? [] : []
  );

  useEffect(() => {
    if (!self) {
      setContacts([]);
      return;
    }
    const cached = contactsCache.get(self);
    if (cached) {
      setContacts(cached);
      return;
    }
    let alive = true;
    (async () => {
      const ndk = getNdk();
      const follows = await fetchFollows(ndk, self);
      const profiles = follows.length ? await fetchProfilesFor(ndk, follows) : new Map();
      const list: MentionCandidate[] = follows
        .map((pubkey) => {
          const p = profiles.get(pubkey);
          return { pubkey, name: p?.name ?? "", nip05: p?.nip05 };
        })
        .filter((c) => c.name || c.nip05)
        .sort((a, b) => a.name.localeCompare(b.name));
      contactsCache.set(self, list);
      if (alive) setContacts(list);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [self]);

  return contacts;
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
