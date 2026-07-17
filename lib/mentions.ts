import { nip19 } from "nostr-tools";

export const KIND_COMMUNITY = 34550; // NIP-72 community definition (addressable)

export type NostrToken =
  | { kind: "npub"; pubkey: string; bech32: string; rest: string }
  | { kind: "community"; addr: string; bech32: string; rest: string }
  | { kind: "ref"; bech32: string; rest: string }
  | { kind: null };

/* ------------------------------------------------ compose-time @mention autocomplete */

/** A contact that can be @-mentioned (drawn from NIP-02 follows + profile cache). */
export interface MentionCandidate {
  pubkey: string;
  /** Display name (display_name || name); may be empty if only a nip05 is known. */
  name: string;
  /** NIP-05 address, optional. */
  nip05?: string;
}

/** The active `@`-token being typed immediately before the caret, if any. */
export interface MentionQuery {
  /** Text after the `@`, up to the caret (empty right after typing `@`). */
  query: string;
  /** Index of the `@` in the text. */
  start: number;
  /** Caret index (exclusive end of the token). */
  end: number;
}

// Characters that may appear in an in-progress @handle (names, nip05, hex).
const MENTION_CHAR = /[A-Za-z0-9_.-]/;

/**
 * Detect an in-progress `@mention` at the caret. Walks left from the caret over
 * allowed handle chars to an `@`, which must itself start a token (at string
 * start or after whitespace) so mid-word `@`s (e.g. emails) don't trigger.
 * Returns null when the caret is not inside a fresh `@token`.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  let i = caret;
  while (i > 0 && MENTION_CHAR.test(text[i - 1])) i--;
  if (i === 0 || text[i - 1] !== "@") return null;
  const at = i - 1;
  if (at > 0 && !/\s/.test(text[at - 1])) return null;
  return { query: text.slice(i, caret), start: at, end: caret };
}

/**
 * Rank contacts against the typed query. Prefix matches on name outrank prefix
 * matches on nip05, which outrank substring matches; ties break alphabetically.
 * An empty query returns the head of the (already name-sorted) list so typing a
 * bare `@` still surfaces suggestions.
 */
export function rankMentions(
  candidates: MentionCandidate[],
  query: string,
  limit = 6
): MentionCandidate[] {
  const q = query.toLowerCase();
  if (!q) return candidates.slice(0, limit);
  const scored: { c: MentionCandidate; score: number }[] = [];
  for (const c of candidates) {
    const name = c.name.toLowerCase();
    const nip = (c.nip05 ?? "").toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 3;
    else if (nip.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 1;
    else if (nip.includes(q)) score = 0;
    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map((s) => s.c);
}

/**
 * Replace the active `@query` span (start..end) with a NIP-27 `nostr:npub…`
 * mention plus a trailing space. Returns the new text and the caret position
 * after the inserted mention. The rendered composer output resolves this token
 * to `@name` via {@link decodeNostrToken} (see ContentBody).
 */
export function insertMention(
  text: string,
  start: number,
  end: number,
  pubkey: string
): { text: string; caret: number } {
  const token = `nostr:${nip19.npubEncode(pubkey)} `;
  return { text: text.slice(0, start) + token + text.slice(end), caret: start + token.length };
}

/**
 * Decode a whitespace token that may carry a NIP-19 entity (optionally with a
 * `nostr:` prefix and trailing punctuation). Returns the resolved kind plus any
 * trailing characters (rest) so callers can render them as plain text.
 */
export function decodeNostrToken(raw: string): NostrToken {
  let t = raw.startsWith("nostr:") ? raw.slice(6) : raw;
  const m = t.match(/^(npub1|nprofile1|note1|nevent1|naddr1)[0-9a-z]+/i);
  if (!m) return { kind: null };
  const bech32 = m[0];
  const rest = t.slice(bech32.length);
  try {
    const dec = nip19.decode(bech32);
    if (dec.type === "npub") return { kind: "npub", pubkey: dec.data as string, bech32, rest };
    if (dec.type === "nprofile")
      return { kind: "npub", pubkey: (dec.data as { pubkey: string }).pubkey, bech32, rest };
    // An naddr pointing at a NIP-72 community (kind:34550) resolves to that
    // community's coordinate, so we can render its name instead of a raw ref.
    if (dec.type === "naddr") {
      const d = dec.data as { kind: number; pubkey: string; identifier: string };
      if (d.kind === KIND_COMMUNITY)
        return { kind: "community", addr: `${KIND_COMMUNITY}:${d.pubkey}:${d.identifier}`, bech32, rest };
    }
    return { kind: "ref", bech32, rest };
  } catch {
    return { kind: null };
  }
}
