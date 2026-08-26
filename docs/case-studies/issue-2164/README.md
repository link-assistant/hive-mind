# Issue #2164 — `--use-router`: one audited proxy for every task's AI, `gh` and `git` traffic

## Executive summary

Today a Docker-isolated Hive Mind task is handed the operator's _actual_
subscription: `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents`,
`~/.config/gh` and `~/.gitconfig` are bind-mounted straight into the container
by `getDockerIsolationAuthMounts()` (`src/isolation-runner.lib.mjs:125`). An
agent inside that container therefore holds the raw vendor OAuth credential and
the raw GitHub token. It can spend the subscription without limit, it can call
any GitHub API including `DELETE`, and the only record of what it did is
whatever the agent itself chose to write into its own log.

Issue #2164 asks for the opposite arrangement, behind an opt-in experimental
flag: the credentials stay in one `hive-mind-router` container, each task gets
its own short-lived `la_sk_…` token, every request is logged per task in a
preserved data folder, destructive GitHub operations are refused, and the router
container only exists while at least one task needs it.

This case study establishes four things.

1. **The Hive Mind side is fully designed and unblocked.** The credential seam
   is one function; the on-demand, lease-counted, internal-network sidecar with
   bot-driven idle shutdown already exists for Formal AI
   (`src/formal-ai-sidecar.lib.mjs`, `src/formal-ai-maintenance.lib.mjs`) and is
   a direct template. 13 of the 17 requirements need no upstream change.
2. **Link.Assistant.Router already implements most of what the issue assumes.**
   Per-task tokens with TTL/request/token/rate caps, per-token redacted JSONL
   request logs, mountable vendor credential homes for Claude _and_ Codex
   _and_ Gemini _and_ Qwen, a persisted `DATA_DIR`, a GitHub API proxy that
   denies deletions and forced ref updates **by default**, and a `router logs`
   diagnostic command. Evidence for each is quoted in Part 2.
