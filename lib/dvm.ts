import NDK, { NDKEvent, type NDKFilter, type NDKKind } from "@nostr-dev-kit/ndk";

/** Local copy of the capped-subscription collector (keeps this module import-free). */
function collectEvents(
  ndk: NDK,
  filters: NDKFilter | NDKFilter[],
  capMs: number
): Promise<NDKEvent[]> {
  return new Promise((resolve) => {
    const events = new Map<string, NDKEvent>();
    const sub = ndk.subscribe(filters, { closeOnEose: true });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub.stop();
      resolve([...events.values()]);
    };
    sub.on("event", (e: NDKEvent) => {
      if (e.id) events.set(e.id, e);
    });
    sub.on("eose", finish);
    setTimeout(finish, capMs);
  });
}

// NIP-90 content discovery + NIP-89 handler announcements.
export const KIND_DVM_REQUEST = 5300; // content-discovery job request
export const KIND_DVM_RESULT = 6300; // job result (ranked event ids)
export const KIND_DVM_FEEDBACK = 7000; // job feedback (status/payment)
export const KIND_HANDLER = 31990; // NIP-89 application handler announcement

/**
 * moot's own feed DVM (see docs/dvm-feed.md). Publishes one precomputed feed per
 * sort, each read with `readLatestDvmFeed(ndk, MOOT_DVM_PUBKEY, tag)`.
 * npub1null3tev8jgqpk286ztpagch07hmlxfdxc0xmhkfpqfk8emsepnqnkhn88
 */
export const MOOT_DVM_PUBKEY = "9f3ff8af2c3c9000d947d0961ea3177fafbf992d361e6ddec9081363e770c866";
export const MOOT_FEED_TAGS = {
  hot: "moot-hot",
  top: "moot-top",
  rising: "moot-rising",
  controversial: "moot-controversial",
} as const;

export interface DvmProvider {
  pubkey: string;
  d: string;
  name: string;
  about: string;
  picture?: string;
}

/**
 * Extract the ranked event ids from a DVM result (kind:6300). The list is
 * usually a stringified tag array in `.content`; fall back to the event's own
 * `e` tags. Order is preserved (it's a *ranking*).
 */
export function parseDvmResult(ev: NDKEvent): string[] {
  const ids: string[] = [];
  try {
    const arr = JSON.parse(ev.content);
    if (Array.isArray(arr)) {
      for (const t of arr) if (Array.isArray(t) && t[0] === "e" && t[1]) ids.push(t[1]);
    }
  } catch {
    /* not JSON — fall through to tags */
  }
  if (ids.length === 0) {
    for (const t of ev.tags) if (t[0] === "e" && t[1]) ids.push(t[1]);
  }
  return [...new Set(ids)];
}

/** Discover content-discovery DVMs via NIP-89 announcements (no auth). */
export async function discoverDvmFeeds(ndk: NDK): Promise<DvmProvider[]> {
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_HANDLER as NDKKind], limit: 300 },
    5000
  );
  const best = new Map<string, { p: DvmProvider; ts: number }>();
  for (const ev of events) {
    const handles = ev.tags.filter((t) => t[0] === "k").map((t) => t[1]);
    if (!handles.includes(String(KIND_DVM_REQUEST))) continue;
    let meta: { name?: string; display_name?: string; about?: string; picture?: string } = {};
    try {
      meta = JSON.parse(ev.content || "{}");
    } catch {
      /* ignore */
    }
    const p: DvmProvider = {
      pubkey: ev.pubkey,
      d: ev.tags.find((t) => t[0] === "d")?.[1] ?? "",
      name: meta.name || meta.display_name || `${ev.pubkey.slice(0, 8)}…`,
      about: meta.about || "",
      picture: meta.picture,
    };
    const ts = ev.created_at ?? 0;
    const prev = best.get(p.pubkey);
    if (!prev || ts > prev.ts) best.set(p.pubkey, { p, ts });
  }
  return [...best.values()].map((b) => b.p).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fast, no-auth path: read the provider's most recent published result and
 * reuse its ranked list. This is the "precomputed feed as a plain read" trick —
 * no job round-trip, no signing.
 *
 * `feedTag` selects one of several named precomputed feeds a single DVM
 * publishes (e.g. "moot-hot", "moot-rising"), matched on the result's `t` tag.
 * Omit it to read the DVM's latest result of any kind (back-compat).
 */
export async function readLatestDvmFeed(
  ndk: NDK,
  providerPubkey: string,
  feedTag?: string
): Promise<string[]> {
  const filter: NDKFilter = { kinds: [KIND_DVM_RESULT as NDKKind], authors: [providerPubkey], limit: 5 };
  if (feedTag) filter["#t"] = [feedTag];
  const events = await collectEvents(ndk, filter, 5000);
  const latest = events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  return latest ? parseDvmResult(latest) : [];
}

/**
 * Live path (needs a signer): publish a kind:5300 job to the provider and wait
 * for its kind:6300 result, with a hard timeout. Returns [] on timeout so the
 * caller can fall back.
 */
export async function requestDvmFeed(
  ndk: NDK,
  providerPubkey: string,
  timeoutMs = 15000
): Promise<string[]> {
  const req = new NDKEvent(ndk);
  req.kind = KIND_DVM_REQUEST as NDKKind;
  req.content = "";
  req.tags = [["p", providerPubkey]];
  await req.publish(); // signs — requires login

  return new Promise((resolve) => {
    const sub = ndk.subscribe(
      { kinds: [KIND_DVM_RESULT as NDKKind], authors: [providerPubkey], "#e": [req.id] },
      { closeOnEose: false }
    );
    let done = false;
    const finish = (ids: string[]) => {
      if (done) return;
      done = true;
      sub.stop();
      resolve(ids);
    };
    sub.on("event", (e: NDKEvent) => finish(parseDvmResult(e)));
    setTimeout(() => finish([]), timeoutMs);
  });
}

/** Fetch events for a ranked id list, preserving rank order. */
export async function hydrateEvents(ndk: NDK, ids: string[]): Promise<NDKEvent[]> {
  if (ids.length === 0) return [];
  const filter: NDKFilter = { ids: ids.slice(0, 100) };
  const events = await collectEvents(ndk, filter, 5000);
  const byId = new Map(events.map((e) => [e.id, e]));
  return ids.map((id) => byId.get(id)).filter((e): e is NDKEvent => Boolean(e));
}
