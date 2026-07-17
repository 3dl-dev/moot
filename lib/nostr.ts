import NDK, { NDKEvent, type NDKFilter, type NDKKind } from "@nostr-dev-kit/ndk";

// Kinds moot reads/writes in Phase 0.
export const KIND_TEXT = 1; // NIP-01 short text note (root posts)
export const KIND_COMMENT = 1111; // NIP-22 comment (replies)
export const KIND_PICTURE = 20; // NIP-68 picture post (Olas et al.) — image in imeta, caption in content

/**
 * Resolve an event's parent id for threading — the crux of interop.
 * We READ both threading conventions:
 *   - NIP-22 (kind:1111): the lowercase `e` tag is the immediate parent.
 *   - NIP-10 (kind:1):    the `e` tag marked "reply" (or "root", or the last
 *                         positional `e` tag under the deprecated scheme).
 * Returns null for a root/top-level event.
 */
export function parentId(ev: NDKEvent): string | null {
  if (ev.kind === KIND_COMMENT) {
    const e = ev.tags.find((t) => t[0] === "e");
    return e?.[1] ?? null;
  }
  const eTags = ev.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return null;
  const reply = eTags.find((t) => t[3] === "reply");
  if (reply) return reply[1];
  const root = eTags.find((t) => t[3] === "root");
  if (root) return root[1];
  // Deprecated NIP-10 positional: last `e` tag is the reply target.
  return eTags[eTags.length - 1][1];
}

/** A top-level note for the feed: a text note that isn't itself a reply. */
export function isTopLevelNote(ev: NDKEvent): boolean {
  return ev.kind === KIND_TEXT && !ev.tags.some((t) => t[0] === "e");
}

/**
 * Cheap feed-quality filter: hide obvious machine noise on the public
 * firehose (JSON telemetry blobs, bare hashes/keys) so the demo reads as
 * human conversation. Real signal comes from communities in Phase 1.
 */
export function looksLikeContent(content: string): boolean {
  const c = content.trim();
  if (!c) return false;
  if (c[0] === "{" || c[0] === "[") return false; // JSON blob
  if (!/\s/.test(c) && c.length > 80) return false; // single long token = hash/key
  return true;
}

export interface ThreadNode {
  event: NDKEvent;
  children: ThreadNode[];
}

/**
 * Build a nested comment tree rooted at `rootId` from a flat set of events.
 * Handles NIP-10 and NIP-22 replies uniformly via parentId(). Siblings are
 * sorted oldest-first (classic forum reading order).
 */
