# Issue #2289 — Hive Mind compared with Google AX (`google/ax`)

## Executive summary

[Issue #2289](https://github.com/link-assistant/hive-mind/issues/2289) asks for
a comparison of Hive Mind with [`google/ax`](https://github.com/google/ax), a
data collection under `docs/case-studies/issue-2289`, a list of the issue's
requirements, and a solution plan for each, using existing components and
libraries where they help.

The short answer is that **AX and Hive Mind sit at different layers and
complement each other rather than compete**:

- **AX** ("Agent eXecutor", Go, Apache-2.0) is **infrastructure**. It is a
  `kubectl`-shaped control plane that takes a declarative `Task` / `Workspace` /
  `Model` manifest, runs the task as a sandboxed, suspendable actor on
  [Agent Substrate](https://github.com/agent-substrate/substrate) (Kubernetes +
  gVisor/microVMs), pre-wires Git repositories, MCP servers and skills, and lets
  an operator `watch`, `ssh`, `suspend` and `resume` it. It does not know what an
  issue, a pull request, CI or a code review is. It needs a Kubernetes cluster,
  Agent Substrate, Redis, `ko` and a container registry.
- **Hive Mind** (Node.js, Unlicense) is an **application**. It turns a GitHub
  issue into a reviewed pull request: it forks/clones, prepares a branch and a
  draft PR, runs one of six AI CLIs (`claude`, `codex`, `opencode`, `agent`,
  `qwen`, `gemini`), watches CI, continues on feedback, restarts or resumes on
  failures and limit resets, and is driven from a terminal or a Telegram bot. It
  runs on a single host (or a Helm-deployed pod) and isolates each work session
  in `screen`, `tmux` or Docker through
  [`link-foundation/start`](https://github.com/link-foundation/start).

Everything AX offers is **a possible execution backend for Hive Mind**, not a
replacement for it. The parts of AX worth borrowing are (1) a stronger sandbox
runtime (gVisor/microVM instead of privileged Docker), (2) checkpointing idle
work sessions instead of holding a container while waiting for a usage-limit
reset, (3) an optional egress allowlist, and (4) machine-readable task phases
and conditions. The recommended plan, in [§8](#8-solution-plans-per-requirement)
and [§10](#10-recommendations-and-phased-plan), is to adopt those ideas
**incrementally through the existing `start` isolation layer**, and to defer any
direct AX integration until AX leaves `v1alpha1` — it has already had one
complete redesign (September 19, 2026) and one primitive removed (September 24, 2026) since its first release in May 2026.

## 1. Requirements extracted from the issue

The issue body is short, so every clause is treated as a requirement. There were
no comments on the issue or on
[PR #2310](https://github.com/link-assistant/hive-mind/pull/2310) when this
analysis was written (checked 2026-09-27).

| ID  | Requirement (issue wording)                                                                           | Where it is addressed                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | "Compare with https://github.com/google/ax"                                                           | [§4](#4-what-ax-is-verified-facts), [§5](#5-architecture-side-by-side), [§6](#6-feature-by-feature-comparison), and a new section in [`docs/COMPARISON.md`](../../COMPARISON.md) (all four languages) |
| R2  | "collect data related about the issue … compile that data to `./docs/case-studies/issue-{id}` folder" | [`data/`](data/) — see [§2](#2-collected-data)                                                                                                                                                        |
| R3  | "use it to do deep case study analysis"                                                               | [§5](#5-architecture-side-by-side)–[§7](#7-can-hive-mind-run-on-ax-today)                                                                                                                             |
| R4  | "search online for additional facts and data"                                                         | [§3](#3-online-sources) — Google Cloud blog, agentexecutor.io, InfoQ, Devlery, Hacker News, Agent Substrate                                                                                           |
| R5  | "list of each and all requirements from the issue"                                                    | This table                                                                                                                                                                                            |
| R6  | "propose possible solutions and solution plans for each requirement"                                  | [§8](#8-solution-plans-per-requirement), [§10](#10-recommendations-and-phased-plan)                                                                                                                   |
| R7  | "check known existing components/libraries, that solve similar problem or can help in solutions"      | [§9](#9-existing-components-and-libraries)                                                                                                                                                            |

Because the comparison itself is the deliverable, R6 is interpreted as: for
every capability gap the comparison finds, state whether Hive Mind should close
it, how, and with which existing component.

## 2. Collected data

All files are under [`data/`](data/). The AX files are verbatim copies from
commit [`d0bc38b`](https://github.com/google/ax/commit/d0bc38bcf90bb2ad9c012ff1be9d68ff05347ba9)
(2026-09-25, tag `v0.3.1`), redistributed under AX's Apache-2.0 license, which is
included. The folder is excluded from Prettier so that the copies stay verbatim.

| File                                                                                                                       | What it contains                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`data/ax-repo-metadata.json`](data/ax-repo-metadata.json)                                                                 | `gh repo view google/ax` on 2026-09-27: created 2026-03-30, 12,123 stars, 585 forks, Go (≈307 KB of source) plus small Python/Shell/Makefile parts, Apache-2.0. |
| [`data/ax-git-facts.md`](data/ax-git-facts.md)                                                                             | Tags with dates, commit count (641), top contributors, the two redesign commits, line count, and the full file list.                                            |
| [`data/ax-snapshot/`](data/ax-snapshot/)                                                                                   | `README.md`, `DESIGN.md`, `docs/*.md`, `ax.proto`, `example-task.yaml`, `LICENSE` at `v0.3.1`.                                                                  |
| [`data/ax-snapshot/v0.1.0/README.md`](data/ax-snapshot/v0.1.0/README.md)                                                   | The README of the first release, showing the earlier "distributed agent runtime with an event log" design.                                                      |
| [`data/agent-substrate-README.md`](data/agent-substrate-README.md), [`…metadata.json`](data/agent-substrate-metadata.json) | The runtime AX depends on: density, suspend/resume, gVisor/microVM claims.                                                                                      |
| [`data/hn-49780797-top-comments.md`](data/hn-49780797-top-comments.md)                                                     | The 20 most-discussed top-level comments of the Hacker News thread (666 points), fetched from the Algolia API.                                                  |
| [`data/related-projects.tsv`](data/related-projects.tsv)                                                                   | Stars, license, language, and description of the related projects listed in [§9](#9-existing-components-and-libraries).                                         |

## 3. Online sources

| Source                                                                                                                                                                                 | Date       | Facts used                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Google Cloud blog: "Agent Executor: Google's distributed agent runtime"](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime) | 2026-05-21 | Authors Jaana Dogan and Ethan Bao; five headline capabilities (durable execution, secure isolation, session consistency, connection recovery, trajectory branching); launched with Agent Substrate; "available now in preview". |
| [agentexecutor.io](https://agentexecutor.io)                                                                                                                                           | 2026-09-27 | Four primitives advertised (Task, Workspace, **Gateway**, Model); "billions of tasks" per cluster; "sub-second resumption"; use cases: coding agents, notebooks, headless browser tests, RL loops, evaluation.                  |
| [InfoQ: "Google Open-Sources AX, a Kubernetes Style Orchestrator for Autonomous AI Agents"](https://www.infoq.com/news/2026/09/google-ax-orchestrator/)                                | 2026-09-22 | gVisor sandboxes; community split between "idle agents are expensive" and "Kubernetes overhead"; positioned as a runtime, not an application orchestrator like LangGraph or CrewAI.                                             |
| [Devlery: "Google AX preview turns interrupted agents into resumable runtime work"](https://devlery.com/en/blog/google-agent-executor-ax-runtime)                                      | 2026-06    | v0.1.0 on 2026-05-20; about 1.5k stars by 2026-06-04; AX is "a serving layer around harnesses", not a harness, framework, or managed service.                                                                                   |
| [Hacker News item 49780797](https://news.ycombinator.com/item?id=49780797)                                                                                                             | 2026-09-20 | 666 points. Recurring themes: "why Kubernetes?", "I already use VMs or tmux sessions", "Docker is not good enough for untrusted code", comparisons with Google's own Scion.                                                     |
| [Agent Substrate README](https://github.com/agent-substrate/substrate)                                                                                                                 | 2026-09-27 | "10x higher density than standard container runtimes", "sub-500ms resume", "over 500 suspend/resume activations per second", microVM and gVisor backends, pre-1.0.                                                              |

## 4. What AX is (verified facts)

### 4.1 Timeline

| Date       | Event                                                                                                                                                                     | Evidence                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-01    | Earliest commits in the history (the history predates the public repository).                                                                                             | `git log --reverse`                                                  |
| 2026-03-30 | GitHub repository created.                                                                                                                                                | `createdAt` in [`ax-repo-metadata.json`](data/ax-repo-metadata.json) |
| 2026-05-19 | `v0.1.0` (Devlery reports 2026-05-20): "distributed agent runtime" with a single-writer controller, an event log, `ax exec`, `ax fork`, and sequence-number replay.       | [`v0.1.0/README.md`](data/ax-snapshot/v0.1.0/README.md)              |
| 2026-05-21 | Public announcement on the Google Cloud blog together with Agent Substrate.                                                                                               | Blog post                                                            |
| 2026-09-19 | Commit `dc4f36c` "Restructure AX into a general-purpose orchestration layer for agentic tasks" — the event-log runtime becomes a `Task`/`Workspace`/`Model` orchestrator. | [`ax-git-facts.md`](data/ax-git-facts.md)                            |
| 2026-09-20 | Hacker News front page, 666 points.                                                                                                                                       | [`hn-49780797-top-comments.md`](data/hn-49780797-top-comments.md)    |
| 2026-09-24 | Commit `0b5427c` "Remove Gateway concept to avoid bifurcation with Substrate (#395)". The website still lists Gateway as a primitive.                                     | [`ax-git-facts.md`](data/ax-git-facts.md), agentexecutor.io          |
| 2026-09-25 | `v0.3.1`, the snapshot analysed here.                                                                                                                                     | `git for-each-ref refs/tags`                                         |

**Consequence for Hive Mind:** the API is `ax.io/v1alpha1`, the README warns of
"major breaking changes prior to a stable release", and the product was
redesigned four months after launch. Anything Hive Mind builds directly on AX
today should be treated as experimental.

### 4.2 Primitives (v0.3.1)

From [`concepts.md`](data/ax-snapshot/docs/concepts.md) and
[`ax.proto`](data/ax-snapshot/ax.proto):

- **`Task`** — `image`, `command`, `env`, CPU/memory `requests`/`limits`, a list
  of bound workspaces (each with an optional plain-language `goal`), and
  `debug` (enables `ax ssh`). Status has a `phase` (`Running`, `Suspended`,
  `Failed`, `Terminating`, …) and conditions `WorkspaceReady` and `Ready`. The
  proto already reserves `PendingApproval` and `UsageStats{prompt_tokens,
completion_tokens}`, and the roadmap lists "token/timeout budgets and
  approval policies".
- **`Workspace`** — Git repositories to clone, inline files (for example an
  `AGENTS.md`), MCP servers and MCP registries, and skill registries. A `goal`
  is handed on first boot to a Google **Antigravity** agent (10-minute default
  timeout, requires `GEMINI_API_KEY`) that installs toolchains and
  dependencies. Setup runs once per workspace and is recorded with a marker
  file so that a resume does not re-clone.
- **`Model`** — provider (`google`, `anthropic`), model ID, parameters, and a
  Kubernetes secret reference, so that key rotation is one `ax apply`.

### 4.3 Architecture

`ax` CLI → `ax-server` (stateless gRPC) → Redis (hashes + streams + pub/sub) →
horizontally scaled `ax-controller` workers → Agent Substrate Control API →
an actor running `ax-task-runner` as PID 1. Redis is used instead of CRDs
because "storing millions of short-lived tasks as Kubernetes CRDs pushes etcd
past its comfort zone" ([`DESIGN.md`](data/ax-snapshot/DESIGN.md)). The runner
serves `/healthz`, `/readyz`, and a metadata API on port 80. When a task is
suspended, "Agent Substrate snapshots [`/workspace`] … and restores it into a
fresh container when the task is resumed, so the runner will see the same files
but a new process tree" ([`runner.md`](data/ax-snapshot/docs/runner.md)).
Substrate itself advertises full RAM + filesystem snapshots, but AX's runner
contract only promises the filesystem. The whole AX code base is small: about
8,000 lines of Go and Python in `cmd/`, `internal/` and `runner/` (see
[`ax-git-facts.md`](data/ax-git-facts.md)).

### 4.4 What AX explicitly is not

- Not an agent or harness: the task's `command` is whatever agent you bring.
- Not an issue-to-PR workflow: there is no notion of GitHub issues, pull
  requests, reviews, CI, or merging anywhere in the code base.
- The control plane "does not currently read the command's exit status back
  from the container" ([`runner.md`](data/ax-snapshot/docs/runner.md)), so a
  task's success or failure is not yet a first-class result.

## 5. Architecture side by side

```
AX (infrastructure layer)                    Hive Mind (application layer)
──────────────────────────                   ──────────────────────────────
ax apply -f task.yaml                         /solve <issue-url>  (Telegram)
        │                                     solve <issue-url>   (CLI)
        ▼                                     hive <repo-url>     (many issues)
ax-server ─► Redis streams                            │
        │                                             ▼
        ▼                                     solve queue (RAM/CPU/disk + Claude/
ax-controller (N replicas)                    Codex/GitHub limit throttling)
        │                                             │
        ▼                                             ▼
Agent Substrate actor (gVisor/microVM,        start-command `$ --isolated docker|screen|tmux`
suspend/resume, multiplexed on workers)       (one container per work session,
        │                                     optional CPU/memory/disk limits)
        ▼                                             │
ax-task-runner: clone repos, MCP, skills,             ▼
goal → Antigravity bootstrap, run command     fork/clone, branch, draft PR, run AI CLI,
                                              watch CI, auto-continue/resume/restart,
                                              sanitize & attach logs, auto-merge
```

The two stacks meet at exactly one point: **"run this command in an isolated
environment."** In Hive Mind that point is `buildDockerIsolationStartArgs()` in
[`src/isolation-runner.lib.mjs`](../../../src/isolation-runner.lib.mjs), which
hands the container lifecycle to `start`. In AX it is `Task.spec.image` +
`Task.spec.command`.

## 6. Feature-by-feature comparison

| Aspect                        | Google AX (v0.3.1)                                                                                                         | Hive Mind (v2.33.0)                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Category**                  | Agent orchestration runtime (infrastructure)                                                                               | Autonomous issue solver (application)                                                                                                                                                                                                                                                                                                           |
| **Unit of work**              | `Task` (a sandboxed command)                                                                                               | A GitHub issue or PR → a working session → a pull request                                                                                                                                                                                                                                                                                       |
| **Input**                     | YAML manifest via `ax apply`                                                                                               | Issue/PR URL via CLI or Telegram; `hive` scans a repository or organization                                                                                                                                                                                                                                                                     |
| **Output**                    | A running/suspended sandbox; the result is whatever the command writes                                                     | A pull request with commits, a solution summary, cost/usage, and attached sanitized logs                                                                                                                                                                                                                                                        |
| **Agent / harness**           | Bring your own; Antigravity only for goal-based setup                                                                      | Built in: Claude Code, Codex, OpenCode, `@link-assistant/agent`, Qwen Code, Gemini CLI (`--tool`)                                                                                                                                                                                                                                               |
| **Isolation**                 | Agent Substrate actor: gVisor or microVM, CPU/memory limits                                                                | `screen`, `tmux`, or Docker per session (default for the Telegram bot); Docker-in-Docker image runs `--privileged`; optional CPU/memory/disk limits ([#449](https://github.com/link-assistant/hive-mind/issues/449))                                                                                                                            |
| **Privileges inside sandbox** | Unprivileged by default; `debug: true` exposes process/file services                                                       | Full `sudo` and internet by design, so the AI can install anything it needs                                                                                                                                                                                                                                                                     |
| **Suspend / resume**          | `ax suspend` / `ax resume`; `/workspace` survives, the process tree is new (runner.md); Substrate claims sub-500 ms resume | Resume the AI tool's **session** (`--resume`, `--auto-resume-on-limit-reset`, `--on-session-kill=resume` in its own container, [#2134](https://github.com/link-assistant/hive-mind/issues/2134), [#2189](https://github.com/link-assistant/hive-mind/issues/2189)); `start --resume` restarts a stopped Docker execution. No memory checkpoint. |
| **Idle handling**             | Roadmap: idleness detection and automatic suspension for density                                                           | The queue delays new work on resource/limit pressure; Formal AI images are unloaded after 5 h idle ([#2305](https://github.com/link-assistant/hive-mind/issues/2305)); a session waiting for a limit reset keeps its process                                                                                                                    |
| **Workspace preparation**     | Declarative: Git repos, files, MCP servers/registries, skill registries, goal-driven bootstrap agent                       | Imperative, per issue: fork detection, clone, branch, draft PR, `CLAUDE.md`/task file, handoff Agent Skill, Playwright MCP; multi-GB pre-built `box` image with many toolchains                                                                                                                                                                 |
| **Model configuration**       | `Model` resource + Kubernetes secret                                                                                       | `--model` aliases, live model catalogue (`/models`), experimental router that keeps subscriptions out of task containers ([ROUTER.md](../../ROUTER.md))                                                                                                                                                                                         |
| **Credentials**               | Secret references; roadmap: SPIFFE identities, least-privilege setup/runtime split                                         | Mounted per selected tool only; `--use-router` issues a scoped short-lived token instead; outputs sanitized for secrets (including encoded ones)                                                                                                                                                                                                |
| **Network policy**            | Gateway (egress allowlist, credential injection) — **removed from the repo on 2026-09-24**, now left to Substrate          | Full internet access by design                                                                                                                                                                                                                                                                                                                  |
| **Observability**             | `ax get/describe/watch`, phases + conditions, `ax ssh`; roadmap: OpenTelemetry + trajectories                              | Telegram `/log`, `/watch`, `/terminal_watch`, `/top`, `/limits`, `/tokens`; `$ --status`; logs attached to PRs; optional Sentry                                                                                                                                                                                                                 |
| **Human in the loop**         | Proto has `PendingApproval`; no workflow yet                                                                               | GitHub PR review and comments are the loop: feedback triggers continuation, and the AI asks questions in the PR                                                                                                                                                                                                                                 |
| **Scale target**              | "Billions of tasks per cluster"                                                                                            | One host or a Helm-deployed pod, limited by AI subscription limits and host resources; parallel workers via `hive` and the queue                                                                                                                                                                                                                |
| **Deployment requirements**   | Kubernetes, Agent Substrate, Redis, `ko`, a container registry, Go                                                         | Node.js, or the Docker image, or the experimental Helm chart; GitHub CLI and an AI CLI login                                                                                                                                                                                                                                                    |
| **Language / size**           | Go, ~8k lines                                                                                                              | JavaScript (ESM), several hundred modules in `src/`                                                                                                                                                                                                                                                                                             |
| **License**                   | Apache-2.0                                                                                                                 | Unlicense (public domain)                                                                                                                                                                                                                                                                                                                       |
| **Maturity**                  | `v1alpha1`, pre-1.0, redesigned 2026-09-19                                                                                 | v2.x, released continuously                                                                                                                                                                                                                                                                                                                     |

### 6.1 What AX has that Hive Mind does not

1. **A strong sandbox by default** (gVisor/microVM). Hive Mind's Docker
   isolation shares the host kernel, and the Docker-in-Docker variant is
   `--privileged` (see `shouldRunPrivilegedDockerIsolation` in
   [`src/isolation-runner.lib.mjs`](../../../src/isolation-runner.lib.mjs)).
   Hacker News commenters echoed this ("Docker is not good enough" for untrusted
   code).
2. **Cheap suspension of idle work.** A Hive Mind session that is paused
   waiting for a Claude/Codex usage-limit reset keeps its container and process
   alive for hours. AX would suspend it, keep `/workspace`, and free the worker.
3. **Declarative, reusable workspace definitions** shared by many tasks.
4. **Egress policy** (historically Gateway, now delegated to Substrate).
5. **Machine-readable lifecycle**: `phase` plus typed conditions that tools can
   wait on.
6. **Horizontal scale-out** of the control plane across a cluster.

### 6.2 What Hive Mind has that AX does not

1. The entire **issue → pull request** workflow: fork handling, branch and draft
   PR creation, issue linking, CI waiting and re-running cancelled jobs,
   auto-continue on new comments, auto-merge with guards, repository mode
   (one PR for many issues).
2. **Agent-specific resilience**: restart on uncommitted changes, resume after
   usage-limit resets, recovery from OOM/disk-full kills, repeated-tool-call
   breaker, thinking-block recovery, transient-error retries.
3. **Subscription-aware scheduling**: the queue throttles on Claude/Codex
   session and weekly limits and on GitHub API limits, not only on RAM/CPU.
4. **Six AI tools** behind one CLI, with model aliases and a live catalogue.
5. **Human interfaces**: a Telegram bot with 20+ commands and localized output
   (en/ru/zh/hi); GitHub as the review surface.
6. **Safety of outputs**: credential sanitization of every published log and
   comment, a git push guard, and branch protection policy.
7. **Runs anywhere with little setup**: one host with Docker is enough.

## 7. Can Hive Mind run on AX today?

Mechanically, yes, with caveats. AX's runner contract
([`runner.md`](data/ax-snapshot/docs/runner.md)) allows any image as long as it
has `/usr/local/bin/ax-task-runner`. A Hive Mind task could therefore be:

```yaml
apiVersion: ax.io/v1alpha1
kind: Task
metadata:
  name: solve-issue-2289
spec:
  # Hive Mind image extended with the ax-task-runner binary (runner.md, level 1)
  image: 'ghcr.io/<org>/hive-mind-ax@sha256:…'
  command: ['solve', 'https://github.com/link-assistant/hive-mind/issues/2289', '--tool', 'claude']
  resources:
    limits: { cpu: '4', memory: '8Gi' }
```

Blockers and friction, each verified against the AX docs or Hive Mind code:

| #   | Friction                                                                                                                               | Impact                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | AX does not report the command's exit status to the control plane.                                                                     | The Telegram bot could not tell success from failure through AX; it would have to keep using PR state and `/metadata`, or embed `runner.Run` with `OnCommandExit`.        |
| F2  | Credentials: AX injects only `GEMINI_API_KEY` itself; everything else is `spec.env` (plain values in the manifest) or a custom runner. | Claude/Codex OAuth credential files, which Hive Mind mounts read-only today, have no first-class channel. The router mode (`--use-router`) fits better: one scoped token. |
| F3  | gVisor sandboxes and Hive Mind's Docker-in-Docker image (`--privileged`) do not mix.                                                   | Tasks that need Docker inside the sandbox would need the non-dind image or a microVM backend.                                                                             |
| F4  | Hard dependencies: Kubernetes + Agent Substrate + Redis + registry.                                                                    | Out of reach for the single-VPS deployments most Hive Mind users run.                                                                                                     |
| F5  | `v1alpha1` API, redesigned four months after launch.                                                                                   | Integration code would churn.                                                                                                                                             |

## 8. Solution plans per requirement

### R1, R3, R5 — comparison, deep analysis, requirement list

Done in this document and summarized for users in a new section
"6. Agent Orchestration Runtimes (Google AX)" of
[`docs/COMPARISON.md`](../../COMPARISON.md) and its
[zh](../../COMPARISON.zh.md), [hi](../../COMPARISON.hi.md) and
[ru](../../COMPARISON.ru.md) translations, so the comparison stays discoverable
next to the existing product comparisons.

### R2, R4 — data and online facts

Done in [`data/`](data/) and [§3](#3-online-sources). Every figure in this
document is either quoted from a saved file or linked to its source.

### R6 — proposals derived from the comparison

Each proposal names the gap from [§6.1](#61-what-ax-has-that-hive-mind-does-not),
the recommended solution, the existing component that makes it cheap, and a
priority. None is implemented in this PR; the issue asks for a study and plans.

| ID  | Gap                                          | Proposed solution                                                                                                                                                                                                                                                                                                                                                                                           | Existing components                                                                                                                                                                                               | Priority |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| P1  | Kernel-level isolation                       | Add an opt-in `HIVE_MIND_DOCKER_RUNTIME` (for example `runsc`) passed through `start` as `docker run --runtime`. Refuse to combine it with the `--privileged` dind image and say why. Keep `runc` as the default so nothing changes for existing users.                                                                                                                                                     | [gVisor](https://github.com/google/gvisor) `runsc`, [Kata Containers](https://github.com/kata-containers/kata-containers); needs a `--runtime` passthrough in [`start`](https://github.com/link-foundation/start) | High     |
| P2  | Holding a container while waiting for limits | When a session pauses for a usage-limit reset longer than a threshold, stop the container (`$ --stop`), keep the session ID, and continue with `start --resume` + the tool's `--resume` in a new container — the path [#2189](https://github.com/link-assistant/hive-mind/issues/2189) already uses for killed sessions. Memory checkpointing is not needed because the AI CLI's session file is the state. | `start --resume`, `session-kill-resume.lib.mjs`, `--auto-resume-on-limit-reset`; optionally [CRIU](https://github.com/checkpoint-restore/criu) / `docker checkpoint` later                                        | Medium   |
| P3  | Machine-readable lifecycle                   | Publish a small, stable status record per work session (`phase`: `Queued`/`Preparing`/`Running`/`WaitingForLimit`/`WaitingForCI`/`Completed`/`Failed`; `conditions`: `PullRequestReady`, `CIGreen`, …) derived from the data `session-status.lib.mjs` and `$ --status` already have. Useful for `/top`, dashboards, and any future orchestrator backend.                                                    | `session-status.lib.mjs`, `session-store.lib.mjs`, `start --status`                                                                                                                                               | Medium   |
| P4  | Egress control                               | Optional, off by default (full internet access is a deliberate Hive Mind feature): a Docker network whose only exit is an allowlisting proxy (AI provider, GitHub, package registries). Build on the router sidecar, which already sits between tasks and model providers.                                                                                                                                  | Router sidecar ([ROUTER.md](../../ROUTER.md)), Squid/Envoy, Docker `--internal` networks, Substrate network policies                                                                                              | Low      |
| P5  | Declarative, reusable workspace definitions  | Not recommended as a new format. Hive Mind's per-issue preparation is driven by the repository itself (contributing guidelines, CI config, `CLAUDE.md`/`AGENTS.md`), which is the right source of truth for an issue solver. Document the existing equivalents instead (task image languages, handoff skill, Playwright MCP).                                                                               | —                                                                                                                                                                                                                 | Won't do |
| P6  | Cluster-scale execution backend              | Keep the experimental Helm chart for the bot. For per-task scale-out, add a new `start` isolation backend when needed, in this order of maturity: Kubernetes Jobs → [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) → AX. Revisit AX when it ships a stable API and reports exit status (F1, F5).                                                                         | `start` backends (`screen`, `tmux`, `docker`, `ssh`), Helm chart, agent-sandbox, AX                                                                                                                               | Later    |
| P7  | Trajectory/telemetry export                  | Optional OpenTelemetry export of session phases, tool calls and token usage, alongside the existing Sentry integration; AX lists the same item on its roadmap.                                                                                                                                                                                                                                              | `sentry.lib.mjs`, `agent-token-usage.lib.mjs`, OpenTelemetry JS SDK                                                                                                                                               | Low      |

### R7 — existing components

See [§9](#9-existing-components-and-libraries).

## 9. Existing components and libraries

Stars and licenses were captured on 2026-09-27 in
[`data/related-projects.tsv`](data/related-projects.tsv).

| Project                                                                                                                      | Layer                                                     | Relevance to Hive Mind                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [google/ax](https://github.com/google/ax)                                                                                    | Orchestration runtime                                     | Candidate future backend (P6); source of the ideas in P1–P4 and P7.                                                                                                           |
| [agent-substrate/substrate](https://github.com/agent-substrate/substrate)                                                    | Sandboxed actor runtime on Kubernetes                     | What gives AX suspend/resume and density; usable without AX (kagent does).                                                                                                    |
| [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox)                                            | Kubernetes CRD for isolated, stateful singleton workloads | Lighter, Kubernetes-SIG-owned alternative for a per-task pod backend (P6).                                                                                                    |
| [kagent-dev/kagent](https://github.com/kagent-dev/kagent)                                                                    | Kubernetes-native agent framework                         | Example of an application built on Substrate, like Hive Mind would be.                                                                                                        |
| [GoogleCloudPlatform/scion](https://github.com/GoogleCloudPlatform/scion)                                                    | Multi-agent collaboration platform                        | Closer to Hive Mind's `hive` command: orchestrates teams of Claude Code/Gemini CLI/Codex/OpenCode agents; an HN commenter preferred it to AX for working with existing tools. |
| [google/gvisor](https://github.com/google/gvisor)                                                                            | User-space kernel for containers                          | P1: drop-in Docker runtime (`runsc`).                                                                                                                                         |
| [kata-containers/kata-containers](https://github.com/kata-containers/kata-containers)                                        | Lightweight VMs as containers                             | P1 alternative when Docker-in-Docker is required inside the sandbox.                                                                                                          |
| [firecracker-microvm/firecracker](https://github.com/firecracker-microvm/firecracker)                                        | microVM monitor                                           | Underlies several sandbox services; heavier to integrate directly.                                                                                                            |
| [checkpoint-restore/criu](https://github.com/checkpoint-restore/criu)                                                        | Process checkpoint/restore                                | Optional memory checkpoint for P2 (`docker checkpoint` is experimental).                                                                                                      |
| [e2b-dev/E2B](https://github.com/e2b-dev/E2B), [daytonaio/daytona](https://github.com/daytonaio/daytona)                     | Hosted/self-hosted agent sandboxes                        | Managed alternatives to running Docker on the host; each would be a `start`-level backend.                                                                                    |
| [temporalio/temporal](https://github.com/temporalio/temporal)                                                                | Durable execution engine                                  | What AX v0.1.0's event log resembled; overkill for Hive Mind, whose durable state is Git + GitHub + the AI session file.                                                      |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands), [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | Issue-solving agents                                      | Hive Mind's direct peers (application layer); already covered by [`docs/COMPARISON.md`](../../COMPARISON.md) § 5 as a category.                                               |
| [link-foundation/start](https://github.com/link-foundation/start)                                                            | Hive Mind's isolation layer                               | The single place where P1, P2 and P6 should be implemented, so every Hive Mind command benefits.                                                                              |

## 10. Recommendations and phased plan

1. **Now (this PR):** publish this case study and the user-facing comparison
   section. No code change: the issue asks for a study.
2. **Next:** P1 (opt-in gVisor runtime) — the largest security gain for the
   smallest change, and it keeps the single-host deployment model. It requires
   a `--runtime` passthrough in `start`, then one environment variable in
   `buildDockerIsolationStartArgs()`, plus a unit test of the generated args.
3. **Then:** P2 (free the container while waiting for a limit reset) and P3
   (status phases/conditions), which reuse the resume machinery from
   [#2134](https://github.com/link-assistant/hive-mind/issues/2134) and
   [#2189](https://github.com/link-assistant/hive-mind/issues/2189).
4. **Later, on demand:** P4 and P7 as opt-in features; P6 once a user needs
   cluster-scale fan-out and AX (or agent-sandbox) has a stable API.

Each of P1–P4, P6 and P7 should get its own issue so it can be reviewed and
released independently.

## 11. Conclusion

AX answers "where and how safely does an agent process run, and how do I pause
it cheaply?". Hive Mind answers "how does an issue become a correct, reviewed
pull request with as little human time as possible?". They are complementary:
AX could one day be one of Hive Mind's isolation backends, and AX's sandboxing
and suspend/resume ideas can be adopted today, incrementally, through `start`,
without taking on a Kubernetes dependency.
