# Router isolation (`--use-router`) (languages: en • [zh](ROUTER.zh.md) • [hi](ROUTER.hi.md) • [ru](ROUTER.ru.md))

> **⚠️ EXPERIMENTAL.** The flag exists, the sidecar works, and the parts that are not yet covered are listed under [Coverage gaps](#coverage-gaps) — every routed run prints them too. Read that section before relying on this for isolation.

By default, a Docker-isolated task is handed the operator's real subscription: `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` and `~/.config/gh` are bind-mounted into the container. The agent inside holds the raw vendor OAuth credential, can spend the subscription without limit, and leaves no record of what it did beyond whatever it chose to write itself.

`--use-router` withholds those mounts. The credentials stay in a single `hive-mind-router` sidecar container, each task receives its own short-lived token, and every model request lands in that token's own log.

```bash
solve https://github.com/owner/repo/issues/42 --isolation docker --use-router
```

## What changes

|                        | Default                    | `--use-router`                                              |
| ---------------------- | -------------------------- | ----------------------------------------------------------- |
| Vendor credential      | Bind-mounted into the task | Mounted only into the sidecar                               |
| Task's model endpoint  | api.anthropic.com          | `https://link-assistant-router`                             |
| Task's GitHub endpoint | api.github.com directly    | api.github.com, resolved to the router inside the container |
| Task's git remote      | github.com                 | `https://link-assistant-router/git/<owner>/<repo>`          |
| Task's credential      | The subscription itself    | `la_sk_…` token scoped to that one task                     |
| Token lifetime         | —                          | 24 h or 5000 requests, revoked when the task ends           |
| Request log            | None                       | One redacted JSONL file per token, kept after revocation    |
| Network                | Task's own                 | Task also joined to the internal `hive-mind-router` network |

Nothing changes without the flag. The default path is untouched, which is deliberate: this is opt-in isolation, not a migration.

## How it works

1. **Sidecar.** The first routed task starts `ghcr.io/link-assistant/router:0.125.4` — a pinned version, so an upstream release never changes what a task talks to without a commit here — as `hive-mind-router`, attached to an `--internal` Docker network that nothing on the host can reach. It terminates TLS itself on port 443 with a self-signed certificate whose names cover both `link-assistant-router` and `api.github.com`. The operator's `~/.claude`, `~/.codex`, `~/.gemini` and `~/.qwen` are mounted into it and pointed at by `CLAUDE_CODE_HOME`, `CODEX_HOME`, `GEMINI_HOME` and `QWEN_HOME`. This is the only place the subscription exists (R3).
2. **Token.** Hive Mind mints one token per task through `router tokens issue`, labelled with the session id and scoped with `--github-repo` to the one repository the task works on. Tokens are never shared between tasks — that is what makes each task's log its own (R6).
3. **Task.** The task container is joined to the router network in addition to its own, and receives `ANTHROPIC_BASE_URL` (or a generated provider entry for the OpenAI-compatible tools) pointing at the sidecar, plus the token. Claude Code sends _every_ request through `ANTHROPIC_BASE_URL`, including agentic sub-loops, so there is no path that quietly escapes the proxy.
4. **Trust and interception.** While the start gate still holds the task's command, Hive Mind writes the router's CA into the container, points `api.github.com` at the router in `/etc/hosts`, and configures git to push through `https://link-assistant-router/git/…`. Each client is told about the CA the way it expects: `NODE_EXTRA_CA_CERTS` for Node, `SSL_CERT_FILE` for `gh` and Rust clients — which _replaces_ the system store, so they are handed a bundle of the public roots plus the router CA — `CURL_CA_BUNDLE` for curl, and `http.<url>.sslCAInfo` for git. An unmodified `gh` therefore reaches the router without knowing it exists, and the task carries no GitHub token of its own (R12).
5. **Formal AI.** A `--model formal-ai` run has two sidecars. The router joins the Formal AI network and stores that sidecar as a provider (`router providers add`), so the model is served _through_ the router and logged like any other (R11). Registering it does not divert other tasks: the router dispatches on the model id.
6. **Lease.** The sidecar is reference-counted by lease, not by a boolean. It runs while at least one task holds a lease and is stopped when the last one is released (R5). Stopping never touches the data volume.
7. **End of task.** When the lease is dropped, the task's `~/.claude`, `~/.claude.json` and `~/.codex` are copied into the router's data volume under `task-sessions/<sessionId>/` before the token is revoked (R7). `docker cp` works on stopped containers, so a task that crashed or was killed is drained just as well as one that exited cleanly.

A killed bot or a rebooted host cannot leave the sidecar running forever: the Telegram bot reconciles leases against Docker every five minutes and stops a sidecar no live task is using. Leases younger than an hour are kept regardless, so a task that is still launching is never torn out from under.

## The audit trail

The point of the whole arrangement is that afterwards you can answer "what did this agent actually do?".

- `requests/<token-hash>/requests.jsonl` — every request that token made, redacted.
- `audit.jsonl` — one line per authorised request: time, token id, the session label the token was issued with, provider, surface, path and model.
- `task-sessions/<sessionId>/` — the agent's own session transcripts, drained from the container before it was reclaimed.

These live in the named volume `hive-mind-router-data`, which **no Hive Mind code path ever removes**. It outlives the sidecar; stopping or recreating the router does not touch it. To read it back — including when no router is running — see [Collecting logs](./COLLECTING-LOGS.md):

```bash
node examples/collect-logs.mjs --out ./audit
```

## Configuration

| Variable                             | Meaning                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_USE_ROUTER=1`             | Same as passing `--use-router`; how the bot and nested `solve` runs inherit the decision                      |
| `HIVE_MIND_ROUTER_URL`               | Use an already-running router instead of starting a sidecar. Must be a bare `http(s)://host[:port]` origin    |
| `HIVE_MIND_ROUTER_TOKEN`             | Token for that external router. Required when `HIVE_MIND_ROUTER_URL` is set                                   |
| `HIVE_MIND_ROUTER_SIDECAR=0`         | Never start or stop a sidecar (for operators who manage the router themselves)                                |
| `HIVE_MIND_ROUTER_IMAGE`             | Override the router image                                                                                     |
| `HIVE_MIND_ROUTER_ROUTES`            | Force the route dialect, `legacy` or `canonical`, when the image tag does not say (a digest, or `latest`)     |
| `HIVE_MIND_ROUTER_EXTRA_ARGS`        | Extra `docker run` arguments for the sidecar                                                                  |
| `CODEX_CLIENT_VERSION`               | Codex client version the router claims to the ChatGPT backend; unset means the router's own recent default    |
| `HIVE_MIND_ROUTER_TOKEN_SECRET`      | Supply the token signing secret instead of generating one                                                     |
| `HIVE_MIND_ROUTER_GH_HOST`           | Reach GitHub through this HTTPS host instead of intercepting `api.github.com` (needed for an external router) |
| `HIVE_MIND_ROUTER_GITHUB=0`          | Do not route GitHub traffic at all; the task keeps its own `gh` credential                                    |
| `HIVE_MIND_ROUTER_DRAIN_SESSIONS=0`  | Do not archive session data at end of task                                                                    |
| `HIVE_MIND_SESSION_ARCHIVE_DIR`      | Archive session data to this host directory instead of the router volume                                      |
| `HIVE_MIND_GIT_HOOKS_DIR`            | Host directory holding the generated `pre-push` guard (default `~/.hive-mind/git-hooks`)                      |
| `HIVE_MIND_ALLOW_DESTRUCTIVE_PUSH=1` | Let a routed task force-push or delete remote refs anyway                                                     |

### The signing secret

The secret that signs tokens is generated once and stored in the bot state directory at mode `0600`. Anyone holding it can mint tokens for the subscription, so:

- it is never placed in the environment of a task;
- it is never written to a log;
- `examples/collect-logs.mjs` deliberately refuses to copy the state directory into an evidence archive, and reports its path instead.

If you supply your own via `HIVE_MIND_ROUTER_TOKEN_SECRET`, treat it as a root credential.

## Router versions and route dialects

Router `1.0.0` replaced every public route and removed the old ones, so the two
generations share **no** paths. Probing `0.119.0` and `1.2.0` side by side
([`experiments/issue-2202/compare-router-routes.sh`](../experiments/issue-2202/compare-router-routes.sh))
gives disjoint columns — every path that answers on one is a `404` on the other:

| Purpose            | `legacy` (router `< 1.0`) | `canonical` (router `>= 1.0`)      |
| ------------------ | ------------------------- | ---------------------------------- |
| Health             | `/health`                 | `/api/health`                      |
| Claude / Anthropic | `/` (root)                | `/api/services/anthropic`          |
| Codex, OpenAI      | `/v1`                     | `/api/services/codex/v1`           |
| GitHub REST        | `/api/v3`                 | `/api/services/github/api/v3`      |
| GitHub GraphQL     | `/api/graphql`            | `/api/services/github/api/graphql` |
| git transport      | `/git/`                   | `/api/services/github/git/`        |
| Token management   | —                         | `/api/management/tokens`           |

Hive Mind speaks both and picks one from the tag on `HIVE_MIND_ROUTER_IMAGE`:
major `0` means `legacy`, `1` and above mean `canonical`. A tag that carries no
version — a digest, or `latest` — is assumed `canonical`; set
`HIVE_MIND_ROUTER_ROUTES` to say otherwise. Nothing else has to change: the
health probe, the per-tool base URLs, the Codex `config.toml`, the git
`insteadOf` prefix and the model-catalogue endpoints are all derived from the
dialect.

**The default pin is `0.125.4` — the highest `0.x` release — and staying below
`1.0` is a deliberate trade-off.** On
`canonical` the GitHub proxy is only mounted under `/api/services/github/…`,
while `gh` builds a custom host's REST base as `https://<host>/api/v3/` and has
no path-prefix setting — so `gh api` and GraphQL calls from a routed task are
**not** mediated on a `1.x` router. `git` is unaffected, because
`url.<prefix>.insteadOf` takes an arbitrary prefix. Moving the default pin would
therefore delete a capability this page documents, so it waits on
[router#415](https://github.com/link-assistant/router/issues/415). Point
`HIVE_MIND_ROUTER_IMAGE` at a `1.x` image if you want the newer surface; the run
will print the `gh` gap before it starts.

Within `0.x` the pin sits at the top for a reason of its own: **below `0.120.0` a
routed Codex task is told its newest models do not exist.** The ChatGPT backend
gates them behind a client `version` header, which the router only started
sending in `0.120.0`; without it `POST /responses` answers `Model not found`.
`0.119.0` and `0.125.4` were probed side by side and answer identically on all 17
routes, mint and revoke a per-task token identically, and read a mounted
subscription identically, so the bump costs nothing and removes that gap
([`docs/case-studies/issue-2202/data/measurements/router-pin-0.125.4-2026-09-04.md`](case-studies/issue-2202/data/measurements/router-pin-0.125.4-2026-09-04.md)).
It also brings `SIGTERM` handling, so `docker stop` on the sidecar no longer
waits out the full grace period before a `SIGKILL`.

Credential wiring is unchanged across both: mounting `~/.claude`, `~/.codex`,
`~/.gemini` and `~/.qwen` with the matching `*_HOME` variables is still how the
router acquires its subscriptions, and `router auth import` is _not_ needed — an
unqualified import reads the vendor's own home rather than the router's, so it
finds nothing to adopt. Measured in
[`docs/case-studies/issue-2202/data/measurements/router-credentials-and-tokens-2026-09-04.md`](./case-studies/issue-2202/data/measurements/router-credentials-and-tokens-2026-09-04.md).

## Destructive git operations

R13 of the issue asks that agents lose the physical ability to destroy data. Three layers cover it; between them, only a force push made with `--no-verify` still reaches the remote.

| Layer                                                            | What it covers                                                                                                                                   | How it is bypassed                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| [Branch protection](./BRANCH_PROTECTION_POLICY.md) on the remote | Force-push and deletion of a protected branch                                                                                                    | Not bypassable from inside a task                        |
| A `pre-push` hook in every routed task                           | Deleting any remote ref, and any push that would discard a commit the remote already has — the shape a `git reset --hard` + `push --force` takes | `git push --no-verify`                                   |
| Router-mediated git transport                                    | Ref **deletions** and **non-fast-forward updates**, refused with HTTP 403 by the router itself — unbypassable from inside the task               | An operator-set allow rule for a named ref on the router |

The hook is generated on the host under `~/.hive-mind/git-hooks` (`HIVE_MIND_GIT_HOOKS_DIR`) and mounted **read-only** into the task, so the task cannot edit the rule it is held to. Git is pointed at it with `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0=core.hooksPath` rather than `git config --global`, because the container's `~/.gitconfig` is the operator's own file, bind-mounted from the host.

Ordinary pushes, new branches and new tags are untouched, and the guard only exists in routed tasks. `--allow-fork-divergence-resolution-using-force-push-with-lease` carries the operator's existing force-push opt-in into the container; `HIVE_MIND_ALLOW_DESTRUCTIVE_PUSH=1` does the same by hand.

Layer 3 is in place: a routed task pushes through `https://link-assistant-router/git/<owner>/<repo>` with no GitHub credential of its own, and `git push origin :branch` comes back `HTTP 403` from the router. A force push is refused too, from router `0.110.0` onward: the router asks GitHub's compare API whether the proposed tip is ahead of the current one and forwards the packfile only if it is, refusing outright when it cannot get an answer it trusts ([router#272](https://github.com/link-assistant/router/issues/272), fixed in [router#273](https://github.com/link-assistant/router/pull/273)). This repository pins `0.125.4`, so that layer is live.

That was measured against `0.109.0`, before the fix, and the pin has since moved twice without the probe being re-run — see `experiments/issue-2164/probe-git-transport.sh` if you want the current number rather than the recorded one.

Layer 2 is a speed bump, not a cage: an agent that reads this page can get past it. It removes the accident, not the adversary. Layers 1 and 3 are the ones a task cannot talk past — with the caveat in the next section that layer 1 is itself reachable through the GitHub API.

## Coverage gaps

Every routed run prints these before it starts. They are the honest limits of the experimental state:

- **Destructive GitHub API calls are blocked by method, not by effect** ([router#329](https://github.com/link-assistant/router/issues/329)). The router refuses every `DELETE`, forced REST ref updates and destructive GraphQL mutations. It does not refuse the same outcomes spelled differently: `PUT /repos/{o}/{r}/branches/{b}/protection` replaces a protection object wholesale, `PUT .../rulesets/{id}` relaxes a ruleset, `POST .../transfer` moves the repository, and `PATCH /repos/{o}/{r}` can flip `visibility`, `archived` or `default_branch`. Branch protection is reachable this way, so treat it as a strong default rather than a control the task cannot touch, and keep anything that must not change outside the token's `--github-repo` scope. Bounded in practice by the permissions of the `gh` credential the router presents upstream.
- **The Formal AI sidecar's own upstream calls are not routed.** `--model formal-ai` reaches Formal AI through the router, but if that server itself calls a vendor API, that leg leaves the sidecar directly.
- **Non-Claude tools are less exercised.** codex, gemini and qwen are wired through the router's OpenAI-compatible surface and a generated provider entry; only Claude Code has an end-to-end proof in `experiments/issue-2164/`.
- **Model aliases are rejected.** The router ships no alias table by design ([router#192](https://github.com/link-assistant/router/issues/192)) and declined to add tier resolution when it was raised ([router#323](https://github.com/link-assistant/router/issues/323)), so `--model sonnet` fails where `--model claude-sonnet-4-5-20250929` works. Since `0.115.0` the refusal lists the ids the deployment does advertise, so a wrong name tells you the right one. This affects the tier-shaped surface generally — `--plan`, `--escalate` and the built-in fallback chains all name tiers — so pin dated ids on a routed run.
- **A `1.x` router cannot mediate `gh`.** Its GitHub proxy lives under `/api/services/github/api/v3`, and `gh` has no path-prefix setting, so `gh api` and GraphQL leave the task unmediated while `git` stays routed. Only reachable by opting in with `HIVE_MIND_ROUTER_IMAGE`; the default pin does not have this gap ([router#415](https://github.com/link-assistant/router/issues/415)).
- **`HIVE_MIND_ROUTER_GITHUB=0` turns GitHub routing off**, and an external router (`HIVE_MIND_ROUTER_URL`) has no container network of ours to intercept in, so it needs `HIVE_MIND_ROUTER_GH_HOST`. In both cases the task keeps its own `gh` credential and its GitHub calls are not mediated.

## Requirements

- `--isolation docker`. Router isolation has no meaning without a container to isolate.
- Docker able to pull `ghcr.io/link-assistant/router:0.125.4` (override with `HIVE_MIND_ROUTER_IMAGE`). `0.110.0` is the floor — earlier versions forward a force push, and below `0.120.0` new Codex models are unreachable. `1.x` images work too, with the `gh` caveat above.
- If the router cannot be reached, the task is **not launched**. Falling back to direct credentials would silently undo the isolation the flag was asked for.

## See also

- [Collecting logs](./COLLECTING-LOGS.md) — every log location in the system and how to gather them
- [Docker support](./DOCKER.md) — the isolation the router builds on
- [Branch protection policy](./BRANCH_PROTECTION_POLICY.md) — the control for destructive git operations
- [Case study: issue #2164](./case-studies/issue-2164/README.md) — requirement-by-requirement analysis behind this design
- [Case study: issue #2202](./case-studies/issue-2202/README.md) — the route-dialect measurements and the reasoning behind the pin
