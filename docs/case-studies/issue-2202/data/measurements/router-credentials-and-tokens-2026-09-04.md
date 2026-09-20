# Measurement — does router `1.x` change how Hive Mind wires credentials and mints tokens?

Collected **2026-09-04** with
[`experiments/issue-2202/probe-router-auth-adoption.sh`](../../../../../experiments/issue-2202/probe-router-auth-adoption.sh)
and
[`experiments/issue-2202/probe-router-tokens-1.2.0.sh`](../../../../../experiments/issue-2202/probe-router-tokens-1.2.0.sh),
against `ghcr.io/link-assistant/router:1.2.0`.

Requirement R3 says the router "should be initialized, mapped, and mounted with
claude and codex credential files/folders". `--use-router` (issue #2164) already
does that by mounting `~/.claude` at `/data/claude` with
`CLAUDE_CODE_HOME=/data/claude` (and the same for `.codex`, `.gemini`, `.qwen`).
Router `1.x` added `router auth claude --from-claude-home`, `auth codex
--from-codex-home` and `auth import <provider>`, so the question this answers is
whether the mount is still sufficient or an explicit adoption step is now
**required**.

Both probes use **synthetic credentials**. That is enough, because the property
under test is whether the router *finds and registers* a credential — a fake one
that is found reports as rejected by the vendor, while one that is not found
reports as absent. The two are unambiguous in the output.

## Result 1 — the mount is still the wiring; `auth import` is the wrong tool for it

Startup log, with `~/.claude` and `~/.codex` mounted the way Hive Mind mounts
them and nothing else done:

```
INFO link_assistant_router: Subscription home (claude): /data/claude
INFO link_assistant_router: Subscription provider claude: reading credentials from /data/claude
INFO link_assistant_router: Subscription provider codex: reading credentials from /data/codex
INFO link_assistant_router: Subscription provider gemini: reading credentials from /root/.gemini
INFO link_assistant_router: Subscription provider qwen: reading credentials from /root/.qwen
```

`router auth status` in the same container:

```
claude   refresh-failed /data/claude
codex    rejected   /data/codex
gemini   absent     /root/.gemini
qwen     absent     /root/.qwen
```

`refresh-failed` and `rejected` are the **found** verdicts — the router read the
synthetic documents, tried them upstream and was turned down, which is the
correct outcome for a fake token. `absent` is the not-found verdict, and it is
what the two unmounted providers report. So a mount alone registers a provider
on `1.x` exactly as it does on `0.119.0`.

Running the adoption command anyway:

```
$ router auth import claude
error: no claude credential to import: No claude credential file found in /root/.claude

$ router auth import codex
error: no codex credential to import: No codex credential file found in /root/.codex
```

An unqualified import reads the **vendor's** home (`/root/.claude`), not the
router's — this is the behaviour the `1.1.0` release notes describe as a fix,
since `CLAUDE_CODE_HOME` "in a deployment name the *destination*". In Hive
Mind's layout there is nothing at `/root/.claude`, so an adoption step would
fail with no credential to adopt while the mounted one is already serving.

**Conclusion for R3.** The "initialized, mapped, and mounted with claude and
codex credential files/folders" mode of operation is supported, is what #2164
already implements, and needs no new call. Adding `router auth import` to the
sidecar startup would be a no-op at best and a spurious startup error at worst.
Recorded here so the option is not re-litigated from the release notes alone.

## Result 2 — `tokens issue` and `tokens list` are unchanged over `docker exec`

`1.2.0` prints a bootstrap admin token at startup and logs "admin endpoints are
closed", which raises the question of whether the in-container CLI now needs
that token. It does not — `issueRouterTaskToken`'s exact argv works:

```
$ router tokens issue --label hive-mind-probe --max-tokens 100000 --rate-limit-per-minute 60
la_sk_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9…

$ router tokens list
id                                    issued_at   … rpm  scope   label
6c6ad5b0-…                            1788552117  … 60   client  hive-mind-probe
67ceafcc-…                            1788552114  … -    admin   bootstrap-admin
```

`--github-repo link-assistant/hive-mind` also still scopes a token; the minted
JWT carries `"github_repos":["link-assistant/hive-mind"]` in its payload.

**Conclusion for R4.** Token minting, listing and scoping survive the dialect
change untouched. The `--use-router` lease lifecycle needs no work for `1.x`;
only the *routes* differ, which is what `src/router-routes.lib.mjs` handles.

## Result 3 — the `1.x` catalogue envelope is richer than OpenAI's

With a minted client token, `GET /api/services/anthropic/v1/models` and
`/api/services/codex/v1/models` both answer `200` with:

```json
{
  "catalog_conflicts": [],
  "data": [],
  "degraded_providers": [],
  "degraded_reasons": {},
  "healthy_providers": [],
  "object": "list",
  "using_fallback": false
}
```

`data` is empty because the synthetic credential was rejected upstream — the
startup log shows the matching `failed to refresh claude model catalog: HTTP 401
… (credential is stamped expired; last known catalog retained)`.

Two things matter for R2 and R9:

1. **The router maintains its own model catalogue and caches it.** It refreshes
   per provider at startup and retains the last known catalogue when a refresh
   fails. Hive Mind's cache therefore sits on top of a cache, and the router —
   not Hive Mind — is the component that knows whether a catalogue is current.
2. **The envelope says so explicitly.** `using_fallback`, `degraded_providers`
   and `degraded_reasons` are exactly the freshness signal `/models` (R5) should
   surface, rather than presenting a stale catalogue as live. A reader that
   only picks `data[].id` out of this response throws that away.

So the `openai` response shape is a safe *parse* of this route, but the
catalogue reader should keep the degradation fields where present. Note this is
a superset, not a different shape: `data` and `object` are in their OpenAI
positions, so one parser handles both dialects.
