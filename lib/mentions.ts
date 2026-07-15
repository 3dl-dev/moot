import { nip19 } from "nostr-tools";

export type NostrToken =
  | { kind: "npub"; pubkey: string; bech32: string; rest: string }
  | { kind: "ref"; bech32: string; rest: string }
  | { kind: null };

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
    return { kind: "ref", bech32, rest };
  } catch {
    return { kind: null };
  }
}
