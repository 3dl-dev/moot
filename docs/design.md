# moot — Design

Canonical design/architecture reference for moot.pub. The narrative roadmap
lives in [`README.md`](../README.md); the **actionable** roadmap lives in the
local `rd` board (see [operations.md](./operations.md#work-tracking-rd-local-only-board)).
This document is the *why*.

## What moot is

A Nostr-native discussion app in the Squabbles two-pane format: a post feed on
the left, threaded comments on the right. Because it's built on Nostr, moot is a
**lens over the global network** — it consumes and extends content from every
other client (OddBean, Coracle, noStrudel, …), not a walled garden.

## Architecture

moot is a **pure client-side SPA**. There is no backend today:

- All UI is `use client` React (Next.js 16 App Router, Turbopack, React 19, TS).
- Every network interaction is browser → Nostr relays via **NDK**
  (`@nostr-dev-kit/ndk`). No moot server sits in the path.
- Auth is **NIP-07** (browser extension: Alby / nos2x) — no accounts, no
  sessions on any moot infra.
- Build is a **static export** (`next.config.ts` → `output: 'export'` → `out/`),
  served from a CDN. See [operations.md](./operations.md).

Key modules:

| Module | Responsibility |
|--------|---------------|
| `lib/ndk.ts` | NDK singleton + relay set |
| `lib/nostr.ts` | Event parsing, threading (`parentId`), engagement scores, feeds |
| `lib/dvm.ts` | NIP-90 DVM feed discovery + read/live-run |
| `lib/mute.ts` | NIP-51 mute list |
| `lib/mentions.ts` | NIP-27 mention rendering |
| `lib/hooks.ts`, `lib/nav.ts` | React hooks, left-nav model |
| `app/components/*` | Two-pane UI (Feed, CommentColumn, PostCard, composers, …) |

## Interop invariant (do not break)

moot is a **superset reader, conservative writer**:

- **READ** both threading conventions: **NIP-10** (`kind:1` replies with `e`/`p`
  markers) *and* **NIP-22** (`kind:1111` with `E`/`K`/`P` root scope + `e`/`k`/`p`
  parent). `lib/nostr.ts:parentId` normalizes both.
- **WRITE** NIP-22 for replies (`kind:1111`) and `kind:1` for top-level notes.
- Reactions = **NIP-25** (`kind:7`). Share = `nevent` via njump.
- Communities = **NIP-72** (`kind:34550`); posts-to-community written as NIP-22
  with the community as root scope, classic `kind:1` submissions also read.
- Media upload = **NIP-96** with **NIP-98** auth. Mentions = **NIP-27**.
- Engagement = NIP-25 reactions + **NIP-57** zap sats.

**Rule:** when in doubt, add *reader* support for a new convention before
*writing* it. This is what lets a moot reply show up in other clients and vice
versa. Breaking it silently fragments moot from the network.

## Ranking & the "no native karma" problem

Nostr has no global vote authority. "Top" is aggregated from `kind:7` reactions
and NIP-57 zaps across *your* relay set, so ordering is **relative, not
canonical** — a snapshot, not a score. `fetchEngagementScores` in `lib/nostr.ts`
weights reactions + zap sats (economic weight is the strongest anti-spam
signal).

## Anti-spam strategy (why no Bayesian filter)

Spam on a permissionless network is a **trust** problem, not a **content**
problem — **score the messenger, not the message.** Text classification can't
tell a spammer's "GM" from a friend's. The three levers, strongest first:

1. **Web-of-trust distance** — NIP-02 follows. Home = Following feed (hop-1,
   shipped). Hop-2 is a follow-up.
2. **Economic weight** — NIP-57 zaps and NIP-13 proof-of-work.
3. **Delegated trust** — mutes/reports (NIP-51/NIP-56), NIP-72 approvals;
   importable mute lists.

Scoping to a community (NIP-72) naturally drops the global-firehose spam, which
is why communities led Phase 1.

## Community moderation (Phase 3) — soft, client-advisory, honest

A permissionless network **can't enforce** moderation: no server gates writes, so
any client can ignore a moderator. moot's stance is to be a **superset reader**
that honours moderation and says so plainly, rather than pretend it's authority.

- **Approvals — NIP-72 `kind:4550`.** The canonical community feed is the
  moderator-approved set, exactly what other NIP-72 clients read. `publishApproval`
  embeds the full post (per spec) so any client renders it without a refetch.
  moot's community view shows the approved set by default with an **All** toggle
  (superset reader — nothing is hidden, only re-sorted).
- **Everything NIP-72 leaves unspecified rides on NIP-32 labels (`kind:1985`)** —
  public, namespaced, readable by anyone. Namespace `moot.mod` carries
  `pin` / `lock` / `ban` / `remove` / `dismiss`; `moot.flair` carries flair text.
  A label targets a post (`e`) or user (`p`), scoped to the community (`a`).
  moot honours **only labels authored by that community's own moderators**
  (`reduceModState`) — authorization is client-side, because it must be.
- **Lock / temp-ban are advisory.** A locked thread disables replies **in moot**
  with a visible note that other clients may still allow them. moot never claims
  to have stopped anyone; it states what it does and what it can't.
- **Remove is reversible and honest.** A `remove` label hides a post from members
  in moot (mods still see it, to restore); if the post was approved, moot also
  retracts its own `kind:4550` so honouring clients drop it. Other clients showing
  the raw firehose are unaffected — and the UI copy says so.
- **Reports — NIP-56 `kind:1984`.** Any member reports a post; moot adds an `a`
  community tag (a superset extension others ignore) so a moderator sees reports
  across *all* the communities they moderate in one queue. Acting on a report
  writes a `remove`/`dismiss` label — that label stream **is** the auditable mod
  log. Retraction of toggle-able labels (pin/lock/flair) is a NIP-09 deletion.

Writes stay conservative (4550 approvals, 1984 reports, 1985 labels, all standard);
the reader is permissive. Content policy (NSFW gating, NIP-36/32) is tracked
separately.

## Authentication

moot has no backend and holds no accounts, so "auth" means **where the private
key lives and how moot gets signatures without touching it.** Two horizons, with
a NIP-46 seam between them so the deferred backend forces no client rework.

**Horizon 1 — client-only (now).** Adopt the `nostr-login` library, which
injects a NIP-07-compatible `window.nostr` shim so moot's existing signing path
barely changes, and exposes every method in one modal:

- **Local key** — generate/import an `nsec`, encrypted at rest with NIP-49.
  *Frictionless default:* one-tap key generation is the primary CTA. Tradeoff:
  the key is in the browser heap while active, so XSS = theft. This is the
  convenience tier, chosen deliberately for onboarding speed.
- **NIP-46 remote signer** — key lives in a separate signer (Amber, nsec.app);
  it never enters moot. The secure tier.
- **Read-only `npub`** — browse as an identity without signing. Fits moot's
  "lens over the network" framing.
- **NIP-07** — kept for users who already have an extension.

Handles: **`handle@moot.pub` via NIP-05**, served as a static
`public/.well-known/nostr.json` (GitHub Pages sends the `Access-Control-Allow-Origin: *`
NIP-05 requires). Registration is *curated* (PR + deploy) at this horizon.
NIP-05 is identity/verification, **not** authentication — it's the alias on top
of whatever signer the user uses.

**Horizon 2 — custodial backend (deferred).** An Azure Functions + Table Storage
+ **Key Vault** backend adds: self-serve NIP-05 registration, and a custodial
"sign in with OAuth (Google/email)" flow. The key architectural rule: the
custodial holder exposes keys to moot **as a NIP-46 bunker**, so the client stays
pure `nostr-login` with zero new auth code — all OAuth/custody complexity is
server-side. Secrets live in Key Vault (or envelope-encrypted with the KEK in
KV); Table Storage holds only metadata (`oauth-sub → keyref`, `handle →
pubkey`), never raw `nsec`s.

This horizon is **coupled to the hosting decision**: `handle@moot.pub` pins the
NIP-05 file to the apex, which static Pages can't serve dynamically — so it's
resolved *jointly* with the Phase 4 SSR → Container Apps decision (Azure Front
Door path-routing vs. host consolidation). Tracked as an rd decision item blocked
by the SSR decision. There is no literal OAuth into a Nostr identity — OAuth
providers can't mint secp256k1 keys — so "sign in with Google" is necessarily
custodial; the NIP-46 seam is what keeps that from contaminating the client.

## Hosting evolution

moot ships **static** (GitHub Pages) because it needs no server today. When SEO
work lands (roadmap Phase 4), SSR requires dropping `output: 'export'` and moving
to **Azure Container Apps** (the `rudi` / `nostr-relay-bench` pattern). No
lock-in: same repo, different build target + host. Tracked as an rd decision item
under the Phase 4 epic. Deploy/DNS details: [operations.md](./operations.md).

## Roadmap

Phases (0–4) are described narratively in the README. The **source of truth for
what to do next** is the local `rd` board, organized as six epics: Phase 2 —
Daily driver, Anti-spam hardening, Phase 3 — Community moderation, Phase 4 —
Reach, Deferred Phase 1 polish, and CI/CD & hosting follow-ups. Run
`rd ready` to see actionable items.
