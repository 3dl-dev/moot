import type { Community } from "./nostr";
import type { DvmProvider } from "./dvm";

/** Client-side view state. Real URL routes arrive with SSR in Phase 4. */
export type View =
  | { kind: "home" } // default: moot's ranked front page (DVM-backed sorts)
  | { kind: "feed" } // global "the floor" — raw firehose
  | { kind: "following" } // WoT hop-1: people you follow
  | { kind: "communities" } // directory
  | { kind: "community"; community: Community }
  | { kind: "create-community" }
  | { kind: "discover" } // DVM algorithmic-feed directory
  | { kind: "dvm"; provider: DvmProvider }
  | { kind: "settings" }; // sensitive-content (18+) preference lives here
