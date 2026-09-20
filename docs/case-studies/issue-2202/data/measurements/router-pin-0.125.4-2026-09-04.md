# Measurement — moving the pin from `0.119.0` to `0.125.4`

Collected **2026-09-04**. Three probes, each run against both images with the
arguments `src/router-sidecar.lib.mjs` actually uses:

| Probe                                                                                                                | Question                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`compare-router-routes.sh`](../../../../../experiments/issue-2202/compare-router-routes.sh)                          | do the same routes exist?                                    |
| [`probe-router-token-lease.sh`](../../../../../experiments/issue-2202/probe-router-token-lease.sh)                    | does the per-task token lease still mint, list, revoke, pass? |
| [`probe-router-auth-adoption.sh`](../../../../../experiments/issue-2202/probe-router-auth-adoption.sh)                | is a mounted subscription still found the same way?          |

## Why move at all

`0.119.0` cannot reach the newest Codex models. The `version` header that the
ChatGPT backend gates them behind landed in **v0.120.0**, one release *after* the
pin ([`../upstream/router-releases-since-0.119.0.md`](../upstream/router-releases-since-0.119.0.md),
line 875):

> Codex subscriptions now send a `version` header (default `0.144.1`,
> overridable via `CODEX_CLIENT_VERSION`) when proxying to the ChatGPT backend.
> The backend gates newer models (e.g. `gpt-5.6-luna`) behind a recent client
> version; without the header `POST /responses` returns `Model not found`. This
> mirrors the Codex CLI so newer models are usable through the router.

So on the old pin a routed Codex task is told a model does not exist when it
does — which is requirement R1 ("support all new models") failing inside the
feature R4 asks us to re-check.

