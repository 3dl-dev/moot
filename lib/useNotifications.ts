"use client";

import { useEffect, useState } from "react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { getNdk } from "./ndk";
import { isMuted } from "./mute";
import {
  notificationFilters,
  classifyNotification,
  type Notification,
} from "./notifications";

/**
 * Live, classified, mute-filtered notifications for `pubkey`, newest first.
 * Backs both the nav badge (its unread count) and the notifications panel.
 * Identical subscriptions are grouped by NDK, so mounting this in two places
 * costs one relay subscription.
 *
 * Lives apart from lib/notifications.ts (which stays import-free for the Node
 * test runner) because it pulls in the NDK singleton and the mute store.
 */
export function useNotifications(pubkey?: string): Notification[] {
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    if (!pubkey) {
      setItems([]);
      return;
    }
    const map = new Map<string, NDKEvent>();
    const flush = () => {
      const list: Notification[] = [];
      for (const ev of map.values()) {
        const kind = classifyNotification(ev, pubkey);
        if (!kind || isMuted(ev)) continue;
        list.push({ event: ev, kind });
      }
      list.sort((a, b) => (b.event.created_at ?? 0) - (a.event.created_at ?? 0));
      setItems(list.slice(0, 100));
    };

    const sub = getNdk().subscribe(notificationFilters(pubkey), { closeOnEose: false });
    sub.on("event", (ev: NDKEvent) => {
      if (!ev.id || map.has(ev.id) || !classifyNotification(ev, pubkey)) return;
      map.set(ev.id, ev);
      flush();
    });
    return () => sub.stop();
  }, [pubkey]);

  return items;
}