3. **Three requirements were blocked upstream**, and a fourth path (`gh`) needed
   an upstream change to work by default; per the issue's own rule
   ("If … router has missing features … we should first report issues there")
   they were reported to `link-assistant/router` before the corresponding code
   landed here. They are: routing `--model formal-ai` through the same router
   without pinning the whole deployment (G1), containing destructive operations
   that travel over the **git transport** rather than the GitHub API (G2),
   scoping the GitHub credential per task rather than per deployment (G3), and
   reaching the router from `gh`, which refuses a plaintext custom host (G4).
   **All four were fixed upstream on 2026-08-21 and shipped in `v0.106.0`–`v0.109.0`**;
   the measurements below were taken against `v0.109.0`, which produced three
   further upstream reports (#270, #271, #272) — all since fixed. The pin has
   since moved to `v0.119.0`; see [Post-upgrade re-audit](#post-upgrade-re-audit-2026-08-26).
4. **One requirement is a documentation deliverable in its own right** — a
   system-wide "how to collect logs" guide (R15), which this repository does not
   have today (`ls docs/ | grep -i log` returns nothing).

The honest headline: `--use-router` is delivered as a _credential_ isolation
feature and, after the upstream fixes, as a _destructive-action_ containment
feature for git. As written this section said "for everything except a force
push, which the router still forwards ([router#272](https://github.com/link-assistant/router/issues/272))";
that was true of `v0.109.0` and stopped being true on the same day, in
`v0.110.0`. What remains uncontained is narrower and lives on the API side
rather than the git side: destructive GitHub calls spelled as `PUT`/`PATCH`/`POST`
([router#329](https://github.com/link-assistant/router/issues/329)). GitHub
branch protection — which Hive Mind already automates in `src/protect-branch.mjs`
and which the router's own README names as the required backstop — is itself
reachable through that gap, so it is a strong default rather than an
untouchable control. See [Post-upgrade re-audit](#post-upgrade-re-audit-2026-08-26).

## Scope and evidence

Everything in this analysis is derived from artifacts committed under
[`data/`](data), so a reader can re-check any claim without network access.
Checksums are in [`MANIFEST.md`](MANIFEST.md).

| Source                                          | Location                                                                                                                                                                                                                                                                                                                               | What it establishes                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue #2164 body and comment feed               | [`data/github/issue-2164.json`](data/github/issue-2164.json), [`issue-2164-comments.json`](data/github/issue-2164-comments.json)                                                                                                                                                                                                       | The verbatim requirement text; the comment feed is empty, so the body is the only specification.                                                                                                                                                                                                                            |
| PR #2165 and its three comment feeds            | [`data/github/pr-2165.json`](data/github/pr-2165.json), [`pr-2165-review-comments.json`](data/github/pr-2165-review-comments.json), [`pr-2165-conversation-comments.json`](data/github/pr-2165-conversation-comments.json)                                                                                                             | No review feedback exists yet; nothing has been requested beyond the issue.                                                                                                                                                                                                                                                 |
| Router README (69 KB, full)                     | [`data/upstream/router-README.md`](data/upstream/router-README.md)                                                                                                                                                                                                                                                                     | Every router capability quoted in Part 2 and every limitation quoted in Part 3.                                                                                                                                                                                                                                             |
| Router use-case docs                            | [`data/upstream/router-use-case-per-task-tokens.md`](data/upstream/router-use-case-per-task-tokens.md), [`…-with-router.md`](data/upstream/router-use-case-with-router.md), [`…-audit-and-monitoring.md`](data/upstream/router-use-case-audit-and-monitoring.md), [`…-self-hosting.md`](data/upstream/router-use-case-self-hosting.md) | The per-task token recipe, the token/server resolution order, and the audit surfaces.                                                                                                                                                                                                                                       |
| Router repo metadata, releases, full issue list | [`data/upstream/router-repo.json`](data/upstream/router-repo.json), [`router-releases.json`](data/upstream/router-releases.json), [`router-issues.json`](data/upstream/router-issues.json)                                                                                                                                             | Latest release at the time of the audit `v0.105.0` (2026-08-21T13:23:05Z); **all 139 issues were closed, none open** — the upstream is actively maintained and responsive, which is what makes the issue's "report upstream first" rule practical rather than a permanent block.                                            |
| Hive Mind code snapshots                        | [`data/hive-mind/`](data/hive-mind)                                                                                                                                                                                                                                                                                                    | The exact credential seam and the Formal AI sidecar template quoted in Part 1, pinned to commit `85e37937`.                                                                                                                                                                                                                 |
| Probe logs, redacted                            | [`data/measurements/`](data/measurements)                                                                                                                                                                                                                                                                                              | The measured behaviour of router `v0.109.0` quoted throughout Part 3 and Part 5: TLS interception of `gh`, the git transport, `formal-ai` as a stored provider, and the audit log. Produced by the scripts in [`experiments/issue-2164/`](../../../experiments/issue-2164); task tokens are replaced with `la_sk_REDACTED`. |
| Online research notes                           | [`data/research/online-research.md`](data/research/online-research.md)                                                                                                                                                                                                                                                                 | The external-component survey the issue asked for: FINOS GitProxy, LiteLLM virtual keys, `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` semantics.                                                                                                                                                                             |

## Requirements reconstructed

Every sentence of the issue body, split into an independently testable
requirement. The **State** column records where each one ended up after the
upgrade to router `v0.109.0`: "Delivered" means it is implemented in this pull
request and covered by a test, and any residual limit is named in the row
itself.

| #   | Requirement (issue wording condensed)                                                                                                                                  | Source sentence                                                                                                                                             | State                                                                                                                                                                                                                                                                                                                           | Where it is answered      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | Add a `--use-router` option                                                                                                                                            | "We should add `--use-router` option"                                                                                                                       | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R1               |
| R2  | With it, stop attaching claude/codex files to the task's Docker; reach a `hive-mind-router` container over the Docker network instead                                  | "instead of directly attaching claude/codex files to tasks' docker … access specific hive-mind-router docker on the docker network"                         | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R2               |
| R3  | The router must be **the only point of contact with the AI subscription**, with global claude/codex files mounted from the root Hive Mind container into it            | "mount claude/codex files and folders from root hive mind docker container to it, and it will be the only point of contact with AI subscription"            | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R3               |
| R4  | Verify the router actually supports that sync                                                                                                                          | "We also need to make sure https://github.com/link-assistant/router actually supports sync with global claude/codex files/folders"                          | **Done**                                                                                                                                                                                                                                                                                                                        | Part 2 · C3               |
| R5  | The Telegram bot keeps `hive-mind-router` running only while ≥1 task uses it                                                                                           | "our telegram bot must ensure we only keep hive-mind-router container running, when there any task that uses it"                                            | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R5               |
| R6  | One separately issued token per task, so each task has its own logs                                                                                                    | "For each separate task we should have separate token issued, so each task will have its own separate logs"                                                 | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R6               |
| R7  | On task finish, merge the task's claude/codex **session data** into the router or root container for security audit                                                    | "take claude/codex sessions data from it, and merge it to hive-mind-router container or root hive-mind container, as that may be needed for security audit" | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R7               |
| R8  | Mount a folder for the router data folder so all logs are preserved                                                                                                    | "mount a folder for router data folder, so all logs are preserved"                                                                                          | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R8               |
| R9  | Default keeps the current direct mount; `--use-router` isolates each task from direct subscription access                                                              | "By default we keep current mechanics … but when `--use-router` is enabled, we isolate each task"                                                           | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R9               |
| R10 | Mark the feature **experimental**                                                                                                                                      | "That feature should be marked experimental"                                                                                                                | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R10              |
| R11 | Support formal-ai routing with `--model formal-ai` through the same router/proxy                                                                                       | "it should also support formal-ai routing when used with `--model formal-ai`, so everything goes through the same router/proxy"                             | **Delivered** — the Formal AI sidecar is a stored router provider (its own upstream leg is still direct)                                                                                                                                                                                                                        | Part 3 · G1, Part 5 · R11 |
| R12 | Configure each task's `gh` and `git` to use the router                                                                                                                 | "configure each task's gh and git tools to use router"                                                                                                      | **Delivered** — `api.github.com` is intercepted transparently; git pushes through the router                                                                                                                                                                                                                                    | Part 5 · R12              |
| R13 | Block all delete operations and history changes (force push, `git reset` reaching a push) on `git push` **or** via the gh API                                          | "immediately apply block of all delete operations or history changes like git reset and so on detected up on git push, or used directly via gh API"         | **Delivered** for the git half in full (deletions, and force pushes from `v0.110.0` via [router#273](https://github.com/link-assistant/router/pull/273)); **partial** for the API half — destructive calls spelled `PUT`/`PATCH`/`POST` are still forwarded ([router#329](https://github.com/link-assistant/router/issues/329)) | Part 3 · G2, Part 5 · R13 |
| R14 | Make task/router logs accessible; double-check everything in that scope                                                                                                | "make sure we will be able to access logs of task/router … so we should also double check everything in that scope"                                         | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R14              |
| R15 | A dedicated docs section on collecting logs **throughout the system**, not just the router                                                                             | "special docs section about collecting logs though out of the system, not just for router"                                                                  | **Delivered**                                                                                                                                                                                                                                                                                                                   | Part 5 · R15              |
| R16 | Report missing router features upstream first; continue here once implemented                                                                                          | "If … router has missing features … we should first report issues there, once they are fully implemented we can continue"                                   | **Done** — #260–#263 filed and fixed upstream; #270–#272 filed for what the re-measurement found, all three fixed; #322, #323, #324, #329 filed in the 2026-08-26 re-audit                                                                                                                                                      | Part 3                    |
| R17 | Compile data to `docs/case-studies/issue-2164`, do deep analysis with online research, list every requirement, propose solutions and plans, survey existing components | final paragraph                                                                                                                                             | **This document**                                                                                                                                                                                                                                                                                                               | all parts                 |

## Part 1 — Where Hive Mind stands today

### 1.1 The credential seam is one function

`src/isolation-runner.lib.mjs:125` is the single place that decides what a task
container is allowed to see:

```js
export function getDockerIsolationAuthMounts({ tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = {}) {
  const mounts = [];
  const normalizedTool = normalizeTool(tool);
  maybeAddMount(mounts, env.GH_CONFIG_DIR || path.join(homeDir, '.config', 'gh'), …);
  maybeAddMount(mounts, env.GIT_CONFIG_GLOBAL || path.join(homeDir, '.gitconfig'), …);
  maybeAddMount(mounts, …path.join(homeDir, '.config', 'git'), …);
  if (normalizedTool === 'codex') {
    maybeAddMount(mounts, path.join(homeDir, '.codex'), …);
    maybeAddMount(mounts, path.join(homeDir, '.agents'), …);
  } else if (normalizedTool === 'claude') {
    maybeAddMount(mounts, path.join(homeDir, '.claude'), …);
    maybeAddMount(mounts, path.join(homeDir, '.claude.json'), …);
  }
  return mounts;
}
```

Its only caller for launch purposes is
`buildDockerIsolationStartArgs()` (`src/isolation-runner.lib.mjs:200`), which
turns each entry into a `--volume src:dst` pair for `$ --isolated docker`. That
is the whole surface `--use-router` has to change: **suppress the vendor
credential mounts, keep the git identity, and add environment variables that
point the CLI at the router**. Nothing else in the launch path needs to know.

The full snapshot is [`data/hive-mind/isolation-runner-auth-mounts.snippet.mjs`](data/hive-mind/isolation-runner-auth-mounts.snippet.mjs).

### 1.2 The sidecar Hive Mind already runs is the exact shape R5 asks for

`src/formal-ai-sidecar.lib.mjs` (588 lines) already implements, for Formal AI,
every lifecycle property issue #2164 wants for the router:

- a named container and an `--internal` Docker network with a stable network
  alias (`FORMAL_AI_SIDECAR_CONTAINER_NAME`, `…_NETWORK_NAME`, `…_NETWORK_ALIAS`,
  lines 59–67), so the sidecar has **no host-visible port**;
- an atomic JSON state file guarded by an exclusive lock
  (`withFormalAiSidecarLock`, line 181) holding a **lease list**, not a boolean;
- `acquireFormalAiSidecar()` (line 443) — start on demand, wait for `/health`
  via `docker exec … curl` _because_ the network is internal, then add a lease;
- `attachTaskToFormalAiNetwork()` — `docker network connect` **after** the
  container is created but while the start gate still holds the task command,
  because a single `docker run --network` would replace the default bridge and
  cut the task off from GitHub;
- `reconcileFormalAiSidecar()` (line 403) — drop leases whose task container is
  gone, so a crashed task cannot pin the sidecar forever;
- `releaseFormalAiSidecar()` — stop the sidecar when the last lease goes.

### 1.3 The bot already runs the idle-shutdown loop R5 describes

`src/telegram-bot.mjs:257` imports `startFormalAiMaintenance`, and
`src/formal-ai-maintenance.lib.mjs` runs one tick every five minutes whose
first duty is documented in exactly the words R5 uses:

> This is what turns "the task finished" into "the container is gone" without
> having to hook every completion path: a lease is only live while its task
> container is, so a finished, killed or crashed task all converge here.

So R5 is not a new mechanism — it is a second consumer of an existing one.

### 1.4 Hive Mind already automates the branch-protection backstop

`src/protect-branch.mjs` PUTs `allow_force_pushes: false` and
`allow_deletions: false` on the default branch. That is the only layer that
today can stop a force-push over the git transport, and Part 3 · G2 explains why
it must remain the backstop until the router grows a git-transport surface.

## Part 2 — What Link.Assistant.Router already provides

Evidence quoted from [`data/upstream/router-README.md`](data/upstream/router-README.md)
(line numbers refer to that file) and the use-case docs beside it.

| #   | Capability the issue assumes                                                              | Router status                                                                                                                                                                                                                                                                                          | Evidence                                                                                    |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| C1  | A separately issued token per task                                                        | **Yes.** `router tokens issue --ttl-hours … --label … --max-requests … --max-tokens … --rate-limit-per-minute …`, and the same shape over `POST /api/tokens`.                                                                                                                                          | README §"Per-token containment controls" (1248–1290); `router-use-case-per-task-tokens.md`  |
| C2  | Separate logs per task                                                                    | **Yes.** "Every HTTP request also writes a structured exchange to `$DATA_DIR/requests/<token-hash>/requests.jsonl` … carry the token hash, id, and label", with per-token size bounds so "one caller cannot evict another's history".                                                                  | README §"Logging" (955–963)                                                                 |
| C3  | Sync with **global claude/codex files/folders**, mounted from the root container (**R4**) | **Yes, for all four vendors.** `CLAUDE_CODE_HOME` (default `~/.claude`), plus `CODEX_HOME`/`GEMINI_HOME`/`QWEN_HOME` credential homes, plus `ADDITIONAL_ACCOUNT_DIRS` for pooling several accounts. Documented Docker form: `-v /path/to/claude-code-home:/data/claude:ro`.                            | README §Core config (647), §"Vendor subscriptions" (76–108), §"Run the container" (972–982) |
| C4  | The router being the _only_ point of contact with the subscription                        | **Yes.** "OAuth tokens from the Claude Code session are never exposed to clients"; the proxy "Validates the `Authorization: Bearer la_sk_...` … Replaces it with the real OAuth token".                                                                                                                | README §"Security notes" (1296–1304), §"Proxy Routes" (591–621)                             |
| C5  | A preserved data folder for audit (**R8**)                                                | **Yes.** `DATA_DIR` holds `tokens.lino`/`tokens.bin`, `providers.lenv` and `requests/`; `REQUEST_LOG` defaults to `$DATA_DIR/requests`; an optional `AUDIT_LOG` appends "one JSON line per authorised request (token id, label, provider, surface, path, model)".                                      | README §Core config (654–656), §"Routing & storage" (831)                                   |
| C6  | Blocking destructive GitHub **API** operations (**R13**, API half)                        | **Yes, by default.** "Deletion, forced REST ref updates, GraphQL mutations whose operation deletes an object, and forced GraphQL ref updates are denied by default." A blocked call returns `403` with `x-link-assistant-policy: blocked`. Confirmed in `src/github_proxy.rs::GitHubPolicy::decision`. | README §"GitHub API credential proxy" (696–702)                                             |
| C7  | Pointing `gh` at the router (**R12**, API half)                                           | **Yes.** `export GH_HOST=router.example.internal; export GH_ENTERPRISE_TOKEN="$LINK_ASSISTANT_TOKEN"`. The proxy supports "bare REST paths, GitHub CLI's custom-host `/api/v3/*` rewrite, and GraphQL at `/api/graphql` and `/graphql`".                                                               | README (660–667, 704–712)                                                                   |
| C8  | Configuring each agentic CLI against a router (**R2**)                                    | **Yes.** `router clients setup claude --token la_sk_…`, and the same for `codex`, `qwen`, `gemini`, `opencode`, `agent`, `grok`; `router clients doctor <client>` probes it.                                                                                                                           | README §"CLI subcommands" (920–931)                                                         |
| C9  | Log collection tooling for the router half of R14                                         | **Yes.** `router logs summary` and `router logs anomalies [--token <hash>] [--json]`, added upstream in issue #234 precisely because "hand-written greps over a 100 MB request log produce false positives and false negatives".                                                                       | `router-issues.json` #234; `router-use-case-audit-and-monitoring.md`                        |
| C10 | Running the router as a container with an in-container CLI for admin work                 | **Yes.** `ghcr.io/link-assistant/router:latest`, publicly pullable, with `router` on `PATH` inside the image (upstream #243), so `docker exec hive-mind-router router tokens issue …` is the supported admin path.                                                                                     | README §"Docker Deployment" (964–1010); `router-use-case-with-router.md`                    |
| C11 | Credential refresh surviving inside the container                                         | **Yes, with a caveat.** The router refreshes vendor OAuth in-process, but vendors **rotate** refresh tokens: "On a `:ro` mount the write is skipped with a logged warning … Mount the credential directory writable if you want rotation to survive restarts."                                         | README §"Credential lifecycle in a container" (984–1000)                                    |

C11 is the one that changes a design decision rather than merely confirming
one: mounting the operator's `~/.claude` **read-only** into `hive-mind-router`
is the intuitive choice and the wrong one. It must be writable, or a router
restart after a rotation forces a manual re-login of the operator's real
subscription.

## Part 3 — Gap analysis: what must be reported upstream first

The issue's rule is explicit: _"If https://github.com/link-assistant/router has
missing features for anything described, we should first report issues there,
once they are fully implemented we can continue delivering results on this task
here in this repository's pull request."_ These are the three gaps that rule
applies to. Each is stated with the requirement it blocks, the first-party
evidence that it is a real gap, the workaround available today, and the
behaviour to request.

### G1 — `--model formal-ai` cannot go through the router without pinning the whole deployment

**Reported upstream: [link-assistant/router#260](https://github.com/link-assistant/router/issues/260)
— fixed upstream and closed 2026-08-21 20:53 UTC, shipped in the releases this
PR pins (`v0.106.0`–`v0.109.0`), re-verified here by measurement.**

**Blocks R11** ("it should also support formal-ai routing when used with
`--model formal-ai`, so everything goes through the same router/proxy").

Formal AI is served over an OpenAI-compatible HTTP API by
`formal-ai serve --agent-mode`; Hive Mind already runs it as an internal-network
sidecar and injects `HIVE_MIND_FORMAL_AI_BASE_URL`. To make "everything go
through the same router", the router must be able to front that endpoint as one
more upstream.

The router can talk to an OpenAI-compatible upstream — but only by pinning:

> Generic OpenAI-compatible providers are used when
> `UPSTREAM_PROVIDER=openai-compatible`. (README line 761)

and automatic routing is a different mode that does not consider stored providers at all:

> the default `UPSTREAM_PROVIDER=auto` discovers healthy Claude, Codex, Gemini,
> and Qwen CLI credentials, exposes their model union, and routes each model to
> its owning subscription; **an explicit provider value pins all traffic**
> (README line 30)

> Requested model names pass through unchanged. **In automatic mode, routing uses
> only subscription catalogs** … (README line 487)

So a Hive Mind host that runs Claude tasks _and_ Formal AI tasks through one
`hive-mind-router` has no valid configuration: `auto` cannot reach the Formal AI
provider, and `openai-compatible` would send Claude tasks to Formal AI too.
`router providers add` already persists named provider records with their own
`models` list (README 795–828), so the missing piece is narrow — letting a
stored provider's advertised models participate in `auto` model-based routing
rather than requiring a global pin.

_Requested behaviour:_ a stored `openai-compatible` provider whose `models` are
merged into the `auto` catalog and routed by model name, so one deployment can
serve vendor subscriptions and a local OpenAI-compatible endpoint at once.

**Resolution, measured against `v0.109.0`** — the analysis above described
`v0.105.0`; the requested behaviour now exists.
[`experiments/issue-2164/probe-formal-ai-provider.sh`](../../../experiments/issue-2164/probe-formal-ai-provider.sh)
starts a router with the **default** `UPSTREAM_PROVIDER=auto`, registers a stub
Formal AI server with
`router providers add --name hive-mind-formal-ai --base-url http://link-assistant-formal-ai:8080/v1 --model formal-ai --models formal-ai`,
and asks the router for that model as a task would
([`data/measurements/formal-ai-provider.log`](data/measurements/formal-ai-provider.log)):

```
-- /v1/models as the task sees it --
{"data":[{"id":"formal-ai","object":"model","owned_by":"hive-mind-formal-ai"}], …}
-- chat completion for model 'formal-ai' --
{"id":"stub-1", …,"content":"FORMAL-AI-STUB"…}
[http 200]
```

and the exchange is in the audit trail like any other mediated call:

```
{"time":"…","token_id":"e0172106-…","label":"probe-formal-ai","provider":"openai-compatible","surface":"openai_chat","path":"/v1/chat/completions","model":"formal-ai"}
```

No global pin was needed, so a single `hive-mind-router` serves Claude tasks and
Formal AI tasks at once. R11 is therefore delivered rather than deferred; see
[R11](#r11--model-formal-ai-through-the-same-router).

### G2 — destructive operations over the **git transport** are outside the proxy

**Reported upstream: [link-assistant/router#261](https://github.com/link-assistant/router/issues/261)
— fixed upstream and closed 2026-08-21 20:53 UTC; a git proxy now exists at
`/git/*`. Re-measured here: it refuses deletions but still forwards force
pushes, which is now
[router#272](https://github.com/link-assistant/router/issues/272).**

**Blocks the transport half of R13** ("block of all delete operations or history
changes like git reset and so on detected up on git push") **and the `git` half
of R12**.

The router says this itself, twice, and both statements are unambiguous:

> The `/github/*` namespace exposes arbitrary REST paths without colliding with
> inference/admin routes. **Plain git over SSH/HTTPS is outside this proxy.**
> (README 665–667)

> This protects API-mediated ref deletion and forced ref updates; **branch
> protection remains necessary because a force-push over the git transport never
> reaches these routes.** (README 699–702)

This matters more than it may look. `git push --force-with-lease` after a
`git reset --hard HEAD~5` — the exact scenario the issue names — is a
`git-receive-pack` exchange over HTTPS. It never touches `/repos/…/git/refs`,
so `GitHubPolicy::decision` is never consulted. Configuring a task's `git` to
"use the router" therefore has no defensive meaning today; it would only change
where the credential lives.

**Resolution, measured against `v0.109.0`** —
[`experiments/issue-2164/probe-git-transport.sh`](../../../experiments/issue-2164/probe-git-transport.sh)
clones this repository through `https://link-assistant-router/git/…` with no
GitHub credential in the task at all, then tries both destructive pushes
([`data/measurements/git-transport.log`](data/measurements/git-transport.log)):

```
== 4. destructive: delete the branch (expected: refused by the router) ==
error: RPC failed; HTTP 403 curl 22 The requested URL returned error: 403

== 5. destructive: force-update the branch to unrelated history (expected: refused) ==
 + f5e3e3e...a861cb3 HEAD -> issue-2164-90464ce530a2 (forced update)
```

Half the gap is closed: a ref deletion is refused by the router itself. A
non-fast-forward push is not, because the router's `body_requests_force()` looks
for `force-ref-updates`/`push-force` capabilities that git never announces —
[`data/measurements/force-capabilities.log`](data/measurements/force-capabilities.log)
shows the actual capability list git sends. Filed as
[router#272](https://github.com/link-assistant/router/issues/272); until it
lands, the in-task `pre-push` guard covers it unless the agent passes
`--no-verify`, and branch protection remains the one unbypassable control.

_Workaround until then, and it is a real one:_ GitHub branch protection with
`allow_force_pushes: false` and `allow_deletions: false`, which
`src/protect-branch.mjs` already applies, is enforced by the server and cannot
be bypassed by any client. Combined with C6 (API deletions denied) that closes
the _outcome_ even though it does not close the _channel_.

_Requested behaviour:_ a git-transport surface on the router — terminate
`git-upload-pack`/`git-receive-pack` over HTTPS, inject the operator credential
the same way the GitHub API proxy does, parse the ref update commands in the
receive-pack request, and deny deletions (`old→zero`) and non-fast-forward
updates by default, with the same ordered-policy override file. FINOS GitProxy
(see Part 4) is a working existence proof of this design.

### G3 — the GitHub credential and policy are per-deployment, not per-task

**Reported upstream: [link-assistant/router#262](https://github.com/link-assistant/router/issues/262)
— fixed upstream and closed 2026-08-21 20:53 UTC. `router tokens issue` now
takes `--github-repo`, and `issueRouterTaskToken()` passes the task's repository,
so a routed task cannot touch any other one.**

**Weakens R6 and R13 for the `gh` path** (it does not block them).

`GitHubProxyConfig::from_env()` reads one `GITHUB_PROXY_TOKEN[_FILE|_ENV]` and
one `GITHUB_PROXY_POLICY` file, and `GitHubPolicy::decision(method, path, body)`
takes no token or task parameter. Every task therefore shares one GitHub
identity and one rule set. Per-task _attribution_ is fine — C2 means each task's
GitHub calls land in its own `requests.jsonl` — but per-task _authorisation_ is
not expressible, so "task #2164 may only write to `link-assistant/hive-mind`"
cannot be stated.

_Assessment:_ this is **not a regression** — today every task is handed the
operator's whole `~/.config/gh`, which is strictly weaker. `--use-router` is an
improvement even with G3 open. It is filed as an enhancement, not a blocker.

_Requested behaviour:_ optional per-token GitHub scope — attach a policy name
and/or an allowed repository set to a token at issue time, evaluated before the
global rules.

### G4 — `gh` cannot talk to a custom host over plain HTTP

**Reported upstream: [link-assistant/router#263](https://github.com/link-assistant/router/issues/263)
— fixed upstream and closed 2026-08-21 20:53 UTC: the router terminates TLS
itself (`TLS_SELF_SIGNED=1`, `TLS_SELF_SIGNED_DNS=…`), which is what makes the
transparent `gh` interception below possible.**

**Blocks the `gh` half of R12** in the default deployment.

C7 established that the router understands what `gh` sends. What it does not do
is terminate TLS: the sidecar serves plain HTTP, while `gh` builds a custom
host's REST base as `https://<host>/api/v3/` with no plaintext option, so
`GH_HOST=link-assistant-router:8080` fails to connect before the router ever
sees a request. The only way to route `gh` today is to put an HTTPS terminator
in front of the router yourself and name it in `HIVE_MIND_ROUTER_GH_HOST`.

_Assessment:_ same character as G3 — it degrades to today's behaviour (the task
keeps its own `~/.config/gh`) rather than breaking anything, so it is an
enhancement request, not a blocker for the PR. But it is the reason a default
`--use-router` run prints "GitHub traffic is NOT routed".

_Requested behaviour:_ an optional TLS listener on the router (or a documented,
supported sidecar terminator), so `GH_HOST` can point at it directly.

**Resolution, measured against `v0.109.0`** — the listener exists, and it turned
out to buy more than `GH_HOST`. The sidecar serves 443 with a self-signed
certificate whose SANs cover both `link-assistant-router` and `api.github.com`,
so a routed task needs no `GH_HOST` at all: `api.github.com` is pointed at the
router's address in the task's `/etc/hosts` and an unmodified `gh` verifies the
connection against the router's CA
([`data/measurements/github-hosts.log`](data/measurements/github-hosts.log)).
Two findings came out of the probes and both are upstream:

- `gh` **does** honour `SSL_CERT_FILE` on Linux, contrary to the router's docs —
  [router#270](https://github.com/link-assistant/router/issues/270),
  [`data/measurements/gh-ssl-cert-file-linux.log`](data/measurements/gh-ssl-cert-file-linux.log).
  `SSL_CERT_FILE` _replaces_ the store rather than adding to it, which is why the
  task is given a bundle of the public roots plus the router CA.
- Adding `api.github.com` as a network **alias** for the router container makes
  the router resolve itself and answer its own upstream call with 502; the hosts
  entry has to live in the task container instead
  ([`data/measurements/github-alias.log`](data/measurements/github-alias.log)).

### What is _not_ a gap

For the record, these were checked and found already supported, so no upstream
issue is warranted: per-task token issuance and revocation (C1), per-task log
separation (C2), Codex/Gemini/Qwen credential homes as well as Claude (C3),
persisted audit data (C5), API-level destructive denial (C6), `gh` custom-host
support at the protocol level (C7 — though not over plain HTTP, see G4),
per-client setup (C8), log diagnostics (C9), a public container
image with the CLI inside (C10).

Merging a finished task's _session_ files (R7) is also not a router gap:
`~/.claude/projects/**/*.jsonl` is client-side state the CLI writes, and the
router never sees it. Collecting it is a Hive Mind responsibility, described in
Part 5 · R7.

## Part 4 — Existing components and prior art

The issue asks to "check known existing components/libraries that solve similar
problem or can help in solutions". Full notes and sources are in
[`data/research/online-research.md`](data/research/online-research.md).

| Component                                                                          | What it solves                                                                                                                                                                                | How it applies here                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Link.Assistant.Router** (`link-assistant/router`, Rust/axum, v0.105.0)           | AI-API proxy with per-task JWTs, per-token logs, vendor credential custody, GitHub API policy                                                                                                 | The component this issue is built on. Part 2 audits it.                                                                                                                                                                                                                                                                  |
| **FINOS GitProxy** (`finos/git-proxy`, MIT, FINOS-graduated)                       | "Stands between developers and a Git remote endpoint … and applies rules and workflows to all outgoing git push operations"; v2.0 covers **both HTTP/HTTPS and SSH**                          | Existence proof and reference design for G2. Also a fallback: Hive Mind could point tasks' `insteadOf` at a GitProxy sidecar if the router's git surface is slow to arrive. Used in production by Citi, RBC, NatWest, G-Research.                                                                                        |
| **git `pre-push` hook**                                                            | Client-side refusal of force pushes and branch deletions                                                                                                                                      | Delivered as `src/git-push-guard.lib.mjs`: generated on the host, mounted read-only, addressed with `GIT_CONFIG_KEY_0=core.hooksPath` so the task cannot edit the rule it is held to. Still client-side — `--no-verify` defeats it — so it is a speed bump, not the control.                                             |
| **GitHub branch protection** (`allow_force_pushes:false`, `allow_deletions:false`) | Server-side, unbypassable refusal of history destruction                                                                                                                                      | The actual control for R13's transport half today; already automated in `src/protect-branch.mjs`. Named by the router README as the necessary backstop.                                                                                                                                                                  |
| **LiteLLM virtual keys / agent sandboxes**                                         | The mainstream "one gateway credential + N scoped revocable keys with budgets and per-key logs" pattern; injects per-sandbox secrets as `CONTAINER_ENV_*` rather than mounting operator files | Confirms the router's per-task-token model is standard practice and that "env, not mount" is the right boundary at `getDockerIsolationAuthMounts`.                                                                                                                                                                       |
| **`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`** (Claude Code)                    | Redirects _every_ request the CLI makes, "including its agentic sub-loops and background calls"                                                                                               | The concrete R2 mechanism for Claude. Generic gateways commonly require `ANTHROPIC_AUTH_TOKEN` (Bearer) and 401 on `ANTHROPIC_API_KEY` (`x-api-key`); this router accepts a task token in **either** header (router README, lines 66 and 597), so the implementation sets both and the CLI may use whichever it prefers. |
| **Hive Mind's own Formal AI sidecar** (`src/formal-ai-sidecar.lib.mjs`)            | On-demand, lease-counted, internal-network container with bot-driven idle shutdown                                                                                                            | The template for R5. Reuse the pattern, not the code — a shared abstraction is proposed in Part 6.                                                                                                                                                                                                                       |

## Part 5 — Solutions and plans, requirement by requirement

Each entry lists the options considered, the plan that was chosen, and how it is
verified. Test names follow the repository convention
`tests/test-issue-2164-*.mjs`.

### R1 — the `--use-router` option

_Options._ (a) A boolean flag in `SOLVE_OPTION_DEFINITIONS`, inherited by
`hive`/`task` the way other shared options are. (b) A string option
`--router <url>` pointing at an existing router. (c) An environment variable
only.

_Plan:_ **(a) plus an escape hatch.** `--use-router` is a boolean declared once
in `src/solve.config.lib.mjs` and re-exported into `src/hive.config.lib.mjs` and
`src/task.config.lib.mjs`, matching how existing shared options are declared.
An operator who already runs a router elsewhere sets
`HIVE_MIND_ROUTER_URL` / `HIVE_MIND_ROUTER_TOKEN`, mirroring the router's own
`LINK_ASSISTANT_ROUTER_URL` / `LINK_ASSISTANT_TOKEN` resolution order
(`router-use-case-with-router.md`), and Hive Mind skips starting its own
sidecar. (b) is rejected as the primary surface because the issue names a
_specific_ container on the Docker network. (c) is rejected because the issue
asks for an option.

_Verification:_ option-surface test asserting the flag exists on all three CLIs,
defaults to `false`, and carries the experimental marker (R10).

### R2 — suppress the credential mounts, point the CLI at the router

_Options._ (a) Filter the mount list inside `getDockerIsolationAuthMounts()`.
(b) Filter at the call site in `buildDockerIsolationStartArgs()`. (c) Mount a
_fake_ credential directory containing only the router endpoint.

_Plan:_ **(a)**, because it is the function every other code path already asks
"what does the task see?", and a single test can then assert the negative — no
`~/.claude`, no `~/.claude.json`, no `~/.codex`, no `~/.agents` mount is
produced when `useRouter` is true. The git identity mounts (`~/.gitconfig`,
`~/.config/git`) are **kept**: they carry no secret and `issue #1939` shows that
dropping them breaks commits with "Git identity not configured".
`~/.config/gh` is dropped, replaced by `GH_HOST`/`GH_ENTERPRISE_TOKEN` (R12).

The endpoint is then injected as environment variables in
`buildDockerIsolationStartArgs()`, per tool:

| Tool                                     | Variables                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| claude                                   | `ANTHROPIC_BASE_URL=http://<alias>:8080`, `ANTHROPIC_AUTH_TOKEN=la_sk_…`                                                                                                                               |
| codex / qwen / opencode / agent / gemini | whatever `router clients setup <client>` writes — resolved by running that command _inside the task container_ against the task's own token, so the mapping stays owned upstream and does not rot here |

_Verification:_ `tests/test-issue-2164-router-mounts.mjs` — asserts the mount
list difference in both directions and the presence of the env atoms.

### R3 — the router is the only point of contact with the subscription

_Plan:_ the `hive-mind-router` container mounts the operator's real homes:
`-v $HOME/.claude:/data/claude` and `-v $HOME/.codex:/data/codex` (plus
`.gemini`/`.qwen` when present), **writable**, per C11 — read-only would break
refresh-token rotation across restarts. `CLAUDE_CODE_HOME=/data/claude`,
`CODEX_HOME=/data/codex`, etc. Because R2 removes those mounts from every task,
the router container is then the only process in the system holding them.

_Verification:_ a test asserting the router run-args contain the credential
mounts and are **not** `:ro`, with the reason quoted in a comment; plus the R2
test asserting tasks have none.

### R5 — lifecycle: running only while a task needs it

_Options._ (a) Copy `formal-ai-sidecar.lib.mjs` into `router-sidecar.lib.mjs`.
(b) Extract a generic `sidecar.lib.mjs` and have both Formal AI and the router
use it. (c) Reference-count with a simple boolean.

_Plan:_ **(a) first, (b) as a follow-up.** The Formal AI module carries hard-won
invariants (leases not a boolean; truth comes from Docker, not from the state
file; `docker network connect` rather than `docker run --network`; the launch
grace window for a task that has not created its container yet). Copying it and
then extracting the commonality once both consumers exist is lower-risk than
generalising an abstraction from a single example. (c) is rejected outright —
the Formal AI module's own header documents why a boolean is wrong.

Concretely: `hive-mind-router` container, `hive-mind-router` `--internal`
network, alias `link-assistant-router`, port 8080, label
`com.link-assistant.hive-mind.router`, state file `router-sidecar.json` under
the bot state dir, and a `stopIdleRouterSidecar` duty added to the existing
maintenance tick so the Telegram bot requirement is satisfied by the loop that
already runs (`src/telegram-bot.mjs:257`).

One deliberate difference from Formal AI: the router **needs outbound internet**
(api.anthropic.com, api.github.com), so it is started on the default bridge and
then `docker network connect`ed to the internal network, rather than being
created with `--network hive-mind-router`.

_Verification:_ `tests/test-issue-2164-router-lifecycle.mjs`, modelled on
`tests/test-issue-2146-formal-ai-lifecycle.mjs`, with a fake `docker` runner:
two tasks → one container; releasing one keeps it; releasing both stops it; a
task whose container vanished loses its lease on reconcile.

### R6 — one token per task

_Plan:_ at lease-acquire time, mint the token from inside the container —
`docker exec hive-mind-router router tokens issue --ttl-hours <n> --label
hive-mind-<sessionId> --rate-limit-per-minute <n>` — which is the path
`router-use-case-with-router.md` itself uses for the managed container. The
label is the Hive Mind session UUID, so the router's log directory joins to
`$ --list`, the session store and the bot log by one identifier. The token is
recorded in the lease, and **revoked on release** (`router tokens revoke <id>`),
so a leaked token from a finished task is inert.

Two constraints from `router-use-case-per-task-tokens.md` are adopted verbatim:
"Never share one token between two tasks", and `TOKEN_SECRET` never enters a
task's environment.

_Verification:_ lifecycle test asserts one issue per lease, one revoke per
release, distinct labels, and that no task's env ever contains `TOKEN_SECRET`.

### R7 — merge the task's session data out before it disappears

The router cannot help here (Part 3, "What is _not_ a gap"): Claude/Codex write
session transcripts into the _client's_ home (`~/.claude/projects/**/*.jsonl`,
`~/.codex/sessions/**`), which under `--use-router` lives only inside the task
container's writable layer.

_Options._ (a) `docker cp` from the task container into a host audit folder
just before removal. (b) Mount a per-task named volume at `~/.claude/projects`.
(c) Have the agent upload them itself.

_Plan:_ **(b) with (a) as the fallback.** A per-task volume
(`hive-mind-router-session-<sessionId>` mounted at
`/home/box/.claude/projects`) survives container removal by construction, which
means a _crashed_ task's transcript is preserved too — the case (a) misses,
since a container that is gone cannot be `docker cp`ed from. The maintenance
tick then drains finished tasks' volumes into the router data folder under
`sessions/<sessionId>/` and removes the volume. (c) is rejected: audit data
must not depend on the audited party's cooperation.

_Verification:_ a test over the run-args and the drain function with a fake
docker runner; plus an entry in the log-collection doc (R15) telling an operator
where to find it.

### R8 + R14 — preserved router data and reachable logs

_Plan:_ a named volume `hive-mind-router-data` mounted at `/data/router`
(the path the router's own managed container uses), with `DATA_DIR=/data/router`
and `AUDIT_LOG=/data/router/audit.jsonl`. Like the Formal AI memory volume, it
is **never removed** by any Hive Mind code path — image updates stop and
recreate the container, not the volume.

Access surfaces to add: a `--router-logs` style read-only path for operators and
a Telegram command in the family of the existing
`src/telegram-log-command.lib.mjs`, both ultimately shelling out to
`docker exec hive-mind-router router logs summary|anomalies --json` (C9).
`router logs anomalies` exits non-zero when it finds something, which makes it
usable directly as a health gate in the maintenance tick.

### R9 + R10 — default unchanged, feature experimental

_Plan:_ the flag defaults to `false`, and every new code path is guarded by it,
so a run without `--use-router` produces byte-identical `$` arguments to today.
That is asserted as a regression test rather than assumed.

"Experimental" is expressed in three places, following how the repository
already marks risky options: the yargs `describe` string starts with
`[EXPERIMENTAL]`, the run log prints a one-line warning naming the issue, and
the `docs/DOCKER.md` section (and its `.ru`/`.zh`/`.hi` translations) says what
is and is not covered — specifically that G2 is open, so history destruction is
contained by branch protection rather than by the router.

### R11 — `--model formal-ai` through the same router

G1 was fixed upstream while this work was in flight, so the staged plan collapsed
into one step. When a run has both sidecars —
`--use-router --model formal-ai` — `registerFormalAiWithRouter()` in
`src/router-task-isolation.lib.mjs` does two things before the task container is
created:

1. `attachRouterToNetwork({ network: 'hive-mind-formal-ai' })` — the router is
   otherwise on its own internal network plus the default bridge and cannot
   resolve `link-assistant-formal-ai`. No alias is requested in the other
   direction: nothing on that network calls the router by name.
2. `registerRouterProvider()` runs
   `router providers add --name hive-mind-formal-ai --base-url http://link-assistant-formal-ai:8080/v1 --model formal-ai --models formal-ai`
   inside the sidecar. The key is stored AES-GCM-encrypted in
   `<DATA_DIR>/providers.lenv`, so it survives a restart and never enters a
   task's environment.

Both steps fail closed, like every other part of router isolation: a Formal AI
task that cannot reach Formal AI _through_ the router is not launched around it.
Because the router dispatches on the model id under the default
`UPSTREAM_PROVIDER=auto` (measured in G1 above), registering this provider does
not divert Claude tasks sharing the same sidecar.

What is **not** covered, and is stated by
`describeRouterCoverageGaps({ model: 'formal-ai' })` on every such run: the
Formal AI sidecar's _own_ upstream calls. `formal-ai serve --agent-mode` is
reached through the router, but if that server itself calls a vendor API, that
leg leaves the sidecar directly rather than coming back through the router.

_Verification:_ `tests/test-issue-2164-router-sidecar.mjs` asserts the argv, the
ordering (network before provider), that the DNS endpoint is stored rather than a
container address that changes on every restart, and that each half fails the
launch; the wire behaviour behind it is measured in
`experiments/issue-2164/probe-formal-ai-provider.sh`.

### R12 + R13 — `gh` and `git` through the router, destructive operations blocked

_`gh` — delivered by interception._ G4 is gone: router `v0.109.0` terminates TLS
itself, and its self-signed certificate carries `api.github.com` as a SAN, so the
plan of pointing `GH_HOST` at the router is no longer needed for the sidecar
case. The `~/.config/gh` mount is dropped (R2), the task container resolves
`api.github.com` to the router's address through `/etc/hosts`, and the router's
CA is installed for each client family — `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`
(a bundle of the public roots _plus_ the router CA, because it replaces the store
rather than adding to it), `CURL_CA_BUNDLE`, and `http.<url>.sslCAInfo`. The
router carries `GITHUB_PROXY_TOKEN` from the operator's credential and applies
its built-in deny-by-default destructive policy (C6). An unmodified `gh` is
therefore mediated without knowing it, and the task holds no GitHub credential of
its own. `HIVE_MIND_ROUTER_GH_HOST` survives for an external router, which has no
container network of ours to intercept in; `HIVE_MIND_ROUTER_GITHUB=0` turns the
whole thing off, and every routed run says which of the three modes it is in.
Measured in `data/measurements/github-hosts.log` and
`data/measurements/gh-ssl-cert-file-linux.log`.

_`git`._ Three layers, in the order they were delivered:

1. **Branch protection** (available now, server-side, unbypassable):
   `src/protect-branch.mjs` already applies `allow_force_pushes: false` and
   `allow_deletions: false`.
2. **A `pre-push` hook** that refuses deletions (`--delete`, or a zero
   destination SHA) and non-fast-forward updates. Cheap, immediate, and defeated
   by `--no-verify` — documented as a speed bump. **Delivered** in
   `src/git-push-guard.lib.mjs`: the hook is generated on the host rather than
   baked into the image (so it ships with the code that tests it), mounted
   read-only into routed tasks, and reached through `GIT_CONFIG_COUNT`/
   `GIT_CONFIG_KEY_0=core.hooksPath` rather than `git config --global`, because
   the container's `~/.gitconfig` is the operator's own bind-mounted file and
   writing to it would reconfigure the host.
   `tests/test-issue-2164-git-push-guard.mjs` runs it against a real repository
   and a real remote: a force push after `git reset --hard` and a
   `push --delete` both fail, the remote still holds the discarded commit
   afterwards, and an ordinary push still succeeds.
3. **Router git transport** — **delivered**, now that the router proxies
   `/git/*` (G2 fixed upstream). The task's `origin` is rewritten to
   `https://link-assistant-router/git/<owner>/<repo>` through
   `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` entries that share the counter with
   the hook's `core.hooksPath`, so the task pushes with no GitHub credential of
   its own. Measured in `data/measurements/git-transport.log`: `git push
origin :branch` is refused with `HTTP 403` by the router, unbypassable from
   inside the task. A non-fast-forward push is still forwarded, because
   `body_requests_force()` keys on a `force-ref-updates` capability git never
   announces — filed as
   [router#272](https://github.com/link-assistant/router/issues/272).

R13 is therefore delivered for the gh API half and for ref deletions on the
transport; for a force push the `pre-push` hook and branch protection are what
hold, and the docs say exactly that rather than claiming the router does it.

### R15 — the system-wide log-collection guide

This repository has no logging documentation today. The plan is a new
`docs/COLLECTING-LOGS.md` (plus `.ru.md`, `.zh.md`, `.hi.md`, per the existing
convention — every doc in `docs/` has all four), covering the whole system and
not just the router:

- **Solve/hive/task run logs** — where the per-run log file is written, what
  `--attach-logs` does, and how a log reaches a Gist;
- **Session logs** — the session store, `$ --list`, the `session_untracked`
  structured event and what its `reason` field means;
- **Bot logs** — `src/bot-logger.lib.mjs` output and the existing
  `/log` Telegram command;
- **Docker isolation logs** — `docker logs <sessionId>`, the writable-layer size
  probe, and the start-gate diagnostics behind `--verbose`;
- **Formal AI sidecar logs** — `docker logs hive-mind-formal-ai`, `/health`;
- **Router logs** — the `DATA_DIR` layout, `requests/<token-hash>/requests.jsonl`,
  `audit.jsonl`, and `router logs summary|anomalies`;
- **CI logs** — the `gh run view --log > ci-logs/…` workflow already used across
  this repository's case studies;
- **A "collect everything for a bug report" recipe** — one script under
  `examples/` that gathers all of the above for a given session UUID into a
  single directory, which is the concrete thing that makes "for next issues
  everything will be simplified" true.

### R16 — upstream first

Four issues were filed against `link-assistant/router` on 2026-08-21, each
carrying the requirement it blocks, the quoted README/source evidence, the
workaround in use here, and the concrete behaviour requested:

| Upstream                                                          | Gap                                                                | Blocks                                 | Outcome                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------- |
| [router#260](https://github.com/link-assistant/router/issues/260) | G1 — automatic routing ignores stored OpenAI-compatible providers  | R11                                    | Fixed upstream, closed 2026-08-21; shipped in 0.106.0–0.109.0        |
| [router#261](https://github.com/link-assistant/router/issues/261) | G2 — destructive git-transport operations bypass the policy engine | R13 (transport half), R12 (`git` half) | Fixed upstream, closed 2026-08-21; `/git/*` proxy added              |
| [router#262](https://github.com/link-assistant/router/issues/262) | G3 — GitHub credential and policy are per-deployment               | R6/R13 hardening                       | Fixed upstream, closed 2026-08-21; `--github-repo` scoping used here |
| [router#263](https://github.com/link-assistant/router/issues/263) | G4 — no TLS listener, so `gh` cannot use the router as a host      | R12 (`gh` half) by default             | Fixed upstream, closed 2026-08-21; TLS on 443, `api.github.com` SAN  |

All four were answered within hours of being filed, which is what turned the
issue's "report upstream first" rule into a one-day pause rather than a
permanent block. Re-measuring `v0.109.0` against the same probes then produced
three further reports — [#270](https://github.com/link-assistant/router/issues/270),
[#271](https://github.com/link-assistant/router/issues/271) and
[#272](https://github.com/link-assistant/router/issues/272) — of which only #272
still limits a requirement here (R13's force-push case).

## Part 6 — Delivery plan, as shipped

| Phase | Content                                                                                                                                                                               | Gated on                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | This case study, the data folder, the four upstream issues                                                                                                                            | —                                                                                                                                      |
| 1     | `docs/COLLECTING-LOGS.md` ×4 languages + the `examples/collect-logs.mjs` recipe (R15, and the R14 groundwork)                                                                         | —                                                                                                                                      |
| 2     | `--use-router` option surface on solve/hive/task/Telegram, experimental marking, default-unchanged regression test (R1, R9, R10)                                                      | —                                                                                                                                      |
| 3     | `src/router-sidecar.lib.mjs` + `src/router-isolation.lib.mjs` + maintenance-tick duty: container, internal network, leases, per-task token issue/revoke, data volume (R3, R5, R6, R8) | —                                                                                                                                      |
| 4     | Mount suppression and endpoint injection at the credential seam (R2), deny-by-default policy file (R13 API half)                                                                      | —                                                                                                                                      |
| 5     | Session-data preservation volume and drain (R7), router log access surfaces (R14)                                                                                                     | —                                                                                                                                      |
| 6     | `pre-push` hook layer and branch-protection wiring for `--use-router` runs (R13 layer 1–2)                                                                                            | —                                                                                                                                      |
| 7     | Formal AI through the router (R11)                                                                                                                                                    | [router#260](https://github.com/link-assistant/router/issues/260) — fixed                                                              |
| 8     | git transport through the router (R13 layer 3) and transparent `gh` interception (R12)                                                                                                | [router#261](https://github.com/link-assistant/router/issues/261), [#263](https://github.com/link-assistant/router/issues/263) — fixed |
| 9     | Per-task GitHub scope (R6/R13 hardening)                                                                                                                                              | [router#262](https://github.com/link-assistant/router/issues/262) — fixed                                                              |

All nine phases ship in this PR: the four gates were fixed upstream the day
after they were filed, and the pin moved to `v0.109.0` so the delivered
behaviour is the measured behaviour. What is still missing — a router-side block
on force pushes, and the Formal AI sidecar's own upstream leg — is stated in the
documentation rather than implied to be covered.

## Part 7 — Risks, open questions and explicit non-goals

- **`--use-router` isolates credentials, not the network.** A task container
  keeps its default bridge, because it needs npm, PyPI and `git clone` to work.
  An agent that wants to reach `api.anthropic.com` directly still can — it just
  has no credential to present. Full egress isolation is a different feature and
  is deliberately out of scope; it is worth its own issue.
- **The router becomes a single point of failure** for every task on the host.
  The lease/health machinery inherited from the Formal AI sidecar fails closed
  (a task that cannot reach the router is not launched), which is the right
  trade for an experimental flag but must be documented.
- **Token TTL versus long tasks.** A solve run can exceed a short TTL. The plan
  issues a TTL comfortably longer than the task timeout and revokes on release,
  rather than relying on expiry; `router tokens rotate` exists if renewal ever
  becomes necessary.
- **Rate limits are per token, so N tasks can still exhaust one subscription.**
  Per-task caps bound one runaway loop, not the aggregate. Choosing aggregate
  limits is an operator policy question this issue does not settle.
- **A destructive-git probe must never run against a live branch.** The R13
  transport probe pointed its delete and force attempts at this issue's own pull
  request branch, on the assumption that the router would refuse both and leave
  the remote untouched. The delete was refused; the force was not
  ([router#272](https://github.com/link-assistant/router/issues/272)), so the
  branch really was rewritten for 27 seconds — and GitHub closed pull request
  #2165 on the force-push and then refused to reopen it (`state cannot be
changed. The issue-2164-90464ce530a2 branch was force-pushed or recreated`,
  HTTP 422). The work continued in #2174 from the same branch.
  `experiments/issue-2164/probe-git-transport.sh` now defaults to a throwaway
  branch and says why. The general rule: a probe that tests whether a guard
  holds must assume it does not.
- **Non-goal:** replacing the direct-mount path. R9 is explicit that the default
  does not change, and the regression test enforces it.

## Timeline

| When (UTC)       | Event                                                                                                                                                                      | Evidence                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-21 16:17 | Issue #2164 opened by konard, labels `documentation` + `enhancement`                                                                                                       | [`data/github/issue-2164.json`](data/github/issue-2164.json)                                                                                                                          |
| 2026-08-21 16:23 | Issue last updated; comment feed still empty, so the body is the whole specification                                                                                       | [`data/github/issue-2164-comments.json`](data/github/issue-2164-comments.json)                                                                                                        |
| 2026-08-21 13:23 | Router `v0.105.0` published — the version this analysis audits                                                                                                             | [`data/upstream/router-releases.json`](data/upstream/router-releases.json)                                                                                                            |
| 2026-08-21 16:31 | Router repository last pushed; 139 issues, **0 open**                                                                                                                      | [`data/upstream/router-repo.json`](data/upstream/router-repo.json), [`router-issues.json`](data/upstream/router-issues.json)                                                          |
| 2026-08-21       | Evidence collected, requirements enumerated, gaps G1–G3 identified                                                                                                         | this document                                                                                                                                                                         |
| 2026-08-21       | G1 reported upstream as router#260                                                                                                                                         | [router#260](https://github.com/link-assistant/router/issues/260)                                                                                                                     |
| 2026-08-21       | G2 reported upstream as router#261                                                                                                                                         | [router#261](https://github.com/link-assistant/router/issues/261)                                                                                                                     |
| 2026-08-21       | G3 reported upstream as router#262                                                                                                                                         | [router#262](https://github.com/link-assistant/router/issues/262)                                                                                                                     |
| 2026-08-21       | G4 reported upstream as router#263                                                                                                                                         | [router#263](https://github.com/link-assistant/router/issues/263)                                                                                                                     |
| 2026-08-21 20:53 | **All four gaps fixed upstream and closed** — #260, #261, #262, #263                                                                                                       | the upstream issues                                                                                                                                                                   |
| 2026-08-21 21:16 | Router `v0.106.0` published, the first release carrying the fixes                                                                                                          | [router releases](https://github.com/link-assistant/router/releases)                                                                                                                  |
| 2026-08-22 15:48 | Router `v0.109.0` published — the version this PR pins and measures                                                                                                        | `ROUTER_SIDECAR_IMAGE` in `src/router-isolation.lib.mjs`                                                                                                                              |
| 2026-08-22       | Re-measured against `v0.109.0`: TLS `gh` interception, git transport, `formal-ai`                                                                                          | [`data/measurements/`](data/measurements)                                                                                                                                             |
| 2026-08-22 16:38 | R13 probe force-pushed the PR branch (router#272 lets it through); GitHub closed PR #2165 and refuses to reopen it, so the work continues in PR #2174 from the same branch | [PR #2165 comment](https://github.com/link-assistant/hive-mind/pull/2165#issuecomment-5381856155)                                                                                     |
| 2026-08-22       | Three new findings reported upstream: router#270, #271, #272                                                                                                               | [#270](https://github.com/link-assistant/router/issues/270), [#271](https://github.com/link-assistant/router/issues/271), [#272](https://github.com/link-assistant/router/issues/272) |
| 2026-08-22 18:09 | **router#272 fixed upstream** in router#273 — compare-based force mediation, failing closed                                                                                | [router#273](https://github.com/link-assistant/router/pull/273)                                                                                                                       |
| 2026-08-22 18:26 | Router `v0.110.0` published, the first release refusing a force push                                                                                                       | [router releases](https://github.com/link-assistant/router/releases)                                                                                                                  |
| 2026-08-26       | Re-audit against `v0.119.0`; four new reports filed: router#322, #323, #324, #329                                                                                          | [Post-upgrade re-audit](#post-upgrade-re-audit-2026-08-26)                                                                                                                            |
| 2026-08-26 08:44 | router#322, #323, #324 closed upstream (#323 partially — tier aliases declined); **#329 remains open**                                                                     | the upstream issues                                                                                                                                                                   |
| 2026-08-26       | Pin moved `v0.109.0` → `v0.119.0`; stale force-push claims removed across code, docs ×4 and tests                                                                          | `ROUTER_SIDECAR_IMAGE` in `src/router-isolation.lib.mjs`                                                                                                                              |

## Status

Phase 0 is complete: the data is compiled here, all 17 requirements are
enumerated with an owner section each, every router capability the issue assumes
has been verified against first-party evidence, and the four genuine gaps are
identified with the exact upstream behaviour to request.

Phases 1–6 are delivered in PR #2165. What answers each requirement, so a
reviewer can go straight to the evidence:

| #           | Delivered by                                                                                                                                                                                                                                                      | Verified by                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R1, R9, R10 | `--use-router` in `SOLVE_OPTION_DEFINITIONS` with the `[EXPERIMENTAL]` prefix; nothing changes without it                                                                                                                                                         | `tests/test-issue-2164-router-isolation.mjs`                                                              |
| R2, R3      | `getRouterSuppressedCredentialPaths()` + `buildRouterTaskEnv()`, applied at the credential seam in `src/isolation-runner.lib.mjs`                                                                                                                                 | `tests/test-issue-2164-router-isolation.mjs` (suppression asserted explicitly)                            |
| R4          | Part 2 of this document, quoted against the pinned router README                                                                                                                                                                                                  | `data/upstream/router-README.md`                                                                          |
| R5          | Lease-counted sidecar in `src/router-sidecar.lib.mjs`; the bot's maintenance tick reconciles leases against Docker and stops idle routers                                                                                                                         | `tests/test-issue-2164-router-sidecar.mjs`                                                                |
| R6          | One `router token issue` per session id, revoked on release; never shared                                                                                                                                                                                         | `tests/test-issue-2164-router-sidecar.mjs`                                                                |
| R7          | `src/router-session-drain.lib.mjs`, run when the lease drops — `docker cp` works on stopped containers                                                                                                                                                            | `tests/test-issue-2164-session-drain.mjs`                                                                 |
| R8, R14     | Named volume `hive-mind-router-data` that no code path removes; `src/router-logs.lib.mjs` reads it with or without a running router                                                                                                                               | `tests/test-issue-2164-log-collection.mjs`                                                                |
| R11         | `registerFormalAiWithRouter()`: the router joins the Formal AI network and stores the sidecar as a provider, so `--model formal-ai` is mediated too                                                                                                               | `tests/test-issue-2164-router-sidecar.mjs`, `experiments/issue-2164/probe-formal-ai-provider.sh`          |
| R12         | Transparent interception by default: the router's certificate names `api.github.com`, and the task resolves that host to the router. `HIVE_MIND_ROUTER_GH_HOST` remains for an external one                                                                       | `tests/test-issue-2164-router-isolation.mjs`, `data/measurements/github-hosts.log`                        |
| R13         | Layers 1–3: branch protection, the `pre-push` guard in `src/git-push-guard.lib.mjs`, and git itself sent through the router's `/git/*` proxy, which refuses deletions                                                                                             | `tests/test-issue-2164-git-push-guard.mjs` (real git, real remote), `data/measurements/git-transport.log` |
| R15         | `docs/COLLECTING-LOGS.md` ×4 languages and `examples/collect-logs.mjs`, both driven by `describeSystemLogLocations()`                                                                                                                                             | `tests/test-issue-2164-log-collection.mjs`                                                                |
| R16         | router#260, #261, #262, #263 filed before the corresponding code — all four now fixed upstream; #270, #271, #272 filed for what the re-measurement found, all three now fixed; #322, #323, #324, #329 filed in the 2026-08-26 re-audit, three fixed and #329 open | the upstream issues                                                                                       |
| R17         | this document                                                                                                                                                                                                                                                     | `MANIFEST.md` checksums                                                                                   |

All four upstream gaps this analysis opened with were fixed while the PR was in
flight, so R11, R12 and R13 are delivered rather than deferred. **R13 is still
not airtight**, and the PR does not claim it is — though the specific way it is
not airtight changed after this section was first written; see below. The Formal
AI sidecar's own upstream calls are likewise not routed yet. Every routed run
prints the gaps that apply to it rather than implying full coverage.

## Post-upgrade re-audit (2026-08-26)

Everything above was measured against router `v0.109.0`. This section records a
re-audit against `v0.119.0`, which is what the PR now pins. It is kept separate
rather than edited into the text above, because the value of a case study is
that it says what was true when, and three of the five findings below only exist
because the earlier text was re-read against a newer version.

### What changed upstream

| Report                                                            | Filed      | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [router#272](https://github.com/link-assistant/router/issues/272) | 2026-08-22 | **Fixed** in [router#273](https://github.com/link-assistant/router/pull/273), shipped `v0.110.0` — 17 minutes after this PR's comment describing it as open. The router now asks GitHub's compare API whether the proposed tip is ahead of the current one, forwards only when it is, and fails closed on a non-success, an unparseable body or a network error. Upstream took the stronger fix rather than the interim capability guard that was suggested. |
| [router#322](https://github.com/link-assistant/router/issues/322) | 2026-08-26 | **Fixed.** Per-token request-log compaction discarded the oldest records in place with no marker, so a truncated audit log was indistinguishable from a complete one. `discard_marker()` now records what was dropped, budget-accounted so the marker fits inside the bound.                                                                                                                                                                                 |
| [router#323](https://github.com/link-assistant/router/issues/323) | 2026-08-26 | **Partially fixed.** A refusal now names the ids the deployment does advertise (`advertised_detail()`, capped at 24). Tier-alias resolution was declined, consistent with [router#192](https://github.com/link-assistant/router/issues/192)'s decision to carry no built-in model list.                                                                                                                                                                      |
| [router#324](https://github.com/link-assistant/router/issues/324) | 2026-08-26 | **Fixed.** The README gave `CLAUDE_CLI_BIN` a default of `claude` while the code and the surrounding text said unset — on the one setting that decides whether the router spends the subscription unattended.                                                                                                                                                                                                                                                |
| [router#329](https://github.com/link-assistant/router/issues/329) | 2026-08-26 | **Open.** See below.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### The R13 gap that was there all along

The original analysis assessed R13's gh-API half by the denials the router
advertises: every `DELETE`, forced REST ref updates, destructive GraphQL
mutations. That is what `GitHubPolicy::decision` implements, and it is a good
default. What it does not do is key on _effect_, and GitHub's API does not make
the verb match the consequence:

| Call                                            | Effect                                           | Denied? |
| ----------------------------------------------- | ------------------------------------------------ | ------- |
| `DELETE /repos/{o}/{r}/branches/{b}/protection` | Removes branch protection                        | Yes     |
| `PUT /repos/{o}/{r}/branches/{b}/protection`    | **Replaces** it wholesale — same end state       | No      |
| `PUT /repos/{o}/{r}/rulesets/{id}`              | Relaxes a ruleset to nothing                     | No      |
| `POST /repos/{o}/{r}/transfer`                  | Moves the repository to another owner            | No      |
| `PATCH /repos/{o}/{r}`                          | Flips `visibility`, `archived`, `default_branch` | No      |

This matters more than an ordinary policy gap because branch protection is the
layer this document, the router's README, and [router#273](https://github.com/link-assistant/router/pull/273)'s
own resolution all lean on as the backstop. A routed token that can rewrite that
object with a `PUT` puts the backstop inside the blast radius of the thing it
backstops. Token scoping (`--github-repo`) bounds _which_ repository, not what
may be done inside it — and that repository is the one whose history the task is
working on. In practice the ceiling is the permissions of the `gh` credential
the router presents upstream, but that is a bound the deployment happens to
have, not one the proxy asserts.

### Two things this re-audit could not do

Both are recorded so the next reader does not mistake absence of evidence for
evidence of absence:

1. **Nothing here was re-measured live.** The host was out of disk (339 MiB free
   of 460 GiB) and Docker's containerd store began erroring on write, so no
   probe in `experiments/issue-2164/` could be re-run. Every claim in this
   section is read from `v0.119.0` sources — `src/github_proxy.rs`,
   `src/git_proxy.rs`, `src/request_log.rs`, `src/model_routing.rs`,
   `src/config.rs` — and from the pinned README, not observed. The
   `data/measurements/` logs still record `v0.109.0` behaviour and are left
   as-is; re-run the probes before treating them as current.
2. **`router tokens issue`'s stdout was not re-verified.** [router#317](https://github.com/link-assistant/router/pull/317)
   rewrote much of the CLI (`src/cli.rs`, −278 lines), and
   `issueRouterTaskToken()` consumes that stdout as the raw token. The parse is
   guarded — a value not starting with `la_sk_` produces a named error and the
   launch falls back to the default mounts — so a format change fails loudly
   rather than silently, but it is unconfirmed at the new pin.

### One finding that is ours, not the router's

The "model aliases are rejected" limit has been recorded here since the first
draft, but with no probe behind it. Tracing it during this re-audit put the
remedy on our side of the boundary: `buildRouterTaskEnv()` exports only
`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY`. Claude
Code carries `ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_MODEL` / `_HAIKU_MODEL`
for exactly this situation — pointing a tier name at whatever concrete id a
gateway advertises. Hive Mind sets them only in plan mode, and sets them to
alias values (`String(options.planModel)`, e.g. `'opus'`), so they would not
resolve anything even there.

Resolving tiers against the router's `GET /v1/models` at launch and exporting
concrete ids would close the gap with no upstream change, and would restore
`--plan`, `--escalate` and the built-in fallback chains on a routed run. That is
left out of this PR deliberately: it is a behaviour change resting on an
inference about how Claude Code consumes those variables, and it wants a
measurement first. With [router#323](https://github.com/link-assistant/router/issues/323)
fixed, the refusal now lists the accepted ids, so a single routed run settles
it.
