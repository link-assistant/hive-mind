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
3. **Three requirements are blocked upstream**, and per the issue's own rule
   ("If … router has missing features … we should first report issues there")
   they are reported to `link-assistant/router` before the corresponding code
   lands here. They are: routing `--model formal-ai` through the same router
   without pinning the whole deployment (G1), containing destructive operations
   that travel over the **git transport** rather than the GitHub API (G2), and
   scoping the GitHub credential per task rather than per deployment (G3).
4. **One requirement is a documentation deliverable in its own right** — a
   system-wide "how to collect logs" guide (R15), which this repository does not
   have today (`ls docs/ | grep -i log` returns nothing).

The honest headline: `--use-router` can be delivered as a _credential_
isolation feature immediately, and becomes a _destructive-action_ containment
feature only once G2 lands upstream. Until then the transport half of R13 is
covered by GitHub branch protection, which Hive Mind already automates in
`src/protect-branch.mjs` and which the router's own README names as the required
backstop.

## Scope and evidence

Everything in this analysis is derived from artifacts committed under
[`data/`](data), so a reader can re-check any claim without network access.
Checksums are in [`MANIFEST.md`](MANIFEST.md).

| Source                                          | Location                                                                                                                                                                                                                                                                                                                               | What it establishes                                                                                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue #2164 body and comment feed               | [`data/github/issue-2164.json`](data/github/issue-2164.json), [`issue-2164-comments.json`](data/github/issue-2164-comments.json)                                                                                                                                                                                                       | The verbatim requirement text; the comment feed is empty, so the body is the only specification.                                                                                                                                                       |
| PR #2165 and its three comment feeds            | [`data/github/pr-2165.json`](data/github/pr-2165.json), [`pr-2165-review-comments.json`](data/github/pr-2165-review-comments.json), [`pr-2165-conversation-comments.json`](data/github/pr-2165-conversation-comments.json)                                                                                                             | No review feedback exists yet; nothing has been requested beyond the issue.                                                                                                                                                                            |
| Router README (69 KB, full)                     | [`data/upstream/router-README.md`](data/upstream/router-README.md)                                                                                                                                                                                                                                                                     | Every router capability quoted in Part 2 and every limitation quoted in Part 3.                                                                                                                                                                        |
| Router use-case docs                            | [`data/upstream/router-use-case-per-task-tokens.md`](data/upstream/router-use-case-per-task-tokens.md), [`…-with-router.md`](data/upstream/router-use-case-with-router.md), [`…-audit-and-monitoring.md`](data/upstream/router-use-case-audit-and-monitoring.md), [`…-self-hosting.md`](data/upstream/router-use-case-self-hosting.md) | The per-task token recipe, the token/server resolution order, and the audit surfaces.                                                                                                                                                                  |
| Router repo metadata, releases, full issue list | [`data/upstream/router-repo.json`](data/upstream/router-repo.json), [`router-releases.json`](data/upstream/router-releases.json), [`router-issues.json`](data/upstream/router-issues.json)                                                                                                                                             | Latest release `v0.105.0` (2026-08-21T13:23:05Z); **all 139 issues are closed, none open** — the upstream is actively maintained and responsive, which is what makes the issue's "report upstream first" rule practical rather than a permanent block. |
| Hive Mind code snapshots                        | [`data/hive-mind/`](data/hive-mind)                                                                                                                                                                                                                                                                                                    | The exact credential seam and the Formal AI sidecar template quoted in Part 1, pinned to commit `85e37937`.                                                                                                                                            |
| Online research notes                           | [`data/research/online-research.md`](data/research/online-research.md)                                                                                                                                                                                                                                                                 | The external-component survey the issue asked for: FINOS GitProxy, LiteLLM virtual keys, `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` semantics.                                                                                                        |

## Requirements reconstructed

Every sentence of the issue body, split into an independently testable
requirement. "Blocked" means the requirement cannot be _completed_ here until an
upstream change lands; "Ready" means nothing outside this repository stands in
the way.

