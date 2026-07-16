# moot — Operations

Runbook for hosting, DNS, deploys, and the local work board. Design rationale is
in [design.md](./design.md).

## Hosting topology

| Concern | Where | Notes |
|---------|-------|-------|
| App hosting | **GitHub Pages** | Static export, org convention (matches `website` repo). Repo `3dl-dev/moot` is public; Pages access is public. |
| Build/deploy | **GitHub Actions** | `.github/workflows/deploy.yml`, Pages `build_type: workflow`. |
| DNS | **Azure DNS** | Zone `moot.pub` in resource group `moot-rg` (subscription "3DL Incubator", tenant 3dl.dev). |
| TLS | **GitHub Pages managed cert** | Auto-provisioned + auto-renewed once the custom domain is bound. |

moot has **no backend** — nothing to host beyond the static bundle. See the
hosting-evolution note in [design.md](./design.md#hosting-evolution) for the
Phase 4 SSR → Azure Container Apps path.

## DNS (Azure zone `moot.pub`)

Authority is delegated from the registrar to Azure name servers
(`ns1-09.azure-dns.com`, `.net`, `.org`, `.info`). Records:

| Name | Type | Value | Purpose |
|------|------|-------|---------|
| `@` | A | `185.199.108–111.153` | GitHub Pages apex |
| `@` | AAAA | `2606:50c0:8000–8003::153` | GitHub Pages apex (IPv6) |
| `www` | CNAME | `3dl-dev.github.io` | www → Pages |

Inspect / change:

```bash
az network dns record-set list -g moot-rg -z moot.pub -o table
az network dns zone show -g moot-rg -z moot.pub --query nameServers -o tsv   # NS for delegation
```

## Deploy pipeline

Push to `main` → `.github/workflows/deploy.yml`:

1. **build** — checkout, `setup-node` (**Node 24 LTS**), `npm ci`, `npm run
   build` (static export → `out/`), upload Pages artifact.
2. **deploy** — `actions/deploy-pages`.

`public/CNAME` (`moot.pub`) binds the custom domain; `public/.nojekyll` keeps the
`_next/` dir from being stripped by Jekyll.

```bash
# Watch the latest run
gh run watch "$(gh run list --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
# Manual redeploy
gh workflow run deploy.yml
```

> ⚠️ **Gap (tracked in rd):** the workflow does **not** run the test suite before
> deploying — a red suite can still ship. See the "Gate the Pages deploy on the
> test suite" item under the CI/CD epic.

### Custom domain / TLS

Custom domain + cert are managed via the Pages API:

```bash
gh api repos/3dl-dev/moot/pages --jq '{cname,https_enforced,cert:.https_certificate.state}'
gh api -X PUT repos/3dl-dev/moot/pages -f cname=moot.pub          # (re)bind domain
gh api -X PUT repos/3dl-dev/moot/pages -F https_enforced=true     # force HTTPS
```

Cert provisions a few minutes after DNS resolves to the Pages IPs. `ssl_verify=0`
from `curl -w` means success.

### Rollback

Pages serves the last successful deploy. To roll back, revert the offending
commit on `main` (or `git revert`) and push — the workflow redeploys the prior
state. There is no stateful backend to migrate.

## Node LTS & action-version cadence

Node's even-numbered majors go LTS each October. The workflow pins **Node 24**
(Active LTS, EOL **2028-04-30**) and current action majors (`checkout@v7`,
`setup-node@v7`, `upload-pages-artifact@v5`, `deploy-pages@v5`). Before Node 24
nears EOL — or when a Node-runtime deprecation annotation reappears — bump
`node-version` and the pinned action majors together. Tracked in rd under the
CI/CD epic.

## NIP-05 handles (`name@moot.pub`)

Curated identity verification lives in `public/.well-known/nostr.json` (served
at `https://moot.pub/.well-known/nostr.json`). GitHub Pages sends
`Access-Control-Allow-Origin: *` on static assets — the header NIP-05 requires —
and `.nojekyll` (in `public/`) keeps Pages from stripping the `.well-known`
dot-folder. This is **identity/verification only, not auth**: it sits on top of
whatever signer the user already uses.

Registration is **curated**: to add `alice@moot.pub`, add her hex pubkey under
`names` (and optionally her relays under `relays`) and merge — the deploy
publishes it. Seeded with moot's own identity (`_` and `moot` → the moot DVM
pubkey). Verify a handle resolves with:

```bash
curl -s "https://moot.pub/.well-known/nostr.json?name=moot" | jq .
# or paste name@moot.pub into njump.me / an Amethyst NIP-05 check
```

Self-serve registration (backed by the deferred Azure identity service) is
tracked separately under the auth epic.

## Work tracking (rd — local-only board)

Work items live in a **local-only** `rd` board (rd ≥ v0.12, nostr-native):

- Source of truth is the append-only signed-event log `.ready/nostr-log.jsonl`.
- **Local-only:** `.ready/config.json` sets `relay_endpoints: []` (overriding the
  global LAN relays in `~/.config/rd/rd.json`), so nothing syncs off-machine.
- `.ready/` is **git-ignored** — the board stays on this machine and off the
  public repo.

```bash
rd ready                 # actionable items
rd list                  # all open items
rd dep tree <epic-id>    # an epic and its children
rd show <id>             # full item spec (self-contained)
rd claim <id>            # start work
rd close <id> --reason "..."
```

The board mirrors the README roadmap as six epics (Phase 2 — Daily driver,
Anti-spam hardening, Phase 3 — Community moderation, Phase 4 — Reach, Deferred
Phase 1 polish, CI/CD & hosting follow-ups).

## Azure quick reference

```bash
az account show --query name -o tsv                 # -> 3DL Incubator Subscription
az group show -n moot-rg -o table
az resource list -g moot-rg -o table                # DNS zone is the only resource
```

The earlier Azure **Static Web App** (`moot-swa`) was torn down in favor of
GitHub Pages; `moot-rg` should contain only the DNS zone.
