@AGENTS.md

# moot — Project Guide

moot.pub is a Nostr-native two-pane discussion app (Squabbles format). Live at
**https://moot.pub**. Pure client-side SPA on Nostr — no backend.

## Read these first

- **[docs/design.md](docs/design.md)** — architecture, the interop invariant,
  anti-spam strategy, ranking, hosting evolution. Read before changing anything
  that touches Nostr event handling.
- **[docs/operations.md](docs/operations.md)** — hosting (GitHub Pages), DNS
  (Azure `moot.pub`), the deploy pipeline, Node-LTS cadence, and the rd board.
- **[README.md](README.md)** — narrative roadmap (Phases 0–4).

## The one rule that matters most

moot is a **superset reader, conservative writer**: READ every threading
convention (NIP-10 *and* NIP-22), WRITE the conservative one (NIP-22 replies,
`kind:1` top-level). When in doubt, add *reader* support before *writing* a new
convention. Full invariant in [docs/design.md](docs/design.md#interop-invariant-do-not-break).
Breaking it silently fragments moot from the rest of the Nostr network.

## Work tracking — local-only rd board

Work lives in a **local-only** `rd` board (rd ≥ v0.12), not GitHub Issues. The
board is git-ignored and does not sync off-machine (see
[docs/operations.md](docs/operations.md#work-tracking-rd-local-only-board)).

```bash
rd ready              # what's actionable now — start here
rd dep tree <epic>    # an epic and its children
rd show <id>          # full self-contained spec
rd claim <id>         # start work
rd close <id> --reason "..."
```

Six epics mirror the roadmap: Phase 2 — Daily driver, Anti-spam hardening,
Phase 3 — Community moderation, Phase 4 — Reach, Deferred Phase 1 polish, CI/CD &
hosting follow-ups. New work → new rd item; don't let the board drift from
reality.

## Testing

Tests run with the built-in Node runner: `node --test *.test.ts` (community,
dvm, mentions, scores, thread). **All green before you push** — every push to
`main` deploys to production. The deploy workflow does not yet gate on tests
(tracked in the CI/CD epic), so the green bar is on you until it does.

## Building & running

```bash
npm run dev     # http://localhost:3000
npm run build   # static export → out/ (type-checked)
node --test *.test.ts
```

Next.js here has breaking changes vs. training data — consult
`node_modules/next/dist/docs/` before using an unfamiliar API (see the top of
this file).

## Source of truth

When artifacts disagree, resolve in this order:

1. **The live Nostr network / NIP specs** — interop behavior is defined by what
   other clients actually read/write, not by our assumptions.
2. **docs/design.md** — architecture and invariants.
3. **The rd board** — what to do next.
4. **README.md** — narrative roadmap (may lag the board).

Flag conflicts explicitly; never silently adopt a diverging behavior.
