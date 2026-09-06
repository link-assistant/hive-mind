# Measurement — router route surface, `0.119.0` vs `1.2.0`

Collected **2026-09-04** with
[`experiments/issue-2202/compare-router-routes.sh`](../../../../../experiments/issue-2202/compare-router-routes.sh),
which starts each image **exactly the way Hive Mind starts it**
(`src/router-sidecar.lib.mjs` → `buildRouterSidecarRunArgs`: `ROUTER_PORT=443`,
`TOKEN_SECRET`, `DATA_DIR`, `AUDIT_LOG`, `TLS_SELF_SIGNED=1`,
`TLS_SELF_SIGNED_DNS=link-assistant-router,api.github.com`, then
`serve --host 0.0.0.0 --port 443`) and probes each path from inside the
container over TLS.

A synthetic `GH_CONFIG_DIR` holding a `hosts.yml` with a fake `oauth_token` is
mounted for both runs. That is load-bearing: **the GitHub routes are registered
only when a GitHub credential is present.** Without the mount every
GitHub-shaped path answers `404` on both versions, which reads identically to
"route removed" and is how a first pass at this measurement misread `1.2.0`.

Read the status codes as:

- **`401`** — the route exists; the router is asking for a client token. This is
  the success signal for a probe with no credential.
- **`404`** — no such route on this build.
- **`200`** — the route exists and needs no authentication (health only).

## Result

| Path                                                          | `0.119.0` | `1.2.0` |
| ------------------------------------------------------------- | --------- | ------- |
| `/health`                                                     | **200**   | 404     |
| `/api/health`                                                 | 404       | **200** |
| `/v1/models`                                                  | **401**   | 404     |
| `/v1/messages`                                                | **401**   | 404     |
| `/v1/responses`                                               | **401**   | 404     |
| `/api/services/anthropic/v1/models`                           | 404       | **401** |
| `/api/services/openai/v1/models`                              | 404       | **401** |
| `/api/services/codex/v1/models`                               | 404       | **401** |
| `/api/services/qwen/v1/models`                                | 404       | **401** |
| `/api/services/gemini/v1beta/models`                          | 404       | **401** |
| `/api/v3/rate_limit`                                          | **401**   | 404     |
| `/api/graphql`                                                | **401**   | 404     |
| `/git/link-assistant/hive-mind/info/refs`                     | **401**   | 404     |
| `/api/services/github/api/v3/rate_limit`                      | 404       | **401** |
| `/api/services/github/api/graphql`                            | 404       | **401** |
| `/api/services/github/git/link-assistant/hive-mind/info/refs` | 404       | **401** |
| `/api/management/tokens`                                      | 404       | **401** |

Raw output: [`ci-logs/compare-router-routes.log`](../../../../../ci-logs/compare-router-routes.log)
(not committed; regenerate with the script above).

## What this establishes

1. **The two route dialects are disjoint.** Every path that answers on `0.119.0`
   is gone on `1.2.0` and vice versa — there is no overlap column. This confirms
   the upstream 1.0.0 changelog entry ("Remove all legacy root, `/v1/*`, and
   overlapping `/api/*` aliases") empirically rather than by reading it. The
   practical consequence: **bumping `ROUTER_SIDECAR_IMAGE` without migrating the
   URLs, or migrating the URLs without bumping the pin, breaks `--use-router`
   completely.** They are one atomic change.

2. **The live model catalogues that requirement R2 needs exist only on `1.x`.**
   All five `/api/services/*/models` routes answer `401` on `1.2.0` and `404` on
   `0.119.0`. On `0.119.0` the equivalent is the single root `/v1/models`.

3. **`gh` loses REST and GraphQL mediation on `1.x`.** `/api/v3/*` and
   `/api/graphql` — the shapes `gh` actually emits — answer on `0.119.0` and are
   gone on `1.2.0`, where the proxy lives under `/api/services/github/api/…`.
   `gh` builds a custom host's REST base as `https://<host>/api/v3/` and exposes
   **no path-prefix option**; the router's own release notes state this twice
   (`data/upstream/router-releases-since-0.119.0.md`, lines 1641 and 1649). So
   no client-side configuration can reach the new prefix. This is a real
   capability loss for `gh` specifically, and it is why the pin bump is not a
   one-line change — see G1 and Part 7 of [`../../README.md`](../../README.md).

4. **`git` is unaffected beyond the path change.** `url.<prefix>.insteadOf`
   accepts an arbitrary URL prefix, so `…/git/` simply becomes
   `…/api/services/github/git/`.

5. **The health probe must move.** `checkRouterSidecarHealth` in
   `src/router-sidecar.lib.mjs` fetches `/health`, which is a `404` on `1.x`.

## Companion probes

| Script                                                | Purpose                                                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `experiments/issue-2202/probe-router-1.2.0.sh`        | first pass: 13 paths on `1.2.0` plus `serve --help`, `auth --help`, `tokens --help`, capturing which flags and subcommands actually exist |
| `experiments/issue-2202/probe-router-github-routes.sh` | isolates the credential dependency above — same paths, with and without a mounted `hosts.yml`                                            |
| `experiments/issue-2202/compare-router-routes.sh`     | the side-by-side table on this page                                                                                                     |
