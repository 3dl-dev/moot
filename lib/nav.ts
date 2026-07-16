import type { Community } from "./nostr";
import type { DvmProvider, Topic } from "./dvm";

/** Client-side view state. Real URL routes arrive with SSR in Phase 4. */
export type View =
  | { kind: "home" } // default: moot's ranked front page (DVM-backed sorts)
  | { kind: "feed" } // global "the floor" — raw firehose
  | { kind: "following" } // WoT hop-1: people you follow
  | { kind: "communities" } // directory
  | { kind: "community"; community: Community }
  | { kind: "create-community" }
  | { kind: "topics" } // topic-feed directory (hashtag slices across Nostr)
  | { kind: "topic"; topic: Topic }
  | { kind: "discover" } // DVM algorithmic-feed directory
  | { kind: "dvm"; provider: DvmProvider }
  | { kind: "notifications" } // replies & mentions of the logged-in user
  | { kind: "saved" } // your NIP-51 kind:10003 bookmarked posts
  | { kind: "history" } // your own posts, comments & reactions
  | { kind: "search" } // NIP-50 search over posts & profiles
  | { kind: "list"; id: string } // a named people list (NIP-51 kind:30000), feed scoped to members
  | { kind: "create-list" } // the new-list editor
  | { kind: "settings" }; // sensitive-content (18+) preference lives here