export function buildThread(events: NDKEvent[], rootId: string): ThreadNode[] {
  const childrenOf = new Map<string, NDKEvent[]>();
  const seen = new Set<string>();
  for (const e of events) {
    if (!e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    const p = parentId(e);
    if (!p) continue;
    (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(e);
  }
  const build = (id: string): ThreadNode[] =>
    (childrenOf.get(id) ?? [])
      .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
      .map((e) => ({ event: e, children: build(e.id) }));
  return build(rootId);
}

/**
 * Drop muted authors' comments — and their whole subtree — from a thread.
 * A muted author's replies are theirs, so hiding the subtree is the honest
 * behaviour (no orphaned children reparenting under someone else). Pure: the
 * caller supplies the mute predicate, keeping this free of localStorage/React.
 */
export function pruneMutedThread(
  nodes: ThreadNode[],
  muted: (ev: NDKEvent) => boolean
): ThreadNode[] {
  return nodes
    .filter((n) => !muted(n.event))
    .map((n) => ({ event: n.event, children: pruneMutedThread(n.children, muted) }));
}

/**
 * Publish a NIP-22 (kind:1111) reply.
 * We WRITE NIP-22 — the modern comment convention you prioritized — while
 * reading both. Root scope uses uppercase tags (E/K/P), the immediate parent
 * uses lowercase (e/k/p). When replying straight to the post, parent === root.
 */
export async function publishReply(
  ndk: NDK,
  opts: { root: NDKEvent; parent: NDKEvent; content: string }
): Promise<NDKEvent> {
  const { root, parent, content } = opts;
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_COMMENT;
  ev.content = content;
  ev.tags = [
    ["E", root.id, "", root.pubkey],
    ["K", String(root.kind ?? KIND_TEXT)],
    ["P", root.pubkey],
    ["e", parent.id, "", parent.pubkey],
    ["k", String(parent.kind ?? KIND_TEXT)],
    ["p", parent.pubkey],
  ];
  await ev.publish();
  return ev;
}

/**
 * Collect events for a filter set via a live subscription with a hard time
 * cap, so callers always settle even if a relay never sends EOSE (plain
 * fetchEvents can hang forever on one silent/dead relay).
 */
export function collectEvents(
  ndk: NDK,
  filters: NDKFilter | NDKFilter[],
  capMs = 5000
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

/** All replies to a root event across BOTH threading conventions (NIP-10 + NIP-22). */
export function fetchReplies(ndk: NDK, rootId: string, capMs = 5000): Promise<NDKEvent[]> {
  return collectEvents(
    ndk,
    [
      { kinds: [KIND_TEXT, KIND_COMMENT], "#e": [rootId] },
      { kinds: [KIND_TEXT, KIND_COMMENT], "#E": [rootId] },
    ],
    capMs
  );
}

/** Publish a new top-level text note (kind:1) to the global feed. */
export async function publishNote(ndk: NDK, content: string): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_TEXT;
  ev.content = content;
  await ev.publish();
  return ev;
}

export const KIND_REACTION = 7; // NIP-25
export const KIND_ZAP = 9735; // NIP-57 zap receipt
export const KIND_CONTACTS = 3; // NIP-02 contact list (follows)

/** Sats in a zap receipt, read from the embedded zap-request amount (msats). */
export function zapSats(ev: NDKEvent): number {
  const desc = ev.tags.find((t) => t[0] === "description")?.[1];
  if (!desc) return 0;
  try {
    const req = JSON.parse(desc) as { tags?: string[][] };
    const amt = req.tags?.find((t) => t[0] === "amount")?.[1];
    return amt ? Math.round(Number(amt) / 1000) : 0;
  } catch {
    return 0;
  }
}

export interface Engagement {
  reactions: number;
  sats: number;
}

/** Combined rank value: reactions + zap sats (economic weight dominates). */
export function engagementScore(e?: Engagement): number {
  return e ? e.reactions + e.sats : 0;
}

/**
 * Snapshot engagement per event: NIP-25 reactions (−1 for a "-" downvote) and
 * **zap sats** (NIP-57) tracked separately so the UI can show both. Economic
 * weight is the strongest anti-spam signal, so a zapped post outranks a merely-
 * liked one. Relative to the current relay set (Nostr has no global karma).
 */
export async function fetchEngagementScores(
  ndk: NDK,
  ids: string[]
): Promise<Map<string, Engagement>> {
  const map = new Map<string, Engagement>();
  if (ids.length === 0) return map;
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_REACTION, KIND_ZAP as NDKKind], "#e": ids },
    4500
  );
  for (const e of events) {
    const target = e.tags.filter((t) => t[0] === "e").at(-1)?.[1];
    if (!target) continue;
    const cur = map.get(target) ?? { reactions: 0, sats: 0 };
    if (e.kind === KIND_ZAP) cur.sats += zapSats(e);
    else cur.reactions += e.content.trim() === "-" ? -1 : 1;
    map.set(target, cur);
  }
  return map;
}

/** The pubkeys a user follows (newest NIP-02 contact list). The WoT hop-1 set. */
export async function fetchFollows(ndk: NDK, pubkey: string): Promise<string[]> {
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_CONTACTS as NDKKind], authors: [pubkey], limit: 1 },
    4000
  );
  const latest = events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  if (!latest) return [];
  return [...new Set(latest.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]))];
}

/** The `p`-tag pubkeys of a NIP-02 contact list event (its follows). */
export function followsOf(contactList: NDKEvent): string[] {
  return contactList.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
}

/**
 * Build the WoT hop-2 author set: everyone you follow (hop-1) PLUS everyone
 * *they* follow (follows-of-follows), minus yourself. Pure so the ranking option
 * is unit-testable: given your hop-1 set and the contact lists of those hop-1
 * accounts, it returns the deduped extended author set. Hop-3+ never enters —
 * we only union one ring outward. `cap` bounds the result for relay author-list
 * limits (hop-1 is kept whole; hop-2 fills the remainder, order-stable).
 */
