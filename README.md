# moot.pub

A **Nostr-native** discussion app in the [Squabbles](https://web.archive.org/web/20230723173248/https://squabbles.io/)
two-pane format: a Twitter-style post feed on the **left**, threaded comments on
the **right**, with like / reply / expand / share on every post and comment.

Because it's built on Nostr, moot is a *lens* over the global network — it
consumes and extends content from every other client (OddBean, Coracle,
Divine/Vine, noStrudel, …), not just what's posted through moot.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind v4** (dark-only for now)
- **NDK** (`@nostr-dev-kit/ndk`) for relays, subscriptions, signing
- **NIP-07** browser-extension login (Alby / nos2x)

```bash
npm run dev     # http://localhost:3000
npm run build   # production build (type-checked)
node --test thread.test.ts   # threading interop tests
```

## Interop invariant (do not break)

moot is a **superset reader, conservative writer**:

- **READ** both threading conventions: **NIP-10** (`kind:1` replies with
  `e`/`p` markers) *and* **NIP-22** (`kind:1111` with `E`/`K`/`P` root scope +
  `e`/`k`/`p` parent). `lib/nostr.ts:parentId` normalizes both.
- **WRITE** NIP-22 for replies (`kind:1111`) and `kind:1` for top-level notes.
- Reactions = **NIP-25** (`kind:7`). Share = `nevent` via njump.

This is what lets a moot reply show up in other clients and vice-versa. When in
doubt, add reader support for a new convention before writing it.

## Roadmap (value / time order)

**Phase 0 — Walking skeleton — ✅ DONE.** Two-pane layout, live global feed,
NIP-22 write + NIP-10/22 read, like/reply/expand/share, NIP-07 login, dark mode.
Consumes real content from the network on first load.

**Phase 1 — Real forum — ✅ DONE.**
- Communities (NIP-72 `kind:34550`): directory, per-community two-column feeds,
  create-a-community (with image), post-to-community (written as NIP-22 with the
  community as root scope; reads classic kind:1 submissions too).
- Profiles & avatars (kind:0); inline image + YouTube/Vimeo embeds.
- Media **upload** via NIP-96 (NIP-98 auth) — attach button in every composer.
- @user / +community mention rendering (NIP-27): `nostr:npub…` → @name link,
  `nostr:nevent/naddr…` → entity ref.
- Feed sort: **New** (recency) / **Top** (snapshot ranked by NIP-25 reactions
  across your relay set — Nostr has no global karma, so it's a snapshot).

Scoping to a community naturally drops the global-firehose spam — the reason
communities lead Phase 1.

*Deferred to later phases:* compose-time @mention autocomplete (rendering is
done), zap-weighted ranking (reactions only for now), resolving `naddr` refs to
community names inline.

**Phase 2 — Daily driver.**
- ✅ Pulled forward (anti-spam): **Home = Following feed** (WoT hop-1, your
  NIP-02 follows) as the antidote to the "All" firehose; **zap-weighted Top**
  (`fetchEngagementScores`: reactions + NIP-57 zap sats — economic weight is the
  strongest anti-spam signal). Feed also freezes after an initial batch with a
  "N new posts" pill instead of live-reflowing.
- ⬜ Remaining: mute users/communities, saved posts, multiple feeds/lists (all
  NIP-51); compact mode, infinite-scroll toggle, notification choices; drafts,
  history, search (NIP-50); reply/mention notifications.

**Algorithmic feeds — NIP-90 DVMs (Explore tab).** moot is a *consumer* in the
feed marketplace: it discovers content-discovery DVMs (NIP-89 announcements,
`kind:5300`), reads each provider's **latest published result** as the fast
no-auth path (`readLatestDvmFeed` → hydrate → render), and offers a **live run**
(`kind:5300` request → `kind:6300` result) when logged in, with timeout +
fallback to client-side Top. This is the seam for a future moot indexer (#4):
we'd slot in as *another* provider — private-fast for our own client,
public-paid DVM for everyone else. Caveat: the no-auth read path only works for
providers that publish results *proactively*; request-only DVMs need the live
(signed) path. `lib/dvm.ts`.

**Anti-spam strategy (why no Bayesian filter):** spam on a permissionless
network is a *trust* problem, not a *content* problem — score the messenger, not
the message. Web-of-trust distance (follows), economic weight (zaps/PoW), and
delegated trust (mutes/reports/NIP-72 approvals) beat text classification, which
can't tell a spammer's "GM" from a friend's. WoT-hop-2, min-PoW toggle, and
importable mute lists are the follow-ups.

**Phase 3 — Community management (soft moderation).** NIP-72 approve/remove +
mod lists, pinned posts, flairs; reports (NIP-56) → unified multi-community
queue; mod log. Lock / temp-ban ship as *client-advisory* (a permissionless
network can't truly enforce them — the UI says so). Polls (NIP-88), galleries,
badges (NIP-58), wiki (NIP-54) slot in here.

**Phase 4 — Reach.** SSR for SEO, YouTube-style explore/algorithmic feed,
RSS-out, DMs (NIP-17), topic/domain filters.

### Design note: no native karma

Nostr has no global vote authority. "Top" is aggregated from `kind:7` reactions
(and later zaps) across *your* relay set, so ordering is relative, not
canonical. Decide reactions-only vs zap-weighted before Phase 1 sort work.