| #   | Requirement (issue wording condensed)                                                                                                                                  | Source sentence                                                                                                                                             | State                                               | Where it is answered      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------- |
| R1  | Add a `--use-router` option                                                                                                                                            | "We should add `--use-router` option"                                                                                                                       | Ready                                               | Part 5 · R1               |
| R2  | With it, stop attaching claude/codex files to the task's Docker; reach a `hive-mind-router` container over the Docker network instead                                  | "instead of directly attaching claude/codex files to tasks' docker … access specific hive-mind-router docker on the docker network"                         | Ready                                               | Part 5 · R2               |
| R3  | The router must be **the only point of contact with the AI subscription**, with global claude/codex files mounted from the root Hive Mind container into it            | "mount claude/codex files and folders from root hive mind docker container to it, and it will be the only point of contact with AI subscription"            | Ready                                               | Part 5 · R3               |
| R4  | Verify the router actually supports that sync                                                                                                                          | "We also need to make sure https://github.com/link-assistant/router actually supports sync with global claude/codex files/folders"                          | **Done**                                            | Part 2 · C3               |
| R5  | The Telegram bot keeps `hive-mind-router` running only while ≥1 task uses it                                                                                           | "our telegram bot must ensure we only keep hive-mind-router container running, when there any task that uses it"                                            | Ready                                               | Part 5 · R5               |
| R6  | One separately issued token per task, so each task has its own logs                                                                                                    | "For each separate task we should have separate token issued, so each task will have its own separate logs"                                                 | Ready                                               | Part 5 · R6               |
| R7  | On task finish, merge the task's claude/codex **session data** into the router or root container for security audit                                                    | "take claude/codex sessions data from it, and merge it to hive-mind-router container or root hive-mind container, as that may be needed for security audit" | Ready                                               | Part 5 · R7               |
| R8  | Mount a folder for the router data folder so all logs are preserved                                                                                                    | "mount a folder for router data folder, so all logs are preserved"                                                                                          | Ready                                               | Part 5 · R8               |
| R9  | Default keeps the current direct mount; `--use-router` isolates each task from direct subscription access                                                              | "By default we keep current mechanics … but when `--use-router` is enabled, we isolate each task"                                                           | Ready                                               | Part 5 · R9               |
| R10 | Mark the feature **experimental**                                                                                                                                      | "That feature should be marked experimental"                                                                                                                | Ready                                               | Part 5 · R10              |
| R11 | Support formal-ai routing with `--model formal-ai` through the same router/proxy                                                                                       | "it should also support formal-ai routing when used with `--model formal-ai`, so everything goes through the same router/proxy"                             | **Blocked (G1)**                                    | Part 3 · G1, Part 5 · R11 |
| R12 | Configure each task's `gh` and `git` to use the router                                                                                                                 | "configure each task's gh and git tools to use router"                                                                                                      | Partly blocked (G2)                                 | Part 5 · R12              |
| R13 | Block all delete operations and history changes (force push, `git reset` reaching a push) on `git push` **or** via the gh API                                          | "immediately apply block of all delete operations or history changes like git reset and so on detected up on git push, or used directly via gh API"         | API half **ready**, transport half **blocked (G2)** | Part 3 · G2, Part 5 · R13 |
| R14 | Make task/router logs accessible; double-check everything in that scope                                                                                                | "make sure we will be able to access logs of task/router … so we should also double check everything in that scope"                                         | Ready                                               | Part 5 · R14              |
| R15 | A dedicated docs section on collecting logs **throughout the system**, not just the router                                                                             | "special docs section about collecting logs though out of the system, not just for router"                                                                  | Ready                                               | Part 5 · R15              |
| R16 | Report missing router features upstream first; continue here once implemented                                                                                          | "If … router has missing features … we should first report issues there, once they are fully implemented we can continue"                                   | **Done** (router#260, #261, #262 filed)             | Part 3                    |
| R17 | Compile data to `docs/case-studies/issue-2164`, do deep analysis with online research, list every requirement, propose solutions and plans, survey existing components | final paragraph                                                                                                                                             | **This document**                                   | all parts                 |

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

**Reported upstream: [link-assistant/router#260](https://github.com/link-assistant/router/issues/260).**

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

_Workaround until then:_ keep the existing Formal AI sidecar path. A
`--model formal-ai --use-router` run routes model traffic to the Formal AI
sidecar and `gh`/`git` traffic to the router. That satisfies the credential and
audit goals but not the literal "everything goes through the same router".

_Requested behaviour:_ a stored `openai-compatible` provider whose `models` are
merged into the `auto` catalog and routed by model name, so one deployment can
serve vendor subscriptions and a local OpenAI-compatible endpoint at once.

### G2 — destructive operations over the **git transport** are outside the proxy

**Reported upstream: [link-assistant/router#261](https://github.com/link-assistant/router/issues/261).**

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

**Reported upstream: [link-assistant/router#262](https://github.com/link-assistant/router/issues/262).**

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

### What is _not_ a gap

For the record, these were checked and found already supported, so no upstream
issue is warranted: per-task token issuance and revocation (C1), per-task log
separation (C2), Codex/Gemini/Qwen credential homes as well as Claude (C3),
persisted audit data (C5), API-level destructive denial (C6), `gh` custom-host
support (C7), per-client setup (C8), log diagnostics (C9), a public container
image with the CLI inside (C10).

Merging a finished task's _session_ files (R7) is also not a router gap:
`~/.claude/projects/**/*.jsonl` is client-side state the CLI writes, and the
router never sees it. Collecting it is a Hive Mind responsibility, described in
Part 5 · R7.

## Part 4 — Existing components and prior art

The issue asks to "check known existing components/libraries that solve similar
problem or can help in solutions". Full notes and sources are in
[`data/research/online-research.md`](data/research/online-research.md).

| Component                                                                          | What it solves                                                                                                                                                                                | How it applies here                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Link.Assistant.Router** (`link-assistant/router`, Rust/axum, v0.105.0)           | AI-API proxy with per-task JWTs, per-token logs, vendor credential custody, GitHub API policy                                                                                                 | The component this issue is built on. Part 2 audits it.                                                                                                                                                                           |
| **FINOS GitProxy** (`finos/git-proxy`, MIT, FINOS-graduated)                       | "Stands between developers and a Git remote endpoint … and applies rules and workflows to all outgoing git push operations"; v2.0 covers **both HTTP/HTTPS and SSH**                          | Existence proof and reference design for G2. Also a fallback: Hive Mind could point tasks' `insteadOf` at a GitProxy sidecar if the router's git surface is slow to arrive. Used in production by Citi, RBC, NatWest, G-Research. |
| **git `pre-push` hook**                                                            | Client-side refusal of force pushes and branch deletions                                                                                                                                      | Cheap defence-in-depth _inside_ the task image — but client-side, so an agent that can edit `.git/hooks` or pass `--no-verify` defeats it. Suitable as a speed bump, not as the control.                                          |
| **GitHub branch protection** (`allow_force_pushes:false`, `allow_deletions:false`) | Server-side, unbypassable refusal of history destruction                                                                                                                                      | The actual control for R13's transport half today; already automated in `src/protect-branch.mjs`. Named by the router README as the necessary backstop.                                                                           |
| **LiteLLM virtual keys / agent sandboxes**                                         | The mainstream "one gateway credential + N scoped revocable keys with budgets and per-key logs" pattern; injects per-sandbox secrets as `CONTAINER_ENV_*` rather than mounting operator files | Confirms the router's per-task-token model is standard practice and that "env, not mount" is the right boundary at `getDockerIsolationAuthMounts`.                                                                                |
| **`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`** (Claude Code)                    | Redirects _every_ request the CLI makes, "including its agentic sub-loops and background calls"                                                                                               | The concrete R2 mechanism for Claude; `ANTHROPIC_AUTH_TOKEN` (Bearer) is required for gateway-minted keys — `ANTHROPIC_API_KEY` (`x-api-key`) is the documented cause of 401s against a custom base URL.                          |
| **Hive Mind's own Formal AI sidecar** (`src/formal-ai-sidecar.lib.mjs`)            | On-demand, lease-counted, internal-network container with bot-driven idle shutdown                                                                                                            | The template for R5. Reuse the pattern, not the code — a shared abstraction is proposed in Part 6.                                                                                                                                |

## Part 5 — Solutions and plans, requirement by requirement

Each entry lists the options considered, the chosen plan, and how it will be
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

_Blocked by G1._ The staged plan:

1. **Now:** `--use-router --model formal-ai` is accepted. Model traffic uses the
   existing Formal AI sidecar; `gh` traffic uses the router; credentials are
   still removed from the task. The run log states plainly that model traffic is
   not yet router-mediated and links G1. This is the honest partial delivery,
   not a silent one.
2. **After G1 lands:** register the Formal AI sidecar as a stored
   `openai-compatible` provider on the router, drop the direct
   `HIVE_MIND_FORMAL_AI_BASE_URL` injection for `--use-router` runs, and let the
   router route by model name. The task then has exactly one AI endpoint.

_Verification:_ a test asserting the staged behaviour and the warning today; the
test is updated, not replaced, when step 2 lands.

### R12 + R13 — `gh` and `git` through the router, destructive operations blocked

_`gh` (ready)._ Set `GH_HOST=<router-alias>` and
`GH_ENTERPRISE_TOKEN=$TASK_TOKEN` in the task environment (C7), and drop the
`~/.config/gh` mount (R2). The router is configured with `GITHUB_PROXY_TOKEN`
from the operator's credential and the built-in deny-by-default destructive
policy (C6), optionally narrowed by a Hive Mind-shipped `GITHUB_PROXY_POLICY`
that also denies `POST /repos/*/*/git/refs` outside the task's own branch.

_`git` (blocked by G2)._ Three layers, in the order they will be delivered:

1. **Branch protection** (available now, server-side, unbypassable):
   `src/protect-branch.mjs` already applies `allow_force_pushes: false` and
   `allow_deletions: false`.
2. **A `pre-push` hook** in the isolation image that refuses deletions
   (`--delete`, or a zero destination SHA) and non-fast-forward updates. Cheap,
   immediate, and defeated by `--no-verify` — documented as a speed bump.
3. **Router git transport** once G2 lands: point the task's git at the router
   with `git config --global url."http://<alias>/github/".insteadOf
"https://github.com/"`, so the same policy engine sees the ref updates.

The PR must not claim R13 is complete while layer 3 is missing; the docs will
say which layer is doing the work.

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

Three issues were filed against `link-assistant/router` on 2026-08-21, each
carrying the requirement it blocks, the quoted README/source evidence, the
workaround in use here, and the concrete behaviour requested:

| Upstream                                                          | Gap                                                                | Blocks                                 | Gates this PR?   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------- | ---------------- |
| [router#260](https://github.com/link-assistant/router/issues/260) | G1 — automatic routing ignores stored OpenAI-compatible providers  | R11                                    | Yes, for phase 7 |
| [router#261](https://github.com/link-assistant/router/issues/261) | G2 — destructive git-transport operations bypass the policy engine | R13 (transport half), R12 (`git` half) | Yes, for phase 8 |
| [router#262](https://github.com/link-assistant/router/issues/262) | G3 — GitHub credential and policy are per-deployment               | R6/R13 hardening                       | No — enhancement |

Both blocking issues are follow-ups to work the upstream has already done
(#71 for automatic model routing, #146 for the GitHub API proxy), which is why
they are scoped as extensions rather than new subsystems. Phases 7–9 stay
unshipped until they are answered, following the same pause rule this repository
applied in the issue #2146 case study; phases 1–6 do not depend on them and ship
now.

## Part 6 — Proposed delivery plan

| Phase | Content                                                                                                                                                                               | Gated on                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 0     | This case study, the data folder, the three upstream issues                                                                                                                           | —                                                                            |
| 1     | `docs/COLLECTING-LOGS.md` ×4 languages + the `examples/collect-logs.mjs` recipe (R15, and the R14 groundwork)                                                                         | —                                                                            |
| 2     | `--use-router` option surface on solve/hive/task/Telegram, experimental marking, default-unchanged regression test (R1, R9, R10)                                                      | —                                                                            |
| 3     | `src/router-sidecar.lib.mjs` + `src/router-isolation.lib.mjs` + maintenance-tick duty: container, internal network, leases, per-task token issue/revoke, data volume (R3, R5, R6, R8) | —                                                                            |
| 4     | Mount suppression and endpoint injection at the credential seam (R2), `gh` via `GH_HOST` (R12 API half), deny-by-default policy file (R13 API half)                                   | —                                                                            |
| 5     | Session-data preservation volume and drain (R7), router log access surfaces (R14)                                                                                                     | —                                                                            |
| 6     | `pre-push` hook layer and branch-protection wiring for `--use-router` runs (R13 layer 1–2)                                                                                            | —                                                                            |
| 7     | Formal AI through the router (R11)                                                                                                                                                    | **[router#260](https://github.com/link-assistant/router/issues/260)**        |
| 8     | git transport through the router (R13 layer 3)                                                                                                                                        | **[router#261](https://github.com/link-assistant/router/issues/261)**        |
| 9     | Per-task GitHub scope (R6/R13 hardening)                                                                                                                                              | [router#262](https://github.com/link-assistant/router/issues/262) (optional) |

Phases 1–6 are deliverable in this PR. Phases 7–9 land after upstream, and the
documentation states plainly which are missing rather than implying coverage.

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
- **Non-goal:** replacing the direct-mount path. R9 is explicit that the default
  does not change, and the regression test enforces it.

## Timeline

| When (UTC)       | Event                                                                                | Evidence                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-21 16:17 | Issue #2164 opened by konard, labels `documentation` + `enhancement`                 | [`data/github/issue-2164.json`](data/github/issue-2164.json)                                                                 |
| 2026-08-21 16:23 | Issue last updated; comment feed still empty, so the body is the whole specification | [`data/github/issue-2164-comments.json`](data/github/issue-2164-comments.json)                                               |
| 2026-08-21 13:23 | Router `v0.105.0` published — the version this analysis audits                       | [`data/upstream/router-releases.json`](data/upstream/router-releases.json)                                                   |
| 2026-08-21 16:31 | Router repository last pushed; 139 issues, **0 open**                                | [`data/upstream/router-repo.json`](data/upstream/router-repo.json), [`router-issues.json`](data/upstream/router-issues.json) |
| 2026-08-21       | Evidence collected, requirements enumerated, gaps G1–G3 identified                   | this document                                                                                                                |
| 2026-08-21       | G1 reported upstream as router#260                                                   | [router#260](https://github.com/link-assistant/router/issues/260)                                                            |
| 2026-08-21       | G2 reported upstream as router#261                                                   | [router#261](https://github.com/link-assistant/router/issues/261)                                                            |
| 2026-08-21       | G3 reported upstream as router#262                                                   | [router#262](https://github.com/link-assistant/router/issues/262)                                                            |

## Status

Phase 0 is complete: the data is compiled here, all 17 requirements are
enumerated with an owner section each, every router capability the issue assumes
has been verified against first-party evidence, and the three genuine gaps are
identified with the exact upstream behaviour to request. Phases 1–6 are
unblocked and are what PR #2165 delivers; phases 7–9 wait on
`link-assistant/router`, as the issue instructs.