export function buildHop2Authors(
  self: string,
  hop1: string[],
  hop1ContactLists: NDKEvent[],
  cap = 800
): string[] {
  const hop1Set = new Set(hop1);
  const ordered: string[] = [];
  const seen = new Set<string>([self]);
  for (const pk of hop1) {
    if (!seen.has(pk)) {
      seen.add(pk);
      ordered.push(pk);
    }
  }
  for (const list of hop1ContactLists) {
    for (const pk of followsOf(list)) {
      if (!seen.has(pk)) {
        seen.add(pk);
        ordered.push(pk);
      }
    }
  }
  // Never let the cap evict a hop-1 (core) author in favour of a hop-2 one.
  if (ordered.length <= cap) return ordered;
  const core = ordered.filter((pk) => hop1Set.has(pk));
  const extended = ordered.filter((pk) => !hop1Set.has(pk));
  return [...core, ...extended].slice(0, cap);
}

/**
 * Fetch the follows-of-follows author set for hop-2 ranking. Reads the contact
 * lists of (a bounded slice of) your hop-1 follows in one relay query, then
 * unions per `buildHop2Authors`. Bounded on both ends: we only query the first
 * `sampleFrom` hop-1 accounts (a large follow set already gives broad coverage)
 * and cap the returned authors so the downstream relay filter stays legal.
 */
export async function fetchFollowsOfFollows(
  ndk: NDK,
  self: string,
  hop1: string[],
  sampleFrom = 200,
  cap = 800
): Promise<string[]> {
  const sample = hop1.slice(0, sampleFrom);
  if (sample.length === 0) return [];
  const lists = await collectEvents(
    ndk,
    // Headroom over sample.length: relays may return several historical kind:3
    // per author, and a tight limit would let a few authors' history crowd out
    // others' current lists — under-fetching hop-2 coverage. We keep newest-per
    // -author below, so over-fetching is harmless.
    { kinds: [KIND_CONTACTS as NDKKind], authors: sample, limit: sample.length * 3 },
    5000
  );
  // Keep only the newest contact list per author before unioning their follows.
  const newest = new Map<string, NDKEvent>();
  for (const ev of lists) {
    const prev = newest.get(ev.pubkey);
    if (!prev || (ev.created_at ?? 0) > (prev.created_at ?? 0)) newest.set(ev.pubkey, ev);
  }
  return buildHop2Authors(self, hop1, [...newest.values()], cap);
}

/**
 * Upload a file to a NIP-96 HTTP server, authenticated with a NIP-98 event,
 * and return the hosted URL. Requires a signer (login).
 */
export async function uploadToNip96(
  ndk: NDK,
  file: File,
  host = "https://nostr.build"
): Promise<string> {
  const info = await fetch(`${host}/.well-known/nostr/nip96.json`).then((r) => r.json());
  const apiUrl: string = info.api_url;

  // NIP-98 HTTP auth: a signed kind:27235 event, base64 in the header.
  const auth = new NDKEvent(ndk);
  auth.kind = 27235 as NDKKind;
  auth.tags = [
    ["u", apiUrl],
    ["method", "POST"],
  ];
  auth.content = "";
  await auth.sign();
  const token = btoa(unescape(encodeURIComponent(JSON.stringify(auth.rawEvent()))));

  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Nostr ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  const json = await res.json();
  const urlTag = json?.nip94_event?.tags?.find((t: string[]) => t[0] === "url")?.[1];
  const url = urlTag || json?.url || json?.data?.url;
  if (!url) throw new Error("Upload succeeded but no URL returned.");
  return url as string;
}

/** A shareable web link for an event (njump resolves nevent → any client). */
export function shareLink(ev: NDKEvent): string {
  return `https://njump.me/${ev.encode()}`;
}

/* ============================ NIP-72 communities ============================ */

export const KIND_COMMUNITY = 34550; // community definition (addressable)

export interface Community {
  addr: string; // "34550:<author>:<id>" coordinate
  author: string;
  id: string; // d-tag
  name: string;
  description: string;
  image?: string;
  moderators: string[];
}

