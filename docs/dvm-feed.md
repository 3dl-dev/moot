# moot feed algorithm — server-side ranking via our own DVM

**Status:** design + spike (this doc). Hosting not yet built — gated on the spike
proving ranking quality on real data.

**Problem.** moot's default was the raw chronological firehose, and its "Top" was
a naive `reactions + sats` sum with no time decay. Client-side ranking can only
rank the chaff the browser happens to pull in a ~100-event window — it can't see
the whole corpus, so it can't be good. Pointing at a third-party feed DVM (e.g.
Primal's) makes moot a worse Primal — *why come here?*

**Answer.** moot runs **its own** feed algorithm as a Nostr DVM (NIP-90). The
ranking is what makes moot *moot*: a **two-pane discussion** app, so the feed
optimizes for **conversation, not virality**, and filters spam by **web of
trust** — "score the messenger, not the message." Because it's our algorithm on
our terms, and published as a Nostr service, other clients can consume it too.

## Two "cost functions"

### 1. The ranking objective — `lib/rank.ts` (the product)

Pure, tested, and shared by every deployment target. Reddit/HN "hot", but the
numerator is discussion-weighted, not engagement-maximizing:

```
score(post) = (weightedEngagement + 1) / (ageHours + 2)^GRAVITY

weightedEngagement = W.replier·repliers      ← distinct humans in the thread (dominant)
                   + W.reply·(replies−repliers)  ← thread depth
                   + W.sat·sats               ← NIP-57 zaps (economic, hard to fake)
                   + W.reaction·reactions      ← NIP-25 likes (weakest, spammable)
```

Every engagement signal is **web-of-trust weighted** before it enters the score:
`core` (hop-1 from the anchor) counts full, `extended` (hop-2) counts partial,
`unknown` (strangers) barely counts. A botnet liking itself can't climb.

Weights (`WEIGHTS`, `GRAVITY`, `TRUST_WEIGHT`) are the tuning knobs. They are
tuned against the spike output on real data — see below — not guessed.

### 2. The compute cost — GitHub Actions (Model A)

| Host | Cadence | Cost |
|---|---|---|
| **GitHub Actions, public repo** (chosen) | cron ~15 min | **$0** — Actions minutes are free & unmetered on public repos |
| Azure Functions timer (fallback) | ~15 min | $0–$5 — well under the 1M-exec / 400k-GB-s free grant; more punctual cron |

Real cost is **key custody, freshness monitoring, and algorithm tuning** — not
dollars.

## Model A — precomputed feeds (now)

Stateless batch job, no database:

1. **cron** (GitHub Actions) fires every ~15 min.
2. Pull recent top-level notes (last few hours) + their reactions / zaps /
   replies from the relay set.
3. Build the **web-of-trust** from an anchor identity (the DVM operator's
   follows → hop-1 core, hop-2 extended).
4. Score with `lib/rank.ts`.
5. **Publish a `kind:6300` result** (ranked `e`-tag list) to relays, plus a
   `kind:31990` NIP-89 handler announcement so moot *and other clients* discover
   it.
6. Client reads the latest result with `readLatestDvmFeed` (`lib/dvm.ts:97`) —
   **no login, no round-trip, instant.** The reading plumbing already exists.

The client never waits on the DVM on its critical path: the default view is a
cheap read of a precomputed list, with client-side hot as the offline fallback.

### The five sorts (Reddit parity)

All five are scorers over the same `RankSignals` — the spike collects every signal
they need in one pass. Implemented and tested in `lib/rank.ts` (`SCORERS`):

| Sort | Scorer | Notes |
|---|---|---|
| **Hot** | `hotScore` | default; discussion-weighted engagement + author prior, decayed by age (HN-shape). |
| **Top** | `topScore` | weighted engagement, no decay; caller picks the time window (day/week/…). |
| **New** | — | chronological; client-only, needs no DVM. |
| **Rising** | `engagementVelocity` (real) / `risingScore` (fallback) | **Real Δengagement/h** across cron snapshots — the DVM persists a snapshot each run and diffs the next. `risingScore` (stateless, engagement/age, <3h) is the fallback for first-seen posts. Both verified: run the spike twice a few minutes apart and Rising switches from stateless to real velocity. |
| **Controversial** | `controversyScore` — **"the ratio"** | `pushback² / (upvotes+1)`, `pushback = replies + downvotes`. Argument that outweighs endorsement = ratio'd. Downvotes fold into `pushback`, so it becomes dissent-aware as `-` spreads — no code switch. |

**Downvotes are load-bearing, but not blocking.** The spike found `total
downvotes seen: 0.0` across the live network — almost no Nostr client sends `-`
reactions. Rather than let that leave Controversial empty, it's scored by **"the
ratio"** (replies ≫ likes) today, with downvotes folded into the same pushback
term so it strengthens automatically as dissent appears. moot also makes
downvoting first-class — NIP-25 `-` with NIP-09 retraction on switch/toggle
(`app/components/PostActions.tsx`, verified end-to-end by
`scripts/verify-downvote.ts`). The scorers read `-` from anywhere on the network,
so moot's downvotes benefit every client, not just moot.

Hot-scale caveat: `weightedEngagement` is linear in engagement. If moot grows to
posts with thousands of trusted reactions, log-damp the engagement term (Reddit
does) so a viral post can't camp the top. A non-issue at today's WoT-filtered
scale (peak ~10–18).

### Feeds published (v1) — built, pending live publish