`0.125.4` is the highest `0.x` release, which matters because the `gh` gap
(G4 / [router#415](https://github.com/link-assistant/router/issues/415)) is what
keeps the default off `1.x` at all: it is the newest image that still speaks the
**legacy** dialect and therefore still mediates `gh`.

## Result 1 — the route surface is identical

Raw: [`ci-logs/compare-router-0.119.0-vs-0.125.4.log`](../../../../../ci-logs/compare-router-0.119.0-vs-0.125.4.log)
(not committed; regenerate with the script above).

All 17 probed paths answer with the same status on both images — `/health` 200,
the four legacy `/v1/*` and GitHub paths 401, every canonical path 404:

| Path                                      | `0.119.0` | `0.125.4` |
| ----------------------------------------- | --------- | --------- |
| `/health`                                 | 200       | 200       |
| `/v1/models`                              | 401       | 401       |
| `/v1/messages`                            | 401       | 401       |
| `/v1/responses`                           | 401       | 401       |
| `/api/v3/rate_limit`                      | 401       | 401       |
| `/api/graphql`                            | 401       | 401       |
| `/git/link-assistant/hive-mind/info/refs` | 401       | 401       |
| `/api/health` and all `/api/services/…`   | 404       | 404       |

`0.125.4` is a **legacy-dialect** image. `resolveRouterRouteDialect` reaches that
conclusion from the tag's major version alone, so the bump needs no dialect
change and no URL change anywhere in the codebase.

## Result 2 — the per-task token lease is unchanged

Raw: [`ci-logs/probe-token-lease-0.119.0-vs-0.125.4.log`](../../../../../ci-logs/probe-token-lease-0.119.0-vs-0.125.4.log).

This probe exists because `0.125.4` lists a real authorization change — "bind
each managed launch to a signed client kind and subscriber principal … deny
generic or administrative tokens access to consumer subscriptions unless an
exact operator-approved client/provider override exists (#389)" — and Hive Mind
mints its token with `router tokens issue`, which declares no client kind. The
changelog raises the question; only the measurement answers it.

Every step matched, on both images:

| Step (`issueRouterTaskToken` / `revokeRouterTaskToken`)             | `0.119.0`                   | `0.125.4`                   |
| -------------------------------------------------------------------- | --------------------------- | --------------------------- |
| `tokens issue --label hive-mind:<id> --ttl-hours 12 --max-requests …` | `la_sk_…`, 249 chars        | `la_sk_…`, 249 chars        |
| `tokens issue … --github-repo <owner/repo>`                          | minted                      | minted                      |
| `tokens list` shows both leases                                      | 2                           | 2                           |
| `decodeRouterTokenId` reads the `sub` claim                          | a UUID                      | a UUID                      |
| `tokens revoke <id>`                                                 | ok                          | ok                          |
| the minted token on `/v1/models`                                     | **200**                     | **200**                     |
| on `/v1/messages` (GET)                                              | 405                         | 405                         |
| on `/api/v3/rate_limit`                                              | 401 GitHub `Bad credentials` | 401 GitHub `Bad credentials` |
| on `/git/<repo>/info/refs`                                           | 401                         | 401                         |

The GitHub `401`s are the synthetic `oauth_token` being rejected by GitHub — the
router forwarded the call, which is the point of the probe.

**A second finding, for R2.** With a valid Hive Mind token, `/v1/models` answers
`200` on the *legacy* dialect with the same superset-of-OpenAI envelope the
`1.x` catalogue routes return:

```json
{"data":[],"degraded_providers":[],"degraded_reasons":{},"healthy_providers":[],"object":"list","using_fallback":false}
```

`data` is empty here only because the probe mounts no working subscription. So
the live catalogue R2 wants does **not** require moving to `1.x`: the pinned
image already serves it at `/v1/models`, and
`buildRouterCatalogueEndpoints(legacy)` already points there.

## Result 3 — a mounted subscription is found the same way

Raw: [`ci-logs/probe-auth-0.119.0-vs-0.125.4.log`](../../../../../ci-logs/probe-auth-0.119.0-vs-0.125.4.log).

`0.125.4` reworked credential import to "fail closed" (#385), so the mount
wiring was re-probed. Both images log `Subscription provider claude: reading
credentials from /data/claude` and the same for `codex`, leave the unmounted
`gemini`/`qwen` on `/root/…`, and still answer `router auth import claude` with
`No claude credential file found in /root/.claude` — the import reads the
*vendor's* home, not the router's, so it remains the wrong tool for a mount.

The one wording change: `auth status` reports the synthetic claude credential as
`refresh-failed` on `0.125.4` where `0.119.0` said `rejected`. Both mean found
and unusable; nothing in Hive Mind parses that column.

`0.125.4` also refreshes a per-provider **model catalog** at startup and
"retain[s] the last known catalog" when a refresh fails — visible in both logs,
and the behaviour behind `using_fallback` in the envelope above.

## What else the bump carries

From the same changelog, between the two pins, the entries that touch how Hive
Mind runs the sidecar:

- **`serve` handles `SIGTERM`** (#334, v0.122.0). Only `ctrl_c` was awaited
  before, and as PID 1 the kernel applies no default action — so `docker stop`,
  which is exactly how `stopRouterSidecar` ends the container, waited out the
  full grace period and then `SIGKILL`ed it. Every sidecar teardown on the old
  pin costs 30 seconds and severs in-flight streams.
- **A per-run token's expiry slides while the session is in use** (#354,
  v0.124.0), and the default window is a week. Hive Mind sets its own
  `--ttl-hours`, so this is headroom rather than a change.
- **Minting is roughly three times faster** and listing no longer rewrites the
  store (#351, #356, #357) — `issueRouterTaskToken` runs once per task and
  `tokens list` runs during reconciliation.
- **An empty `HOME`/`XDG_CONFIG_HOME` is no longer treated as a configured
  value** (#340, v0.122.0) — it made the router write `server.json`, holding a
  live `la_sk_` token, into the current directory.
- **An absent container is recognised however Docker spells it** (#333) —
  `no such object` vs `No such object`, which broke `with` on Docker Desktop.

## Conclusion

The bump is behaviour-preserving on every axis Hive Mind depends on — routes,
health path, dialect, token lease, credential mounts — and it removes a real
capability loss (new Codex models) plus a 30-second teardown stall. The pin moves
to `0.125.4`; `1.x` remains opt-in through `HIVE_MIND_ROUTER_IMAGE` and remains
blocked as a default by G4 / router#415.
