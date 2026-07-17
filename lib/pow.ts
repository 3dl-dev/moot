import type { NDKEvent } from "@nostr-dev-kit/ndk";

/**
 * NIP-13 proof-of-work, read-side. moot never *mints* PoW (conservative writer);
 * it only *measures* it so a feed can require a minimum difficulty and drop the
 * cheap, no-PoW firehose spam. "Score the messenger" — a note whose author paid
 * real hashing to publish it is a weak but unforgeable spam signal.
 *
 * Difficulty per NIP-13 is the number of leading zero *bits* in the event id
 * (the 32-byte sha256, hex-encoded). We measure the *actual* id — not the target
 * committed in the `nonce` tag — because the id can't be faked: a spammer can
 * claim any target, but only real leading zeros count.
 */

/** Leading-zero-bit count of a 32-byte id given as a 64-char hex string. */
export function powBits(idHex: string): number {
  let bits = 0;
  for (const ch of idHex) {
    const nibble = parseInt(ch, 16);
    if (Number.isNaN(nibble)) break; // malformed id — stop counting
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    // First non-zero nibble: add its own leading zeros, then stop.
    // 8=1000→0, 4=0100→1, 2=0010→2, 1=0001→3.
    bits += Math.clz32(nibble) - 28;
    break;
  }
  return bits;
}

/** NIP-13 difficulty of an event: leading zero bits of its id (0 if no id). */
export function eventPow(ev: Pick<NDKEvent, "id">): number {
  return ev.id ? powBits(ev.id) : 0;
}

/**
 * True if an event clears the minimum-PoW bar. `min <= 0` disables the filter
 * (everything passes), so a 0/undefined threshold is a no-op — the common case.
 */
export function meetsMinPow(ev: Pick<NDKEvent, "id">, min: number): boolean {
  if (!min || min <= 0) return true;
  return eventPow(ev) >= min;
}

/** The min-PoW thresholds the UI offers, in leading-zero bits. 0 = off. */
export const POW_LEVELS = [0, 8, 16, 20] as const;
export type PowLevel = (typeof POW_LEVELS)[number];