`scripts/dvm-publish.ts` (on the shared `scripts/feed-build.ts` pipeline) builds
and publishes one **`kind:6300` per sort**, each tagged `["t","moot-<sort>"]`:
`moot-hot`, `moot-top`, `moot-rising`, `moot-controversial` (New stays
client-side). moot's reader selects one with `readLatestDvmFeed(ndk, dvm, tag)`
(the `#t` filter added to `lib/dvm.ts`). A NIP-89 `kind:31990` announcement
(`d=moot-feeds`, `k=5300`) makes the DVM discoverable. The publisher **verifies
every feed reads back** through moot's own reader before exiting.

Identity: `npub1null3tev8…` — nsec in 1Password (`3dl-ops / moot-dvm nostr
identity`), to become the `NOSTR_NSEC` GitHub Actions secret in the `moot-dvm`
repo. Dry-run validated (`--dry`): 250 candidates → hot 100 / top 63 / rising 53
/ controversial 37. Live publish is gated on an `op signin` to read the key.

Remaining plumbing: create the public `moot-dvm` repo, add the cron workflow
(persist the rising snapshot as a run artifact for real velocity), inject the
secret. `moot-hot/<topic>` community feeds are a later addition.

## Model B — personalized feeds (later)

Per-user home (your follows + joined communities, hot-ranked). Same `lib/rank.ts`
objective; only the **candidate set** (the requesting user's follows/communities)
and the **WoT anchor** (the requesting user) differ. Delivered as an on-demand
`kind:5300 → 6300` job (`requestDvmFeed`, already in `lib/dvm.ts`). Requires an
always-on responder; out of scope for now. **The scoring core is built to be
reused unchanged** — if B needs rework, it's the collection layer, not the math.

## The spike — `scripts/rank-spike.ts` (quality gate)

Runs the exact `lib/rank.ts` objective over **live relay data** and prints the
ranked feed with a per-signal breakdown, next to today's naive "Top" for
contrast. This is the gate: we tune weights here until the output is *good*
before writing one line of cron.

```
node scripts/rank-spike.ts                    # 4h window, fiatjaf anchor
node scripts/rank-spike.ts --hours 8 --top 40
node scripts/rank-spike.ts --anchor npub1…    # WoT anchored on you
node scripts/rank-spike.ts --wot off          # see the anti-spam effect by contrast
```

Read the `∆ top-10 overlap with naive Top` line: low overlap means the objective
is doing real work; identical means the weights need tuning.

## Client integration (both models)

Behind a **feed-source seam**: the home view asks for "the ranked list," and the
source is either `readLatestDvmFeed(moot-hot)` (default), a user-picked DVM
(swappable "power algorithm" lens, surfaced up front — not buried under Explore),
or client-side `rankPosts` as the offline fallback. Same render path.

## Content policy — NSFW is an avenue, off the surface

Reddit's growth was powered in part by its NSFW underbelly. moot treats NSFW as a
**legitimate, first-class avenue that is never on the default surface** — present
for those who seek it, invisible to those who don't.

- **Read the labels (superset reader):** honor NIP-36 (`content-warning` tag),
  NIP-32 labels (`["l","nsfw"]` / content-warning namespaces), and NSFW-flagged
  NIP-72 communities. Don't reinvent classification — lean on self-labels + the
  same WoT the scorers use, not a pixel classifier.
- **Off the surface by default:** every default feed (Hot/Top/Rising/New/
  Controversial) and the global directory **exclude** content-warning/NSFW-labeled
  posts and NSFW communities. A new or logged-out user never encounters it.
- **A real avenue when opted in:** an explicit, sticky **"Show NSFW"** setting
  (with an age-ack) unlocks NSFW communities and NSFW-included feed variants.
  NSFW content stays **blurred with a reveal** even when included.
- **DVM side:** the publisher tags each feed's audience. Default `moot-*` feeds
  are SFW-filtered at publish time; opt-in `moot-*-x` variants include labeled
  NSFW. The classifier is label + community + WoT, never content inspection.
- **Conservative writer:** when moot *writes* NSFW, it sets NIP-36
  `content-warning` so every other client can gate it too.

Tracked as its own build (`moot`-board) — it touches feed filtering, the
community directory, a settings toggle, and the DVM. A moderation section in
[design.md](design.md) is the downstream doc cascade.

## Interop invariant

The DVM is a **conservative writer**: standard NIP-90 `kind:6300` results and a
NIP-89 `kind:31990` announcement, so any Nostr client can read moot's feed. We
add no proprietary convention. (See [design.md](design.md#interop-invariant-do-not-break).)

## Open decisions / risks

- **WoT anchor for the global feed — DECIDED: engagement-seeded, algorithmic.**
  Not one curator's follows. The trust graph is derived from who earns genuine
  engagement *from already-trusted accounts* — i.e. personalized PageRank /
  EigenTrust over the follow+engagement graph. Two hazards the publisher must
  handle: (1) **bootstrap** — you need *some* initial trust to compute
  engagement-based trust, so seed from a small broad set and iterate; (2)
  **gaming** — engagement is botnet-forgeable, so the engagement used to grow the
  graph must itself be WoT-weighted (strangers barely move it), exactly as the
  scorers already do. This is the core design work of `moot-fe8`/`moot-126`.
- **Cron punctuality.** GitHub scheduled runs can be delayed under load and
  auto-disable after 60 days of repo inactivity. Monitor freshness; Azure timer
  is the fallback if it bites.
- **Reply attribution.** The spike counts any `kind:1`/`kind:1111` referencing a
  post as a reply (matches `fetchEngagementScores`); quotes are a small source of
  noise. Tighten with `parentId` if it matters.
- **Key custody.** The DVM's nsec is a GitHub Actions secret. Rotate-able;
  compromise only lets an attacker publish feeds under the DVM identity.