function tagVal(ev: NDKEvent, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

export function parseCommunity(ev: NDKEvent): Community {
  const id = tagVal(ev, "d") ?? "";
  return {
    addr: `${KIND_COMMUNITY}:${ev.pubkey}:${id}`,
    author: ev.pubkey,
    id,
    name: tagVal(ev, "name") || id || "unnamed",
    description: tagVal(ev, "description") || "",
    image: tagVal(ev, "image"),
    moderators: ev.tags
      .filter((t) => t[0] === "p" && t[3] === "moderator")
      .map((t) => t[1]),
  };
}

/** Fetch community definitions, newest-per-coordinate, sorted by name. */
export async function fetchCommunities(ndk: NDK, limit = 200): Promise<Community[]> {
  const events = await collectEvents(ndk, { kinds: [KIND_COMMUNITY as NDKKind], limit }, 6000);
  const best = new Map<string, { c: Community; ts: number }>();
  for (const ev of events) {
    const c = parseCommunity(ev);
    if (!c.id) continue;
    const ts = ev.created_at ?? 0;
    const prev = best.get(c.addr);
    if (!prev || ts > prev.ts) best.set(c.addr, { c, ts });
  }
  return [...best.values()].map((b) => b.c).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch specific community definitions by their `34550:<author>:<d>` coordinates
 * — used to resolve a user's joined set (which is stored as bare coordinates) to
 * renderable Community objects. Queries by author+d and filters to the exact
 * coordinates asked for (the author/d filter is a cross-product superset).
 */
export async function fetchCommunitiesByAddr(ndk: NDK, addrs: string[]): Promise<Community[]> {
  if (!addrs.length) return [];
  const authors = [...new Set(addrs.map((a) => a.split(":")[1]).filter(Boolean))];
  const ds = [...new Set(addrs.map((a) => a.split(":").slice(2).join(":")).filter(Boolean))];
  const events = await collectEvents(
    ndk,
    { kinds: [KIND_COMMUNITY as NDKKind], authors, "#d": ds },
    5000
  );
  const want = new Set(addrs);
  const best = new Map<string, { c: Community; ts: number }>();
  for (const ev of events) {
    const c = parseCommunity(ev);
    if (!want.has(c.addr)) continue;
    const ts = ev.created_at ?? 0;
    const prev = best.get(c.addr);
    if (!prev || ts > prev.ts) best.set(c.addr, { c, ts });
  }
  return [...best.values()].map((b) => b.c).sort((a, b) => a.name.localeCompare(b.name));
}

export const KIND_POLL = 1068; // NIP-88 poll (defined in lib/polls.ts; literal here avoids a cycle)

/** Filters for a community's top-level posts (reads NIP-72 kind:1 + NIP-22 kind:1111 + NIP-88 polls). */
export function communityPostFilters(addr: string): NDKFilter[] {
  return [
    { kinds: [KIND_TEXT], "#a": [addr] }, // classic NIP-72 submissions
    { kinds: [KIND_COMMENT], "#A": [addr] }, // NIP-22 community posts
    { kinds: [KIND_POLL as NDKKind], "#a": [addr] }, // NIP-88 polls posted to the community
  ];
}

export const KIND_COMMUNITY_APPROVAL = 4550; // NIP-72 moderator post-approval

/**
 * Image URLs carried in NIP-92 `imeta` tags. Photo-first clients (Olas et al.)
 * put the image here, not in the note text — so without this, photography posts
 * render as empty text in moot. Each `imeta` tag is space-delimited `key value`
 * parts; we want the `url …` one.
 */
/**
 * Hashtag-stuffing guard for topic feeds. Link-spam bots tag one post with
 * dozens of unrelated hashtags so it surfaces in every topic; genuine posts use
 * a handful. On-network the split is sharply bimodal — legit posts carry ≤6 `t`
 * tags, spam ≥11, with almost nothing between (measured via scripts, see
 * docs/design.md#anti-spam) — so a cap of 8 drops ~97% of the noise with no
 * observed legitimate false positives.
 */
export const MAX_TOPIC_HASHTAGS = 8;

/** Number of NIP-12 `t` (hashtag) tags on an event. Pure. */
export function hashtagCount(ev: NDKEvent): number {
  return ev.tags.reduce((n, t) => (t[0] === "t" ? n + 1 : n), 0);
}

/** True if an event carries more than `max` hashtags — i.e. looks stuffed. Pure. */
export function isHashtagStuffed(ev: NDKEvent, max = MAX_TOPIC_HASHTAGS): boolean {
  return hashtagCount(ev) > max;
}

export function imetaUrls(ev: NDKEvent): string[] {
  const urls: string[] = [];
  for (const t of ev.tags) {
    if (t[0] !== "imeta") continue;
    for (const part of t.slice(1)) {
      if (part.startsWith("url ")) {
        const u = part.slice(4).trim();
        if (u) urls.push(u);
      }
    }
  }
  return urls;
}

/** Approved post ids referenced by a moderator's kind:4550 `e` tags. Pure. */
export function approvedIdsFromTags(tags: string[][]): string[] {
  return tags.filter((t) => t[0] === "e" && t[1]).map((t) => t[1]);
}

export interface Approvals {
  ids: Set<string>; // approved event ids
  embedded: NDKEvent[]; // full events the moderator embedded in the approval content
}

/**
 * The moderator-approved feed for a community (NIP-72). Each kind:4550 approval
 * references an approved post by `e` tag and often embeds the full event in its
 * content (so a client can render it even without fetching). The canonical
 * community feed other NIP-72 clients show is exactly this approved set.
 */
export async function fetchCommunityApprovals(ndk: NDK, addr: string): Promise<Approvals> {
  const approvals = await collectEvents(
    ndk,
    { kinds: [KIND_COMMUNITY_APPROVAL as NDKKind], "#a": [addr] },
    5000
  );
  const ids = new Set<string>();
  const embedded: NDKEvent[] = [];
  for (const ap of approvals) {
    for (const id of approvedIdsFromTags(ap.tags)) ids.add(id);
    const c = ap.content?.trim();
    if (c && c[0] === "{") {
      try {
        const raw = JSON.parse(c);
        if (raw && raw.id) {
          embedded.push(new NDKEvent(ndk, raw));
          ids.add(raw.id);
        }
      } catch {
        /* not an embedded event — the `e` tag still records the approval */
      }
    }
  }
  return { ids, embedded };
}

/** A top-level community submission (not a reply within the community). */
export function isTopLevelCommunityPost(ev: NDKEvent, addr: string): boolean {
  if (ev.tags.some((t) => t[0] === "e")) return false; // reply to another post
  if (ev.kind === KIND_TEXT || ev.kind === KIND_POLL)
    return ev.tags.some((t) => t[0] === "a" && t[1] === addr);
  if (ev.kind === KIND_COMMENT) return ev.tags.some((t) => t[0] === "A" && t[1] === addr);
  return false;
}

/**
 * Publish a top-level post to a community. Written as a NIP-22 comment whose
 * root AND parent is the community (addressable): uppercase = root scope,
 * lowercase = immediate parent. We read classic kind:1 submissions too.
 */
export async function publishCommunityPost(
  ndk: NDK,
  community: Community,
  content: string
): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_COMMENT;
  ev.content = content;
  ev.tags = [
    ["A", community.addr, "", community.author],
    ["K", String(KIND_COMMUNITY)],
    ["P", community.author],
    ["a", community.addr, "", community.author],
    ["k", String(KIND_COMMUNITY)],
    ["p", community.author],
  ];
  await ev.publish();
  return ev;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/* ===================== NIP-72 moderation (approve / remove / mod list) ===================== */

/** True if `pubkey` moderates this community (its author is always a moderator). */
export function isModerator(c: Community, pubkey?: string | null): boolean {
  return !!pubkey && (c.author === pubkey || c.moderators.includes(pubkey));
}

/** True if `pubkey` owns this community (only the owner can edit its definition). */
export function isOwner(c: Community, pubkey?: string | null): boolean {
  return !!pubkey && c.author === pubkey;
}

/**
 * Publish a NIP-72 moderator approval (kind:4550) for a post. Per spec the
 * approval embeds the full approved event as JSON in its content (so clients can
 * render the approved feed without a second fetch) and tags the community (`a`),
 * the post (`e`), its author (`p`), and its kind (`k`).
 */
export async function publishApproval(
  ndk: NDK,
  community: Community,
  post: NDKEvent
): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_COMMUNITY_APPROVAL as NDKKind;
  ev.content = JSON.stringify(post.rawEvent());
  ev.tags = [
    ["a", community.addr, "", community.author],
    ["e", post.id],
    ["p", post.pubkey],
    ["k", String(post.kind ?? KIND_TEXT)],
  ];
  await ev.publish();
  return ev;
}

/** Raw kind:4550 approval events for a community (for retraction / audit). */
export function fetchApprovalEvents(ndk: NDK, addr: string): Promise<NDKEvent[]> {
  return collectEvents(ndk, { kinds: [KIND_COMMUNITY_APPROVAL as NDKKind], "#a": [addr] }, 5000);
}

/**
 * Republish a community definition (kind:34550, addressable) with edited
 * metadata and/or moderator set. Only the owner can do this — the event is
 * replaceable by (author, `d`), so a non-owner's republish creates a *different*
 * community, not an edit. The owner is kept in the moderator set implicitly.
 */
export async function updateCommunity(
  ndk: NDK,
  community: Community,
  patch: { name?: string; description?: string; image?: string; moderators?: string[] }
): Promise<Community> {
  const moderators = patch.moderators ?? community.moderators;
  const image = patch.image ?? community.image;
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_COMMUNITY as NDKKind;
  ev.tags = [
    ["d", community.id],
    ["name", patch.name ?? community.name],
    ["description", patch.description ?? community.description],
    ...moderators.map((m) => ["p", m, "", "moderator"]),
  ];
  if (image) ev.tags.push(["image", image]);
  await ev.publish();
  return parseCommunity(ev);
}

/* ============================= NIP-56 reports ============================= */

export const KIND_REPORT = 1984; // NIP-56 report

export const REPORT_TYPES = [
  "spam",
  "nudity",
  "profanity",
  "illegal",
  "impersonation",
  "malware",
  "other",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface Report {
  id: string;
  reporter: string;
  type: string;
  targetEvent?: string;
  targetPubkey?: string;
  community?: string; // moot tags reports with the community so mods can triage
  reason: string;
  created_at: number;
}

/**
 * Tags for a NIP-56 report (kind:1984). The report type is the 3rd entry of the
 * `e`/`p` tag being reported. moot adds an `a` community tag (a superset
 * extension other clients ignore) so a community's mods can find reports about
 * their community in one query.
 */
export function buildReportTags(opts: {
  type: ReportType;
  targetEvent?: string;
  targetPubkey?: string;
  community?: string;
}): string[][] {
  const tags: string[][] = [];
  if (opts.targetPubkey) tags.push(["p", opts.targetPubkey, opts.type]);
  if (opts.targetEvent) tags.push(["e", opts.targetEvent, opts.type]);
  if (opts.community) tags.push(["a", opts.community]);
  return tags;
}

/** Parse a kind:1984 report. Null if it references neither an event nor a user. */
export function parseReport(ev: NDKEvent): Report | null {
  const e = ev.tags.find((t) => t[0] === "e");
  const p = ev.tags.find((t) => t[0] === "p");
  if (!e && !p) return null;
  return {
    id: ev.id ?? "",
    reporter: ev.pubkey,
    type: e?.[2] || p?.[2] || "other",
    targetEvent: e?.[1],
    targetPubkey: p?.[1],
    community: ev.tags.find((t) => t[0] === "a")?.[1],
    reason: ev.content ?? "",
    created_at: ev.created_at ?? 0,
  };
}

/** Publish a NIP-56 report. Requires a signer. */
export async function publishReport(
  ndk: NDK,
  opts: { type: ReportType; targetEvent?: string; targetPubkey?: string; community?: string; reason?: string }
): Promise<NDKEvent> {
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_REPORT as NDKKind;
  ev.content = opts.reason ?? "";
  ev.tags = buildReportTags(opts);
  await ev.publish();
  return ev;
}

/** Fetch reports across a set of community coordinates (the mod's communities). */
export function fetchReports(ndk: NDK, addrs: string[]): Promise<NDKEvent[]> {
  if (addrs.length === 0) return Promise.resolve([]);
  return collectEvents(ndk, { kinds: [KIND_REPORT as NDKKind], "#a": addrs }, 5000);
}

/** Create a community (kind:34550) with the signer as its first moderator. */
export async function publishCommunity(
  ndk: NDK,
  opts: { name: string; description: string; image?: string }
): Promise<Community> {
  const me = await ndk.signer?.user();
  if (!me) throw new Error("Log in to create a community.");
  const id = slugify(opts.name) || `c-${Math.floor(Math.random() * 1e6)}`;
  const ev = new NDKEvent(ndk);
  ev.kind = KIND_COMMUNITY as NDKKind;
  ev.tags = [
    ["d", id],
    ["name", opts.name],
    ["description", opts.description],
    ["p", me.pubkey, "", "moderator"],
  ];
  if (opts.image) ev.tags.push(["image", opts.image]);
  await ev.publish();
  return parseCommunity(ev);
}

/** Compact relative timestamp, e.g. "3m", "5h", "2d". */
export function timeAgo(unix?: number): string {
  if (!unix) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 2592000)}mo`;
}
