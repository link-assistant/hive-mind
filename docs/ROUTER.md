# Router isolation (`--use-router`) (languages: en • [zh](ROUTER.zh.md) • [hi](ROUTER.hi.md) • [ru](ROUTER.ru.md))

> **⚠️ EXPERIMENTAL.** The flag exists, the sidecar works, and the parts that are not yet covered are listed under [Coverage gaps](#coverage-gaps) — every routed run prints them too. Read that section before relying on this for isolation.

By default, a Docker-isolated task is handed the operator's real subscription: `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` and `~/.config/gh` are bind-mounted into the container. The agent inside holds the raw vendor OAuth credential, can spend the subscription without limit, and leaves no record of what it did beyond whatever it chose to write itself.

`--use-router` withholds those mounts. The credentials stay in a single `hive-mind-router` sidecar container, each task receives its own short-lived token, and every model request lands in that token's own log.

```bash
solve https://github.com/owner/repo/issues/42 --isolation docker --use-router
```

## What changes

|                       | Default                    | `--use-router`                                              |
| --------------------- | -------------------------- | ----------------------------------------------------------- |
| Vendor credential     | Bind-mounted into the task | Mounted only into the sidecar                               |
| Task's model endpoint | api.anthropic.com          | `http://link-assistant-router:8080`                         |
| Task's credential     | The subscription itself    | `la_sk_…` token scoped to that one task                     |
| Token lifetime        | —                          | 24 h or 5000 requests, revoked when the task ends           |
| Request log           | None                       | One redacted JSONL file per token, kept after revocation    |
| Network               | Task's own                 | Task also joined to the internal `hive-mind-router` network |

Nothing changes without the flag. The default path is untouched, which is deliberate: this is opt-in isolation, not a migration.

## How it works

1. **Sidecar.** The first routed task starts `ghcr.io/link-assistant/router:latest` as `hive-mind-router` on an `--internal` Docker network — internal, so the sidecar has no route to the outside world except the one Docker gives it, and nothing on the host can reach it either. The operator's `~/.claude`, `~/.codex`, `~/.gemini` and `~/.qwen` are mounted into it and pointed at by `CLAUDE_CODE_HOME`, `CODEX_HOME`, `GEMINI_HOME` and `QWEN_HOME`. This is the only place the subscription exists (R3).
2. **Token.** Hive Mind mints one token per task through `router token issue`, with the session id as the token's subject. Tokens are never shared between tasks — that is what makes each task's log its own (R6).
3. **Task.** The task container is joined to the router network in addition to its own, and receives `ANTHROPIC_BASE_URL` (or `OPENAI_BASE_URL` for the OpenAI-compatible tools) pointing at the sidecar, plus the token. Claude Code sends _every_ request through `ANTHROPIC_BASE_URL`, including agentic sub-loops, so there is no path that quietly escapes the proxy.
4. **Lease.** The sidecar is reference-counted by lease, not by a boolean. It runs while at least one task holds a lease and is stopped when the last one is released (R5). Stopping never touches the data volume.
5. **End of task.** When the lease is dropped, the task's `~/.claude`, `~/.claude.json` and `~/.codex` are copied into the router's data volume under `task-sessions/<sessionId>/` before the token is revoked (R7). `docker cp` works on stopped containers, so a task that crashed or was killed is drained just as well as one that exited cleanly.

A killed bot or a rebooted host cannot leave the sidecar running forever: the Telegram bot reconciles leases against Docker every five minutes and stops a sidecar no live task is using. Leases younger than an hour are kept regardless, so a task that is still launching is never torn out from under.

## The audit trail

The point of the whole arrangement is that afterwards you can answer "what did this agent actually do?".

- `requests/<token-hash>/requests.jsonl` — every request that token made, redacted.
- `audit.jsonl` — token issuance, rotation and revocation.
- `task-sessions/<sessionId>/` — the agent's own session transcripts, drained from the container before it was reclaimed.

These live in the named volume `hive-mind-router-data`, which **no Hive Mind code path ever removes**. It outlives the sidecar; stopping or recreating the router does not touch it. To read it back — including when no router is running — see [Collecting logs](./COLLECTING-LOGS.md):

```bash
node examples/collect-logs.mjs --out ./audit
```

## Configuration

| Variable                            | Meaning                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_USE_ROUTER=1`            | Same as passing `--use-router`; how the bot and nested `solve` runs inherit the decision                   |
| `HIVE_MIND_ROUTER_URL`              | Use an already-running router instead of starting a sidecar. Must be a bare `http(s)://host[:port]` origin |
| `HIVE_MIND_ROUTER_TOKEN`            | Token for that external router. Required when `HIVE_MIND_ROUTER_URL` is set                                |
| `HIVE_MIND_ROUTER_SIDECAR=0`        | Never start or stop a sidecar (for operators who manage the router themselves)                             |
| `HIVE_MIND_ROUTER_IMAGE`            | Override the router image                                                                                  |
| `HIVE_MIND_ROUTER_EXTRA_ARGS`       | Extra `docker run` arguments for the sidecar                                                               |
| `HIVE_MIND_ROUTER_TOKEN_SECRET`     | Supply the token signing secret instead of generating one                                                  |
| `HIVE_MIND_ROUTER_GH_HOST`          | HTTPS-terminated router endpoint for `gh` traffic (see below)                                              |
| `HIVE_MIND_ROUTER_DRAIN_SESSIONS=0` | Do not archive session data at end of task                                                                 |
| `HIVE_MIND_SESSION_ARCHIVE_DIR`     | Archive session data to this host directory instead of the router volume                                   |

### The signing secret

The secret that signs tokens is generated once and stored in the bot state directory at mode `0600`. Anyone holding it can mint tokens for the subscription, so:

- it is never placed in the environment of a task;
- it is never written to a log;
- `examples/collect-logs.mjs` deliberately refuses to copy the state directory into an evidence archive, and reports its path instead.

If you supply your own via `HIVE_MIND_ROUTER_TOKEN_SECRET`, treat it as a root credential.

## Coverage gaps

Every routed run prints these before it starts. They are the honest limits of the experimental state:

- **GitHub traffic is not routed** unless you set `HIVE_MIND_ROUTER_GH_HOST`. `gh` builds a custom host's REST base as `https://<host>/api/v3/` with no plaintext option, while the router serves plain HTTP and ships no TLS listener (reported upstream as [router#263](https://github.com/link-assistant/router/issues/263)). Without an HTTPS-terminated endpoint the task keeps its own `gh` credential.
- **`--model formal-ai` is not routed.** Automatic routing ignores stored OpenAI-compatible providers ([router#260](https://github.com/link-assistant/router/issues/260)), so Formal AI traffic still goes straight to its own sidecar.
- **Destructive git operations are not blocked by the router** ([router#261](https://github.com/link-assistant/router/issues/261)). Force-push and branch deletion travel over the git transport, which the router does not proxy; [branch protection](./BRANCH_PROTECTION_POLICY.md) remains the control.

## Requirements

- `--isolation docker`. Router isolation has no meaning without a container to isolate.
- Docker able to pull `ghcr.io/link-assistant/router:latest`.
- If the router cannot be reached, the task is **not launched**. Falling back to direct credentials would silently undo the isolation the flag was asked for.

## See also

- [Collecting logs](./COLLECTING-LOGS.md) — every log location in the system and how to gather them
- [Docker support](./DOCKER.md) — the isolation the router builds on
- [Branch protection policy](./BRANCH_PROTECTION_POLICY.md) — the control for destructive git operations
- [Case study: issue #2164](./case-studies/issue-2164/README.md) — requirement-by-requirement analysis behind this design
