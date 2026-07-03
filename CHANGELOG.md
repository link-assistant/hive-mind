# @link-assistant/hive-mind

## 2.1.3

### Patch Changes

- 5c4150b: Make live issue/PR event input available for every tool via `--auto-input-until-mergeable` (issue #2007). Claude and Agent stream events into the live process through `--input-format stream-json`; codex, opencode, gemini, qwen, and unknown tools use a universal restart/resume fallback that waits for the current turn to finish in the JSON output, stops the process, and resumes the AI session with the new events. Adds issue title/description edit detection as a restart trigger, reworks the capability matrix to report each tool's delivery mode, and records the `@link-assistant/agent` 0.24.1 live stream-json contract.

## 2.1.2

### Patch Changes

- 39164e5: Improve fork-divergence failure comments and logs with inspected branch state, actor-aware admin guidance, exact fork-only commit lists, and less generic repository setup wording.

## 2.1.1

### Patch Changes

- 26e3410: Report estimated reclaimable space for `hive-cleanup --dry-run` system cleanup
  commands and await system-cleanup logging so dry-run output stays in order.

## 2.1.0

### Minor Changes

- 4e21d2a: Fix Docker task disk-usage reporting so Telegram completion messages use task container writable-layer samples instead of filesystem-capacity resource markers from the parent deployment.
- fdbf448: Add full support for Claude Sonnet 5 (`claude-sonnet-5`) and make it the default model for `--tool claude`. The bare `sonnet` alias now resolves to `claude-sonnet-5` (previously `claude-sonnet-4-6`). Sonnet 5 supports 1M context (`[1m]`), the full effort ladder including `xhigh` and `max`, 128K max output tokens, and adaptive-thinking-only environment handling. The `sonnet-4-6`/`claude-sonnet-4-6` aliases are retained for backward compatibility. (Issue #2003)

## 2.0.29

### Patch Changes

- 0cafc64: Add solve resource diagnostics and Docker disk-usage fallback markers so Telegram completion messages can show full container filesystem usage even when the task container cannot be inspected after exit.

## 2.0.28

### Patch Changes

- 5b4f3df: Recommend and accept `/queue` instead of the legacy solve-prefixed queue commands, and recommend `/stop` for cancelling running sessions.

## 2.0.27

### Patch Changes

- d3fdb7b: Respect explicit `--base-branch` through solve sessions by instructing agents not to retarget PRs and restoring the requested PR base before verification or auto-merge handling.

## 2.0.26

### Patch Changes

- 13074f0: Add Codex model support for the GPT-5.6 preview family, Bedrock-prefixed OpenAI Codex model IDs, and the hidden `codex-auto-review` catalog entry while keeping `gpt-5.5` as the default.

## 2.0.25

### Patch Changes

- 148ca23: Fix exit-0-but-incomplete runs being reported as success under docker isolation (#1990). A `solve` run whose AI tool exited 0 while its session was cut off mid-run (e.g. the container ran out of disk) is now registered as a failure instead of a false success: codex requires its paired `turn.started`/`turn.completed` lifecycle, and gemini and qwen now require their terminal `result` event (claude already gated on it). A flagged failure preserves the AI session for a context-preserving retry and returns a non-zero exit so the docker container filesystem is kept for inspection. Disk-exhaustion strings are surfaced only as diagnostics, never as an independent failure gate, to avoid the #1955 echo false positive.

  This also refreshes dependencies and picks up the upstream half of the #1990 fix. The
  `start-command` pin in `Dockerfile`/`Dockerfile.dind` is bumped `0.30.1 → 0.30.2`,
  which delivers [link-foundation/start#144](https://github.com/link-foundation/start/issues/144):
  detached/isolated docker runs now surface the container's `OOMKilled` status and
  preserve an abnormally-terminated container's filesystem for inspection instead of
  auto-removing it. npm dependencies and devDependencies are updated to their latest
  compatible versions (notably ESLint 9 → 10, which enables the `no-useless-assignment`
  and `preserve-caught-error` recommended rules — all newly-flagged sites were fixed).
  `jscpd` is intentionally held at `^4.0.5` because its 5.x line changes the
  duplication baseline (it analyzes a wider file set, reporting 12.2% vs 10.7% on the
  same tree) and would otherwise force weakening the duplication gate; this is a tooling
  behavior change, not new duplication.

## 2.0.24

### Patch Changes

- 4cdff62: Improve task disk usage diagnostics for repository and Docker container filesystem reporting.

## 2.0.23

### Patch Changes

- 4778963: Add `--sub-agent-model` for Claude Code subagents and agent teams. The option is accepted by solve, hive, and Telegram command parsing, validates Claude aliases/full IDs plus `inherit`, and maps to `CLAUDE_CODE_SUBAGENT_MODEL` only when explicitly provided so Claude Code defaults remain unchanged.

## 2.0.22

### Patch Changes

- 4d65c05: Make disk admission safer by default: the disk usage queue gate now waits at 80%, the absolute free-space default is 10240 MB, and isolation defaults to Docker.

## 2.0.21

### Patch Changes

- da88ee5: Add session-aware Docker-isolation container cleanup to hive-cleanup.

## 2.0.20

### Patch Changes

- 078f346: Reap successful Docker-isolated task containers at session completion, keep failed containers with cleanup instructions by default, and update Docker images to start-command 0.30.1.

## 2.0.19

### Patch Changes

- 8061979: Preserve per-command isolation overrides for queued Telegram solve commands.

## 2.0.18

### Patch Changes

- 08c2f07: Clarify fork auto-recovery safety failures so terminal exits and failure comments explain the mismatched repository, expected upstream, safety-check result, and recovery options.

## 2.0.17

### Patch Changes

- 1cec7b4: Allow bare indented LINO option/value links in .lenv configuration, matching parenthesized links.

## 2.0.16

### Patch Changes

- a448b3d: Detect incomplete Claude stream-json runs that exit without a terminal result event, capture nested Claude tool/error events, and preserve compaction summaries for diagnostics.

## 2.0.15

### Patch Changes

- 0d2f2bb: Fix "Cannot read properties of null (reading 'type')" crash that aborted Codex (and other agent) runs when the tool echoed a stream line that parsed to a bare `null` or non-object JSON primitive. All NDJSON stream parsers (Codex, Claude, Agent, OpenCode) now ignore non-object lines instead of dereferencing them.

## 2.0.14

### Patch Changes

- 03954a9: Show fuzzy suggestions for mistyped CLI and Telegram command options, including the closest match plus up to four additional alternatives.

## 2.0.13

### Patch Changes

- ca7c412: fix(branch): validate `--base-branch` existence up-front and stop misreporting a missing base branch as an empty repository (#1959)

  A `/solve` run from the Telegram bot crashed with the unactionable message
  `Branch operation failed`. Root cause: the user passed `--base-branch issue-375-8a4323e580780`
  — a **one-character typo** of the real branch `issue-375-8a4323e58078`. The branch did not
  exist, but nothing validated that before the run started. The solver cloned 72 MB, then
  `git checkout -b … origin/issue-375-8a4323e580780` failed with
  `fatal: 'origin/…' is not a commit`. Worse, the branch-creation error handler **misdiagnosed**
  this as "the repository appears to be empty (no commits)" and suggested `--auto-init-repository`,
  which is wrong for a non-empty repo. The top level then collapsed everything to the bare
  `Branch operation failed` comment on GitHub.

  Defense-in-depth fix applied across the codebase:
  - `validateGitHubEntityExistence()` (`src/github-entity-validation.lib.mjs`) gains a new
    base-branch step: when `--base-branch` is supplied, `checkBaseBranchExists()` verifies it
    via `gh api repos/{owner}/{repo}/branches/{branch}` **before** cloning, in the same fail-fast
    gate that already checks user/repo/issue/PR. A definitive 404 fails the run; transient
    errors fail open so a network hiccup never blocks a valid run.
  - New helpers `levenshteinDistance()` and `findClosestBranchName()` power a "did you mean
    '<closest-existing-branch>'?" suggestion built from the repo's actual branch list, so the
    exact real-world typo points the user straight at `issue-375-8a4323e58078`.
  - Both entry points share the gate: `src/solve.mjs` (CLI + the GitHub comment path) and
    `src/telegram-bot.mjs` (the bot pre-flight) now pass `baseBranch` in, so a missing base
    branch fails immediately at every level — including in Telegram, before the solve command
    is queued or spawned.
  - `handleBranchCreationError()` (`src/solve.branch-errors.lib.mjs`) now receives `baseBranch`
    and `branchSource`. When a custom base branch is the missing ref it reports the real root
    cause instead of the bogus empty-repository advice; the genuine empty-repository path
    (creating from the default branch) is preserved. `createOrCheckoutBranch()`
    (`src/solve.branch.lib.mjs`) threads the base branch and its source into the handler.

  Adds `tests/test-base-branch-existence.mjs` (17 offline assertions covering the helpers and
  the misdiagnosis fix), `tests/test-base-branch-existence-integration.mjs`
  (`@hive-mind-integration`, the real `gh` gate), and a deep case study in
  `docs/case-studies/issue-1959/`.

## 2.0.12

### Patch Changes

- f17bac4: fix(clone): detect interrupted clones that exit 0, retry them, and explain the failure instead of the bare "Failed to get current branch" (#1957)

  A `/solve` run crashed with the unactionable message `Failed to get current branch`.
  Root cause: `gh repo clone` (and the `git clone` it wraps) **exited 0 even though the
  transfer was interrupted** mid-stream (`fetch-pack: unexpected disconnect while reading
sideband packet`), leaving **no `.git` directory** (`size=0 B`). The solver trusted the
  exit code, logged `✅ Cloned to:`, then every subsequent git command failed with
  `fatal: not a git repository`; the first to propagate it (`git branch --show-current` in
  `verifyDefaultBranchAndStatus`) threw the bare error with no clue about what went wrong
  or how to recover.

  Defense-in-depth fix applied across the codebase:
  - `cloneRepository()` (`src/solve.repository.lib.mjs`) no longer trusts the exit code:
    after `gh repo clone` it validates the result with `git rev-parse --is-inside-work-tree`
    and only treats the clone as successful when the exit code is 0 **and** a real working
    tree exists. In `--verbose` mode it logs why a 0-exit clone was rejected.
  - New exported helper `cleanPartialClone()` empties the target directory before each
    retry so a partial clone does not make `gh repo clone <dir>` fail with "directory
    exists and is not empty".
  - `classifyCloneError()` now classifies the interrupted-transfer vocabulary
    (`unexpected disconnect`, `sideband`, `early eof`, `the remote end hung up`,
    `rpc failed`, `fetch-pack`, `index-pack failed`, `transfer closed`) as a retryable
    `NETWORK` error, so the existing 3× exponential-backoff retry loop recovers from it.
    404 / ENOSPC / auth failures stay non-retryable.
  - `isTransientNetworkError()` (`src/lib.mjs`, shared by many gh/git retry call sites)
    gains the same vocabulary, so the fix propagates everywhere — not just the clone path.
  - Both failure points now print concrete, root-cause-obvious guidance: the clone-failure
    path adds NETWORK causes/fixes, and `verifyDefaultBranchAndStatus()`
    (`src/solve.repo-setup.lib.mjs`) detects `not a git repository` and logs an
    `INCOMPLETE CLONE DETECTED` block (What happened / Error details / How to fix:
    check network·VPN·proxy, re-run — clones auto-retry, verify access, check GitHub
    status) instead of the bare message.

  Adds `tests/test-issue-1957-incomplete-clone.mjs` (26 assertions) and a deep case study
  in `docs/case-studies/issue-1957/`.

## 2.0.11

### Patch Changes

- a29902a: fix(codex): don't fail a completed turn on echoed fixture content; expand transient network auto-retry (#1955)

  A `--tool codex` run failed with `❌ Codex emitted error event: Network lookup
skipped in fixture` even though the codex session **succeeded** (`turn.completed=1`,
  `turn.failed=0`, working tree clean, full pricing produced). The phrase was not a
  real error: while building an unrelated NDJSON adapter, the codex agent printed a
  **test fixture** to its terminal. In verbose mode (`RUST_LOG=debug`) the codex CLI
  renders OTEL telemetry (`codex_otel.log_only`, `event.name="codex.tool_result"`)
  to stderr, including a raw `Output:` dump of each command's stdout. Our line-by-line
  parser — which consumes stderr as well as stdout — `JSON.parse`d the fixture line
  `{"type":"error","message":"Network lookup skipped in fixture"}` and bucketed it as
  a genuine codex stream error.
  - `getCodexErrorEventSummary()` (`src/codex.lib.mjs`) now treats any stray
    **non-`turn`** error event as non-fatal whenever the turn completed successfully
    (a `turn.completed` with no `turn.failed`). `turn.failed` remains the authoritative
    failure signal and is never suppressed; suppressed strays are still recorded in
    `ignoredEvents` (and logged per-event in verbose mode) for observability. This is
    transport-agnostic — it fixes the false positive regardless of how the echo
    arrived.
  - `classifyRetryableError()` (`src/tool-retry.lib.mjs`, shared by
    claude/codex/gemini/qwen/opencode) now classifies the full set of genuinely
    transient network faults as retryable (`isCapacity:false`): DNS failures
    (`ENOTFOUND`, `EAI_AGAIN`, "temporary failure in name resolution"), connection
    faults (`ETIMEDOUT`, `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, `EPIPE`,
    "no route to host", "network is unreachable"), and gateway errors (502/504 and
    Cloudflare `52x`); the 503 branch was broadened to "service unavailable". Aligns
    with AWS retry guidance, RFC 9110 §15.6, and the getaddrinfo(3) man-page. The
    fixture phrase itself is explicitly guarded to stay non-retryable.

  Adds `tests/test-issue-1955-codex-fixture-false-positive.mjs` (23 tests) and a deep
  case study in `docs/case-studies/issue-1955/`.

## 2.0.10

### Patch Changes

- e29c83e: Surface the docker-isolation session id + isolation backend immediately when the
  Telegram bot launches a task, instead of only after the (potentially hour-long)
  image pull / container startup finishes (#1946). `formatStartingWorkSessionMessage`
  now renders the `Session:` and `🔒 Isolation:` lines on the `🔄 Starting...`
  message, and `buildExecuteAndUpdateMessage` tracks the session up front (before
  awaiting the launch) so the run is addressable by `/watch`, `/log` and `/status`
  during the whole startup window. A new `untrackSession` helper removes the
  optimistically-tracked session if the launch fails, so a phantom session is never
  monitored or resumed. Fix applies to every caller of the shared execution path
  (`/solve`, `/hive`, `/task`).

  The image-preparation log gap and host-image re-download were reported upstream,
  fixed there, and are now pinned in this repo's images: `Dockerfile` /
  `Dockerfile.dind` bump `start-command` `0.29.1` → `0.29.2` (link-foundation/start#138
  — the `docker pull`/dind-boot phase is now recorded in the `$` session log), and
  `Dockerfile.dind` bumps its base from `konard/box-dind:2.3.2` → `2.3.5`
  (link-foundation/box#106 — the dind entrypoint now verifies host-image passthrough
  actually seeded the nested daemon instead of silently re-downloading ~30 GB). A
  deep case study is in `docs/case-studies/issue-1946/`.

- 4fcdb9a: fix(auto-merge): treat timeout-cancelled CI as a failure and never finish a session with no log when `--attach-logs` is enabled (#1952)

  A job that hits its `timeout-minutes` limit surfaces as a **check-run** with
  conclusion `cancelled`, but the **parent workflow run** concludes `failure`.
  `getDetailedCIStatus` only inspects check-runs, so the auto-merge loop saw the
  lone `cancelled` check, posted a **"Cancelled CI/CD Requires Review"** comment and
  stopped — even though the workflow run had failed and other jobs in it had failed
  too. The cancelled branch of `getMergeBlockers` now cross-references the workflow
  runs for the commit SHA via a new pure helper
  `classifyCancelledCIByWorkflowRuns` (`src/cancelled-ci-rerun.lib.mjs`):
  - a run still queued/in-progress → `ci_pending` (wait until **all** checks reach a
    terminal state before auto-restarting);
  - any completed `failure`/`timed_out`/`startup_failure` run → `ci_failure` (the AI
    is restarted to fix it, instead of stopping for human review);
  - otherwise → the original re-triggerable `ci_cancelled` flow (genuine manual
    cancellation). The "requires review" stop path is skipped whenever a `ci_failure`
    blocker coexists, and `startup_failure` is now counted as a failing run in the
    branch-health check too.

  Separately, the same session finished with **no log attached** despite
  `--attach-logs` being enabled, because every attach path in `solve.mjs` is
  conditional and the stop-for-review exits can return before any iteration uploads.
  `attachLogToGitHub` now records a process-global `logAttachedToGitHub` flag on
  every successful upload, and a final safety net (`attachFinalLogIfMissing` in the
  new `src/attach-logs-guarantee.lib.mjs`) attaches the cumulative session log at the
  end of `solve.mjs` whenever `--attach-logs` is on, a PR exists, and nothing has
  attached a log yet. A session can no longer finish with no log when `--attach-logs`
  is enabled.

  Adds `tests/test-cancelled-timeout-fail-1952.mjs` (13 tests) and
  `tests/test-attach-logs-safety-net-1952.mjs` (9 tests), plus a deep case study in
  `docs/case-studies/issue-1952/` reconstructed from the real-world trigger
  (xlabtg/teleton-agent PR #670).

## 2.0.9

### Patch Changes

- c8b241a: Fix Claude public cost estimates for 1-hour prompt-cache writes by pricing `cache_creation.ephemeral_1h_input_tokens` at the documented 2x input rate instead of the 5-minute cache-write rate.

## 2.0.8

### Patch Changes

- 072e941: fix(retry): keep the requested `--model` on transient overloads instead of switching to the fallback (#1949)

  A transient **HTTP 529 "Overloaded"** result used to be classified as a
  model-_capacity_ error (`isCapacity: true`), which made the shared retry helper
  switch the user's requested `--model` to the configured fallback
  (`opus -> opus-4-7`) on every overload. A 529 is a server-wide, transient
  overload — not a signal that the selected model is full — so the run should retry
  the **same** model. The overload branch in `src/tool-retry.lib.mjs` now returns
  `isCapacity: false`; only a genuine "the selected model is at capacity" message
  still triggers a `--model` switch. The fix lives in the shared helper, so every
  tool (claude, codex, gemini, qwen, opencode, agent) inherits it.

  Per-request fallback is now delegated to Claude Code itself: the claude tool
  forwards `--fallback-model <id>` so overloads fall back _inside_ the CLI while our
  `--model` stays stable.

  Two display fixes remove the ambiguity that made this hard to diagnose:
  - Warnings now render the resolved model ID alongside the alias, e.g.
    `opus (claude-opus-4-8) -> opus-4-7 (claude-opus-4-7)`, via a new
    `formatModelWithResolvedId` helper.
  - The verbose per-retry "execution context" block now uses a shared
    `logExecutionContext` helper that prints the resolved model actually passed to
    the CLI, replacing a broken `argv.model === 'opus' ? 'opus' : 'sonnet'`
    heuristic that mislabelled every non-`opus` alias as `sonnet`.

  The PR/issue comment now shows the requested model with its resolved ID and the
  requested thinking level (e.g. `high (~23999 tokens)`) via a new
  `describeRequestedThinking` helper.

## 2.0.7

### Patch Changes

- 6d9a2bb: feat(solve): log working-tree size before/after the AI agent and warn on Telegram when disk usage exceeds 5 GB (#1945)

  `/solve` now records the size of its temporary working tree at two checkpoints:
  after the repository is cloned (before the AI agent starts) and after the AI
  working session ends. Both checkpoints emit a structured `📊 [DISK]` marker into
  the captured solve log, so the cloned-repo size, the AI-induced delta, and the
  final total are visible in `tail -f`-style debugging.

  The session monitor parses those markers from the captured log and appends a
  `💾 Disk usage` block to the Telegram completion message. The block raises a
  warning when the cloned repository exceeds 5 GB, when the working tree grew by
  more than 5 GB during the run, or when the total disk usage for the task
  exceeds 5 GB — exactly the three conditions called out in the issue.

  Sizing uses `du -sb` (byte-accurate on Linux), falls back to `du -sk` on BSD/
  macOS, and finally to `fs.statSync` for single-file targets — no new runtime
  dependency. The threshold is 5 GiB and uses a strict `>` comparison, so a tree
  that lands at exactly 5 GiB does not warn.

## 2.0.6

### Patch Changes

- 0c63706: Stop surfacing meaningless stream fragments as tool errors (#1941). When a tool
  run is interrupted mid-stream (CTRL+C / SIGINT, exit code 130), the last captured
  stdout line could be a stray structural character such as a lone `}`, which leaked
  into the GitHub failure comment as "CLAUDE execution failed with }". A new shared
  `isMeaningfulErrorText` helper (any error with at least one Unicode letter or digit
  is real; pure punctuation is not) now guards the `extractToolErrorCore` chokepoint,
  and a new `buildToolErrorMessage` helper labels interruptions explicitly
  ("Claude command interrupted (CTRL+C)") across the Claude and OpenCode runners.
- d4efc82: fix(playwright-mcp): do not abort the solve when the Playwright MCP preflight probe is inconclusive (#1943)

  A `solve` run aborted before creating a pull request with
  `❌ Playwright MCP preflight failed for Claude Code`. The local preflight ran
  `timeout 5 claude mcp list`, but that command performs a live health check that
  launches a browser and can take longer than five seconds; when the `timeout`
  killed the probe, `ensureConnectedPlaywrightMcpServer` treated the non-zero exit
  as a failure and stopped the whole run.

  An inconclusive `mcp list` probe (timeout / crash / missing CLI) now falls back
  to the local `@playwright/mcp` package check instead of aborting: if the package
  is installed, the server connects on demand via Tool Search (issue #1901), so the
  working session proceeds. The probe timeout now defaults to 30s and is overridable
  via `PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS`, and the preflight emits verbose
  diagnostics (probe exit code, matched rows, decision branch) so failures are
  diagnosable from the log. The preflight still fails only when `@playwright/mcp`
  is genuinely unavailable.

## 2.0.5

### Patch Changes

- d815c7d: Treat a Claude Code `pending` Playwright MCP `system.init` status as a normal
  still-connecting state instead of a failure (#1901). Claude Code enables Tool
  Search by default, so the deferred `mcp__playwright__*` browser tools load on
  demand and Claude waits for the connecting server before using them. Hive Mind
  no longer aborts the working session on a `pending` status; only a terminal
  `failed`/`error` status surfaces a non-blocking diagnostic in the session-start
  comment. See `docs/case-studies/issue-1901`.

## 2.0.4

### Patch Changes

- f1f9b10: fix(telegram): detect OOM/SIGKILL-ed detached sessions and resume tracking after a bot restart (#1927)

  A `/solve` running in a detached `screen` session was OOM-killed (exit `137`),
  but the Telegram bot stayed alive and **never reported the failure** — the job
  silently hung forever. Two compounding gaps caused this:

  **Root cause (RC-1, upstream).** The external `start-command` CLI's
  `enrichDetachedStatus` re-derives a detached session's status from backend
  liveness (`screen -ls`). When a shell lingers after the wrapped command is
  already dead, `$ <id> --status` flips an already-completed record
  (`status: executed`, `exitCode: 137`) **back to `executing` and nulls the exit
  code**, even though `start` itself wrote an authoritative `Exit Code: 137` footer
  to the log. The bot's monitor only reacts to a _terminal_ status, so the kill is
  never surfaced. Confirmed against upstream source and filed with a runnable repro
  as [link-foundation/start#134](https://github.com/link-foundation/start/issues/134)
  (a regression of the fix for upstream #60/#101).

  **Root cause (RC-2/3/4).** The session monitor's registry was in-memory only, so
  a bot restart orphaned every detached `/solve`; there was no "last alive" marker
  to bound what to resume; and the bot log could be overwritten on restart,
  destroying the evidence needed to reconstruct the failure.

  **Fix (defensive, consumer side — correct regardless of when upstream lands):**
  - **`src/session-status.lib.mjs`** — a shared, dependency-free status vocabulary
    (`RUNNING`/`KILLED`/`FAILURE`, signal classification for 137/143/139/130) so
    every call site agrees on what an exit code means.
  - **`src/isolation-runner.lib.mjs`** — `parseSessionExitFooter` /
    `readSessionExitFromLog` read the **authoritative log footer**, plus
    `checkBackendSessionAlive` / `isSessionRunning` probe the real backend.
  - **`src/session-monitor.lib.mjs`** — when `--status` says `executing`, cross-check
    the footer (authoritative) and a backend-liveness probe gated by a 90s minimum
    session age, so a SIGKILL is reported instead of hanging, while a just-started
    session is never misread.
  - **`src/session-store.lib.mjs`** — durable session registry (atomic
    `sessions.json` snapshot + append-only, never-truncated `sessions-events.jsonl`)
    so a restart can **resume** tracking and finally report sessions killed while
    the bot was down — resuming only sessions started **before** the bot's start
    time.
  - **`src/bot-logger.lib.mjs`** — every log line is prefixed with an ISO-8601
    millisecond timestamp; structured `event()`/`heartbeat()` markers record "last
    alive"; logs **rotate, never overwrite** (prior log preserved as a timestamped
    backup) so no evidence is destroyed.
  - **`src/bot-lifecycle.lib.mjs`** — heartbeat / resume-on-launch / orderly
    shutdown extracted from `telegram-bot.mjs` as pure injectable factories; a
    timestamped `bot_shutdown` marker distinguishes a clean stop from a hard kill.
  - **`src/work-session-formatting.lib.mjs`** + `telegram-bot.mjs` — completion
    messages now call out a **killed** outcome (❌ killed / signal) distinctly from
    an ordinary failure.
  - **`src/telegram-terminal-watch-command.lib.mjs`** — the same fix applied to the
    live `/terminal_watch` loop (req #8, "fix in all places"): it decided
    "completed" purely from `--status`, so a session killed while `--status` still
    read `executing` would be **polled forever** with a misleading "running"
    snapshot — the #1927 silent-hang, in the watch path. It now cross-checks the
    authoritative log footer (`reconcileWatchCompletion`), stops on a recorded exit,
    corrects the displayed status to the real terminal one (e.g. `killed`), and a
    completed-but-failed session renders a ❌ failure title instead of a ✅.
  - **`src/cleanup.os.lib.mjs`** + `src/cleanup.lib.mjs` — review follow-up:
    deduplicated `$` session-data access (cleanup no longer re-derives sessions
    from `screen -ls`/`tmux ls` + per-session `$ --status`; a single
    `listSessionTasks()` reads the whole catalog from `$ --list`, the same source
    `/queue`, `/limits` and the monitor already funnel through), and the cleanup
    listing now annotates **every** hive-mind folder — active _and_ finished — with
    which PR/issue and which session it belongs (or belonged) to.
  - **`src/session-resume.lib.mjs`** — review follow-up: when a detached `/solve`
    is killed, the surviving parent (the bot, or `/hive`) now surfaces a
    ready-to-run `solve <url> … --resume <lastSessionId>` command in the
    killed-session notification. A single `/solve` run prints many `Session ID:`
    markers (auto-continue, watch restarts, manual resume chains); the module reads
    the **last** marker from the log tail (`selectLastSessionId` /
    `readLastSessionIdFromLog`), with a filesystem fallback
    (`findLatestSessionLogId`). The bot deliberately **surfaces** the command rather
    than auto-relaunching (a job that reliably OOMs would storm);
    `planKilledSessionResume` bounds any automatic resume (default `maxAttempts: 1`).
    The section is additive (existing `extraSections` path), emitted only for
    `killed` `/solve` sessions, and failure-isolated so it can never break the
    notification. `args` was added to the persisted session fields so the resume
    command reproduces the original invocation exactly.

  A `verbose` flag is threaded through the new status/footer/liveness/resume paths
  with explicit `[VERBOSE]` tracing so the next failure leaves a trail (req #6).

  Added `tests/test-issue-1927-*.mjs` (9 suites, 266 assertions: status vocabulary,
  log-footer parsing, completion labeling, killed-detection, session store, resume,
  bot logger, bot lifecycle, terminal-watch kill). Full deep-dive in
  `docs/case-studies/issue-1927`
  (timeline, 8 requirements, 5 root causes, per-requirement solutions, preserved
  source artifacts), plus a runnable upstream repro under `experiments/`.

## 2.0.3

### Patch Changes

- 40fbf3d: fix(isolation): mount git identity into docker-isolated containers and stop trusting premature terminal status (#1939)

  A `solve` task launched with `--isolation docker` inside a Docker-in-Docker host
  (`konard/hive-mind-dind:2.0.2`) failed at the system-check stage with
  `❌ Git identity not configured`, even though `gh` was fully authenticated
  (account `konard`). The captured terminal log shows the native start-command
  (`$`) invocation mounting only `~/.config/gh`, `~/.claude`, and `~/.claude.json`
  — **no git identity** — so `git config user.name`/`user.email` were unset inside
  the container and `solve` aborted before doing any work.

  Root cause: `getDockerIsolationAuthMounts` (`src/isolation-runner.lib.mjs`)
  mounted `gh` and the per-tool credentials but never the git identity. `gh`
  authentication is not a git identity. The fix mounts the host git identity
  (`~/.gitconfig` and the XDG `~/.config/git`, honoring `GIT_CONFIG_GLOBAL` /
  `XDG_CONFIG_HOME`) for **every** tool, alongside `gh`, so the fix applies to all
  isolation callers at once. A new self-healing preflight,
  `ensureHostGitIdentityForIsolation`, gives the mount something to mount: when the
  host has no git identity it derives one from the authenticated `gh` account
  (`gh-setup-git-identity` / `repairGitIdentity`) and, if that is impossible, emits
  one actionable warning naming the exact downstream failure.

  The same run also exposed a second problem: `$ --list` reported the detached
  session as `status executed` with `exitCode -1` (and no `containerId`) while the
  container was still running, masking the live container and its real exit code.
  `isUnknownDockerExitCode` plus a docker-only cross-check in `isSessionRunning`
  and `getIsolationSessionState` (`src/session-monitor.lib.mjs`) keep an ambiguous
  `terminal + -1` docker session "running" until `docker inspect` confirms the
  container has actually exited; real exit codes and non-docker backends are
  unaffected. A verbose post-launch diagnostic now records `$ --status`, container
  state, and local image presence so the next iteration can confirm the premature
  status and the image re-pull from data.

  The premature-terminal-status behaviour was reported upstream to
  link-foundation/start and fixed there in `start-command@0.29.1`
  (link-foundation/start#136); `Dockerfile` and `Dockerfile.dind` now pin
  `start-command@0.29.1` so the fixed `$` binary ships in the images, while the
  downstream cross-check stays as defense-in-depth for older hosts.

  Added `tests/test-issue-1939-docker-isolation.mjs` (25 assertions) and a full
  case study with timeline, root-cause analysis, and the captured logs under
  `docs/case-studies/issue-1939`.

## 2.0.2

### Patch Changes

- 19aea85: fix(retry): auto-resume on "Stream idle timeout - partial response received" (#1937)

  A long-running solve session (391 turns, ~$34.11) had its streaming response
  stall mid-answer. The Claude CLI surfaced it as a `result` event with
  `is_error: true`, `subtype: "success"`, and:

  ```
  API Error: Stream idle timeout - partial response received
  ```

  Instead of retrying with the session preserved, the harness fell straight
  through to the generic failure path and exited with code 1 after **zero
  retries** — abandoning the whole session even though it had a valid session ID
  and printed the exact `--resume` command needed to continue.

  Root cause: the shared retry classifier `classifyRetryableError()`
  (`src/tool-retry.lib.mjs`) had no branch for the stream-idle-timeout family, so
  `isRetryable` was false, `isTransientError` evaluated to false, and the unified
  exponential-backoff retry block was never entered.

  This error is a transient transport-level stall (a slow/stuck server-sent-events
  socket), not a request-content rejection — the on-disk session transcript stays
  valid, which is why a manual `--resume` works. The fix adds one branch to
  `classifyRetryableError()` returning
  `{ isRetryable: true, isCapacity: false, label: 'Stream idle timeout (partial response)' }`,
  so the existing retry block resumes the session with the same context after an
  exponential backoff. Because the classifier is shared, this fixes the behaviour
  for **all** tools (claude/codex/gemini/opencode/qwen/agent) at once.

  Added `tests/test-issue-1937-stream-idle-timeout-retry.mjs` (17 assertions) and a
  full case study with timeline, root-cause analysis, upstream references, and the
  captured logs under `docs/case-studies/issue-1937`.

## 2.0.1

### Patch Changes

- 70e1542: fix(retry): treat 5-hour "session limit" and "weekly limit" 429s as account usage limits, not transient throttles (#1935)

  A long-running solve session (588 turns, ~$70.62) hit Claude's **5-hour session
  limit**. The Claude CLI surfaced it as a `result` event with `is_error: true`,
  `api_error_status: 429`, and:

  ```
  You've hit your session limit · resets 4pm (UTC)
  ```

  Instead of being treated as an **account usage limit** (post a comment with the
  reset time + wait until the exact reset moment), it was put through the transient
  exponential-backoff retry loop:

  ```
  ⚠️ Server rate limited (429) detected. Retry 1/10 in 2 min (session preserved)...
     Error: You've hit your session limit · resets 4pm (UTC)
  ⚠️ Server rate limited (429) detected. Retry 2/10 in 4 min (session preserved)...
  ```

  Each retry re-hit the same limit because the quota only frees at the reset time —
  so the harness burned ~10 futile retries and never told the user when the limit
  resets.

  Root cause (regression from #1924): `src/claude.lib.mjs` set
  `isRateLimitError = true` for **every** structured `api_error_status === 429`,
  without checking whether the message was an account usage limit. Claude reports
  **both** a transient throttle ("...not your usage limit...") and account
  session/weekly limits with `api_error_status: 429`, so the unconditional check
  swept genuine usage limits into the transient-retry path — ahead of the
  `detectUsageLimit()` reset-time wait, which was therefore never reached.

  Fix: `src/claude.lib.mjs` now only flags a structured 429 as a transient rate
  limit when the message is **not** a usage limit
  (`api_error_status === 429 && !isUsageLimitError(lastMessage)`), so session/weekly
  limits fall through to the usage-limit handler that immediately posts a comment
  and waits until the exact reset time (auto-resuming there with
  `--auto-continue-limit`). `src/usage-limit.lib.mjs` additionally recognises the
  "hit your session limit" / "hit your weekly limit" phrasing as a backstop (the
  reset-time regex already matched "resets 4pm").

  Added `tests/test-issue-1935-session-limit-429.mjs` (15 assertions) and a full
  case study with timeline, blame history (PR #1924), root-cause analysis, and the
  captured logs under `docs/case-studies/issue-1935`.

## 2.0.0

### Major Changes

- fd84e85: Rename the cleanup executable to `hive-cleanup` and harden destructive confirmation parsing against hidden terminal control input.

## 1.78.13

### Patch Changes

- a8035e9: Fail fast when watched GitHub repositories, issues, pull requests, or branches are deleted, closed, or no longer accessible instead of retrying them as unknown CI states.

  Also fall back to a pinned working `use-m` bootstrap when the upstream latest unpkg entry is missing, so local and CI test startup remains stable.

## 1.78.12

### Patch Changes

- 5f60c04: fix(isolation): default nested Docker daemon to fuse-overlayfs so multi-GB images fit on disk + add storage-driver/disk preflight diagnostics (#1914)

  `--isolation docker` was reopened after PR #1915: native Docker isolation and
  host-image passthrough now work, but the first isolated task on the >30 GB
  `konard/hive-mind-dind` image still died with:

  ```
  failed to register layer: no space left on device
  ```

  even though most layers reported `Already exists` (the daemon was correctly
  seeded — passthrough is working). The failure was during layer **registration**,
  not download.

  **Root cause (in this repo).** `Dockerfile.dind` baked `ENV
DIND_STORAGE_DRIVER="vfs"` (commit 44d2c29e). `vfs` performs **no copy-on-write**:
  it materializes a full, independent copy of the entire filesystem for _every_
  layer, so a multi-GB image's on-disk footprint becomes the _sum_ of all
  cumulative layer sizes — many times the image size — and overflows the disk.
  Worse, pinning the env var **defeated box-dind's storage-driver auto-detection**
  (`overlay2 → fuse-overlayfs → vfs`, with graceful fallback): box would otherwise
  have picked a copy-on-write driver here. `/dev/fuse` is present (the dind
  container runs `--privileged`), the `fuse-overlayfs` binary ships in box-dind,
  and `overlay` is in `/proc/filesystems` — so copy-on-write was available the
  whole time but was being bypassed by the `vfs` pin.

  **Fix.** `Dockerfile.dind` now pins `ENV DIND_STORAGE_DRIVER="fuse-overlayfs"` — a
  copy-on-write driver that also works overlay-on-overlay (the compatibility reason
  `vfs` was originally chosen; `overlay2` can fail on the overlay-backed hosts our
  deploys run on). Under `fuse-overlayfs`, registering a 498 MB top layer on a
  ~30 GB base costs ~498 MB instead of ~30 GB, so the image fits. Empirically
  verified in the box-dind environment (`docs/case-studies/issue-1914/data/fuse-overlayfs-capability-proof.log`).

  **Self-diagnosing preflight.** `src/isolation-runner.lib.mjs` gained two probes —
  `checkDockerStorageDriver()` and `checkDockerDiskSpace()` — wired into
  `preflightDockerIsolation()`. Before running an isolated task it now warns, with
  an actionable remedy, when the nested daemon is on `vfs` (even if the image is
  already present) or when free space at the Docker data root is below 40 GiB, so
  the next operator hitting this gets a clear breadcrumb instead of a cryptic
  `no space left on device`. Both probes are best-effort and never throw.

  Added `tests/test-issue-1914-storage-driver-diagnostics.mjs` (34 assertions),
  extended `tests/test-issue-1914-preflight-passthrough.mjs` and
  `tests/test-docker-dind-variant.mjs`, refreshed `docs/DOCKER*.md`, and expanded
  the `docs/case-studies/issue-1914` case study with the reopen timeline, refined
  root-cause analysis, captured evidence, and an upstream observability request
  (link-foundation/box#104: warn when the nested daemon lands on `vfs`).

## 1.78.11

### Patch Changes

- 24fb17e: fix(retry): auto-resume on server-side 429 "Server is temporarily limiting requests" rate-limit errors (#1924)

  A long-running solve session (177 turns, ~72 min) was thrown away when the Claude
  CLI surfaced a **server-side temporary rate limit**:

  ```
  API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited
  ```

  The CLI reports this as a `result` event with `is_error: true` and
  `api_error_status: 429`, and the HTTP response carries `x-should-retry: true`.
  This is a transient throttle that clears on its own — distinct from an account
  usage/quota limit (the message literally says "not your usage limit", and there
  is no reset time to wait for).

  Root cause: the error matched neither `classifyRetryableError` (no pattern for
  the 429 throttle wording) nor `isUsageLimitError` (correctly, since it is not a
  quota limit), so it fell through to a hard failure with exit code 1 and **no
  auto-resume**, unlike every other transient class (overload 500/529, 503,
  internal server error, request timeout, socket drops).

  Fix: `classifyRetryableError` (in `src/tool-retry.lib.mjs`, the shared classifier
  used by every tool wrapper — claude, codex, gemini, opencode, qwen, agent) now
  recognises this throttle and marks it retryable (`isCapacity: false`, so no model
  switch), so it retries with the session preserved (`--resume`) after a backoff.
  `src/claude.lib.mjs` additionally detects the structured `api_error_status === 429`
  directly (robust to wording changes) and logs a verbose diagnostic with the
  `request_id`. The matcher is narrow so genuine account usage limits stay on the
  usage-limit reset-time path.

  Added `tests/test-issue-1924-rate-limit-retry.mjs` (18 assertions) and a full
  case study with timeline, root-cause analysis, upstream references
  (anthropics/claude-code#53915, #53922), and the captured logs under
  `docs/case-studies/issue-1924`.

## 1.78.10

### Patch Changes

- 02faadb: fix(auto-merge): stop `/merge` from hanging forever on fork PRs with external-only `success` checks (#1918)

  The `/merge` auto-merge watch loop could spin on the same commit indefinitely
  (observed 73 minutes, 72 identical iterations, before a human killed it). It
  happened on a **fork pull request** whose only repo workflows trigger on `push`
  (which never fires for fork commits in the base repo) while an external app
  (CodeRabbit) reported CI status `success` with **0 workflow runs** for the head
  SHA.

  Root cause: the watch loop reset its consecutive "no workflow runs" safety-valve
  counter (`consecutiveNoRunsChecks`) on every iteration whenever
  `ciStatus.status !== 'no_checks'`. Because external-only checks make the status
  `'success'`, the counter was pinned at `1` and never reached
  `MAX_NO_RUNS_CHECKS`, so the valve that should have ended the wait never fired —
  the loop logged `check 1/5` forever.

  Fix: `getMergeBlockers()` now returns a `noWorkflowRunsForCommit` flag that is
  true while it is still waiting for PR-triggered workflow runs to register, and a
  new pure helper `shouldResetNoRunsCounter(ciStatus, noWorkflowRunsForCommit)`
  only resets the counter when CI is **not** in that waiting state. The counter
  now climbs `1 → 2 → … → 5`, trips the safety valve in a few minutes, and `/merge`
  proceeds. The #1503 behaviors (reset on new push / on genuine CI runs) are
  preserved and regression-guarded.

  Added `tests/test-merge-stuck-no-workflow-runs-1918.mjs` and a full case study
  with timeline, root-cause analysis, and the captured logs under
  `docs/case-studies/issue-1918`.

- 9e00f14: fix(telegram): never re-execute a forwarded command (`/task`, `/stop`, `/tokens`, `/log`, `/terminal_watch`) (#1922)

  Forwarding a message that starts with a bot command (for example the bot's own
  `/task <url>` reply, or any `/task https://github.com/owner/repo`) caused the
  Telegram bot to execute the command again — creating a brand-new GitHub issue or
  spawning a session the user never intended. `/task` and `/split` only checked
  `isOldMessage` and never rejected forwarded messages, unlike `/help`, `/solve`,
  `/hive`, `/merge`, etc.

  Root cause: the existing `isForwardedOrReply` filter rejects _both_ forwards and
  replies, so commands that use the reply feature (`/task` issue creation, `/solve`
  URL extraction, targeted `/stop`) could not use it without breaking replies — and
  were therefore left without any forwarded check at all.

  Fix: a new dedicated `isForwarded(ctx)` filter detects _only_ forwarded messages
  (new `forward_origin` API + legacy `forward_*` fields) and intentionally ignores
  replies. It is now applied to every command that previously lacked a forwarded
  guard — `/task`, `/split`, `/stop` (including targeted `/stop <uuid>`), `/tokens`,
  `/log`, `/terminal_watch`/`/watch` — and `/solve` was refactored to reuse it
  instead of its ad-hoc inline check. Genuine user replies keep working.

  Added unit tests for `isForwarded` and for forwarded `/task`/`/split` rejection,
  plus a full case study with timeline and per-command audit under
  `docs/case-studies/issue-1922`.

## 1.78.9

### Patch Changes

- a3d4d41: fix(isolation): use native Docker isolation and seed the nested daemon for `--isolation docker` (#1914)

  Two problems made `--isolation docker` behave wrong on the Docker-in-Docker bot
  host:
  1. **It wasn't real Docker isolation.** Hive Mind launched isolated tasks as
     `$ --isolated screen -- docker run …`, so `$ --status` reported
     `options / isolated screen` — a screen wrapper around a raw `docker run`, not
     the native Docker backend. Hive Mind now builds
     `$ --isolated docker --image <img> [--privileged] --shell sh … --detached --session <uuid> -- '<cmd>'`,
     so start-command owns the container lifecycle and `--status` reports real
     Docker isolation.
  2. **The 30+ GB image was re-downloaded for every task.** The bot runs inside a
     DinD container whose nested `dockerd` starts with an empty image store. box
     can seed that daemon from the host (host-image passthrough), but only when the
     host Docker socket is bind-mounted — and when it isn't, passthrough is a
     _silent_ no-op, so the first isolated task pulled the whole image from the
     registry. Hive Mind now runs a startup preflight (`preflightDockerIsolation`)
     that probes the nested daemon and, when the image is absent, prints the exact
     remediation (mount `/var/run/docker.sock` + set `DIND_HOST_PASSTHROUGH_IMAGES`,
     or run `scripts/preload-dind-isolation-image.mjs`). The production deploy
     script was the real root cause — its `docker run` never mounted the host
     socket — and has been fixed to pass `-v /var/run/docker.sock:…:ro` plus the
     allowlist.

  Also filed the silent-passthrough footgun upstream as link-foundation/box#102
  (warn when an allowlist is set but no socket is mounted) — **now fixed and shipped
  in box v2.3.2** — and bumped this repo's base images from `konard/box:2.3.1` /
  `konard/box-dind:2.3.1` to `2.3.2` so the upstream warning ships at the source.
  Added a deep case study with the full reproduction, timeline, and root-cause
  analysis under `docs/case-studies/issue-1914`.

## 1.78.8

### Patch Changes

- cb4986f: Close linked issues when a PR is merged into a non-default branch, and stop misreporting the cause (#1895).

  GitHub only registers a PR's `closingIssuesReferences` and auto-closes the linked
  issue when the PR targets the repository's **default branch**. PRs created against a
  stacked / sub-issue branch (e.g. `issue-47-…` via `--base-branch`) therefore showed
  an empty closing-reference connection and left their issues open after merge — the
  exact failure reported for meta-language PRs #65/#66 / issues #49/#50.
  - src/github-issue-auto-close.lib.mjs (new): `gitHubAutoClosesOnMerge`,
    `classifyIssueLinkStatus`, `buildNonDefaultBranchExplanation`, and
    `ensureLinkedIssueClosedAfterMerge` — diagnose why a closing reference is missing
    and explicitly close the linked issue after a non-default-base merge (no-op when
    GitHub already handles it, the keyword is absent, or the issue is already closed).
  - src/solve.auto-pr.lib.mjs: replace the misleading "ISSUE LINK MISSING — add
    Fixes #N" warning with an accurate "ISSUE LINK DEFERRED" explanation when the
    keyword is present but the PR targets a non-default branch.
  - src/solve.auto-continue.lib.mjs (`collectIssuePrCandidates`): detect the existing
    PR for an issue by BOTH GitHub's `linked:issue` search (legacy, preserved) and the
    deterministic `head:issue-N-` branch search. A PR targeting a non-default base
    branch never appears in `linked:issue`, so `--auto-continue` previously failed to
    resume it and risked creating a duplicate; the head-branch search guarantees the
    PR↔issue association regardless of base branch.
  - src/solve.auto-merge.lib.mjs (watchUntilMergeable + attemptAutoMerge),
    src/github-merge.lib.mjs / src/github-merge-issue-close.lib.mjs
    (`closeLinkedIssueIfNotAutoClosed`, used by the /merge queue), and
    src/telegram-merge-queue.lib.mjs: close the linked issue explicitly after a merge
    into a non-default branch. All gh calls route through the rate-limit-aware wrappers.
  - tests/github-issue-auto-close.test.mjs: 14 cases reproducing the non-default-base
    bug and verifying the diagnosis + fallback.
  - tests/solve-auto-continue-detection-1895.test.mjs: 7 cases proving non-default-base
    PRs are detected for auto-continue (head-branch search), legacy linked detection is
    preserved, results are deduped/merged, and search failures degrade gracefully.
  - docs/case-studies/issue-1895: deep case study with downloaded GraphQL/PR/issue
    evidence, reconstructed timeline, root-cause analysis, requirement mapping, and the
    external-reporting decision. Includes `github-api-linking-research.md` — a
    definitive, introspection-backed answer to "is there an API to link a PR to an
    issue?" (no: confirmed via live GraphQL schema introspection), with the gap
    reported upstream (GitHub Community discussions #112224 / #155339 / #179613).

## 1.78.7

### Patch Changes

- c1617ae: Fix `/task` issue creation when replying to a message: combine the inline command (e.g. the repository URL) with the replied-to message (the issue text) instead of dropping the reply, so replying with `/task <repository-url>` now creates the GitHub issue (issue #1916).

## 1.78.6

### Patch Changes

- cf85feb: Fix Codex sub-session budget display by parsing compact diagnostics and preserving compact-derived sub-session rows.

## 1.78.5

### Patch Changes

- b3d6588: Remove Hive Mind's npm global prefix workaround now that use-m handles non-writable npm global roots upstream.

## 1.78.4

### Patch Changes

- 798c352: Fix Playwright MCP availability detection so pending or unavailable server status no longer enables browser automation hints, surface pending status in interactive session comments, and harden Docker verification so Playwright MCP/CLI availability is checked instead of only grepping for a registration.

## 1.78.3

### Patch Changes

- b346808: Use the latest gh-upload-log package for attached log uploads and rely on its default auto mode/shared repository fallback instead of passing explicit strategy flags.

## 1.78.2

### Patch Changes

- 70db26f: Ensure Telegram work-session completion messages recover pull request links from completed solve logs when linked-issue lookup does not return a PR.

## 1.78.1

### Patch Changes

- dc8bb99: Group interactive `system.thinking_tokens` events into one editable PR comment and handle observed system lifecycle events without unrecognized-event noise.
- d704dfc: fix(install): redirect npm global prefix when root-owned to avoid EACCES at startup (#1897)

  `use-m` loads runtime dependencies (command-stream, getenv, yargs, …) by shelling
  out to `npm install -g <alias>@npm:<pkg>@latest`, which installs into the global
  prefix reported by `npm root -g`. When the CLI was launched under a system-wide
  Node.js whose global `node_modules` is owned by root (e.g.
  `/opt/node-v24.16.0-linux-x64/lib/node_modules`), that install failed with
  `npm error code EACCES … rename … command-stream-v-latest` and the whole process
  crashed at the very first `use()` call (`Error: Failed to install
command-stream@latest globally.`). This commonly happens when hive-mind was
  installed with `bun add -g` (user-owned `~/.bun/...`) but invoked under a system
  Node whose global prefix needs root.

  The new `src/npm-global-prefix.lib.mjs` preflight mirrors npm's own documented
  EACCES remedy: before any real `use-m` bootstrap runs, it detects a non-writable
  npm global prefix and redirects `npm_config_prefix` (honoured by both
  `npm install -g` and `npm root -g`) to a user-writable `~/.npm-global`,
  prepending its `bin` to `PATH`. The common case where the prefix is already
  writable stays a no-op with no extra `npm` spawn.

  Hive Mind now routes direct repository `use-m` bootstraps through
  `src/use-m-bootstrap.lib.mjs`, including CLI entry points, shared source modules,
  scripts, and executable tests. The workaround skips Windows' different global
  layout, skips Bun/Deno runtimes, and respects explicitly preset
  `npm_config_prefix` or `NPM_CONFIG_PREFIX` values.

## 1.78.0

### Minor Changes

- 9506f03: fix(telegram): de-duplicate `/queue` display and split long messages without breaking markdown (#1891)

  The `/queue` (alias `/solve_queue`) detailed display repeated the same words on every
  line — every executing row said `(processing, …)`, every waiting row said
  `(waiting, …)`, and the (almost always identical) per-item waiting reason was printed
  once per item. Empty queues were also still printed. This wasted vertical space and
  pushed real data off screen.

  Display changes (`formatDetailedStatus` + queue helpers):
  - Executing rows now render compactly as `• owner/repo#number (▶️ <dur>)` and pending
    rows as `• owner/repo#number (⏳ <dur>)` — the status word is replaced by the emoji
    marker inside the duration parenthesis.
  - Processing, pending, completed, and failed entries are split into distinct
    compact lists per tool, with counts only on those list labels instead of a
    duplicated `(pending: n, processing: n)` tool-header summary.
  - The shared waiting reason is shown **once per tool** (only when all pending items
    agree on it) instead of once per item.
  - Empty queues are skipped entirely.
  - All queued items are listed (no per-queue truncation on the active lists).

  Message-splitting changes (`splitTelegramMessageText` in `telegram-safe-reply.lib.mjs`,
  the single universal splitter every Telegram send path funnels through):
  - Splitting now happens only on line boundaries, so inline Markdown entities
    (bold/italic/links) are never cut in half.
  - Fenced code blocks stay balanced per chunk: a split inside a code block closes the
    fence at the end of one chunk and reopens it — repeating the language — at the start
    of the next. The original fence marker (```vs`~~~`) and indentation are preserved.
  - Pathologically long single lines are hard-split as a fallback.

  Both behaviours are covered by extensive new tests
  (`tests/test-telegram-message-split-1891.mjs`, `tests/test-queue-compact-display-1891.mjs`).

## 1.77.1

### Patch Changes

- 3f9dd61: fix(ci): retry `npm install`/`npm ci` on transient registry network errors (#1903)

  CI run 27332260596 failed in the `test-execution` job when `npm install` aborted
  mid-download with `npm error code ECONNRESET` / `npm error network aborted` — a
  transient GitHub-runner ↔ npm-registry network drop, not a code defect. The bare
  install step had no retry, so a single dropped socket failed the whole job (a
  false positive).
  - Add `scripts/npm-install-with-retry.mjs`: a Node-builtin-only wrapper that runs
    `npm install`/`npm ci` and retries the whole command with exponential backoff on
    transient failures only, reusing the `isRetryableNpmError`/`computeBackoffMs`
    helpers introduced for issue #1724 (no code duplication). Verbose mode via
    `NPM_INSTALL_RETRY_VERBOSE=1`; tunable via `NPM_INSTALL_MAX_ATTEMPTS` /
    `NPM_INSTALL_BASE_DELAY_MS`.
  - Route all 8 dependency-install steps in `.github/workflows/release.yml` through
    the wrapper (fixing the bug in every place it existed).
  - Add `.npmrc` raising npm's built-in `fetch-retries` budget, hardening local,
    CI, and Docker installs as defense in depth.
  - Unit test `tests/test-npm-install-with-retry-1903.mjs` (mocked npm runner) and a
    deep case study under `docs/case-studies/issue-1903/`.

## 1.77.0

### Minor Changes

- a50d201: feat(solve): experimental `--escalate` mode (#1885)

  Add an experimental `solve` option family that solves a task cheaply first and
  escalates to a more capable (more expensive) model only while unfinished work
  remains. The model ladder, cheapest → most capable, is `haiku < sonnet < opus <
fable`.
  - `--escalate` (bare) → the default range `sonnet-fable`.
  - `--escalate sonnet-opus` → an explicit `<lower>-<upper>` range (`-` delimits the
    bounds; only the short ladder names are allowed inside a range).
  - `--escalate-from haiku` → shortcut for `--escalate haiku-fable` (aliases such as
    `opus-4-8` accepted here, since a single value is unambiguous).
  - `--escalate-steps N` (default 1) → keep each tier for N working sessions before
    escalating (e.g. `2` → two sonnet sessions, then two opus, then two fable).

  The first regular solve session runs on the range's lower bound (unless `--model`
  is explicitly pinned). After it finishes, the escalate loop re-scans the pull
  request for deferred/unfinished-work indicators — reusing the detector from issue
  #1883 — and escalates to the next tier only if work remains; otherwise it stops
  early so the expensive tiers are never invoked. Restarts are capped at 3
  consecutive errors and stop on a usage limit. Escalate is Claude-only and runs
  before `--finalize` / `--keep-working`.

  Pure parsing/planning helpers live in a network-free module
  (`src/solve.escalate.lib.mjs`) with full unit-test coverage
  (`tests/test-escalate-1885.mjs`); a deep case study is compiled under
  `docs/case-studies/issue-1885/`.

- 53a0544: Update Hive Mind Docker images to `konard/box` and `konard/box-dind` 2.3.1 so Docker-in-Docker deployments can use the upstream host-image passthrough allowlist.

## 1.76.2

### Patch Changes

- 5d8d6c1: fix(cost): accumulate Anthropic cost across limit-reset resumes (#1886)

  The session cost summary could report a large negative "Difference" (e.g.
  `$-11.422796 (-31.66%)`) between the public pricing estimate and the Anthropic
  figure. Root cause: the public estimate is computed from the session JSONL,
  which accumulates the **entire** session across every limit-reset resume, while
  the Anthropic `total_cost_usd` from the stream-json `result` event is scoped to a
  **single** Claude process (only the resumed run). Comparing a full-session
  estimate against a single-process figure produced a misleading gap even though
  both numbers were individually correct.

  The per-token math (`calculateModelCost`) was audited and is correct; this is a
  scope mismatch, not a pricing error.

  Fix:
  - New `src/anthropic-cost-accumulator.lib.mjs` keeps a model-agnostic running
    total of Anthropic's per-process `total_cost_usd` (it sums dollars, never
    inspecting per-token prices, so it is correct for all models).
  - `runClaude` seeds from and returns the cumulative total on every terminal path;
    the cross-process limit-reset resume threads it via a new hidden
    `--previous-anthropic-cost` option (`autoContinueWhenLimitResets`).
  - A usage-limit hit ends as `is_error` with no `success` result event, so its
    cost was previously discarded. The cost from a non-success terminal `result`
    event is now kept as a fallback and folded into the accumulator, closing the
    gap in the reported scenario.
  - `displayCostComparison` / `displaySessionTokenUsage` print a verbose
    accumulation breakdown ("cumulative across resume iterations: this run … +
    carried forward … = …") so the figure is never mysterious again.

  A deep case study (timeline, proven root causes, exact reproduced numbers, online
  prior art incl. `anthropics/claude-code#13088`) is compiled under
  `docs/case-studies/issue-1886/`.

## 1.76.1

### Patch Changes

- 13e7e6a: Docker isolation: reuse the host image instead of re-downloading a copy inside the (nested) Docker daemon (#1879).
  - src/isolation-runner.lib.mjs: add `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` to pin the
    isolation image tag, and `HIVE_MIND_DOCKER_ISOLATION_PULL` (always|missing|never) to emit a
    `docker run --pull` policy. Verbose mode now logs the resolved image and pull policy.
  - scripts/preload-dind-isolation-image.mjs: seed a DinD container's nested daemon from the
    host (`docker save | docker exec -i … docker load`) so isolated tasks reuse the host image.
  - .env.example: document the Docker isolation image/pull controls.
  - Dockerfile / Dockerfile.dind / coolify/Dockerfile: bump the box base images to
    `konard/box:2.2.0` / `konard/box-dind:2.2.0` (and the `docs/UBUNTU-SERVER*.md` examples).
    v2.2.0 ships box's native host-image passthrough (box#94/#95), so the DinD deployment can seed
    the nested daemon from the host automatically with
    `-v /var/run/docker.sock:/var/run/host-docker.sock:ro -e DIND_HOST_PASSTHROUGH=public`.
  - tests/test-issue-1879-docker-image-reuse.mjs: regression coverage.
  - docs/case-studies/issue-1879: deep case study with logs, timeline, root causes, and runbook;
    records that box#94 shipped in v2.2.0 and reports two upstream follow-ups — box#96
    (public-mode passthrough test false positive) and box#97 (per-repository passthrough allowlist).

- 7335a73: Continue fork PRs with "Allow edits by maintainers" instead of halting on a misclassified fork divergence (#1893).

  When the solver continues a cross-repository PR opened from another contributor's fork, it
  synced the upstream default branch and then tried to push it back to `origin` — the
  contributor's fork, which the operating maintainer does not own. GitHub rejected the push
  with `! [remote rejected] main -> main (permission denied)`, and the solver misclassified
  that permission error as a fork divergence (the heuristic matched the substring `rejected`),
  halting with `Repository setup halted - fork divergence requires user decision` and advising
  `--allow-fork-divergence-resolution-using-force-push-with-lease` — a flag that cannot help,
  since force-push also requires fork write access.
  - src/solve.branch-divergence.lib.mjs: add two pure helpers —
    `shouldPushDefaultBranchToFork({currentUser, forkedRepo})` (skip the push when the user does
    not own the fork; fail-open when owner/user is unknown) and `isPermissionDeniedPushError()`
    (recognize a permission-denied rejection so it is never treated as divergence).
  - src/solve.fork-sync.lib.mjs: new module holding `setupUpstreamAndSync` (extracted from
    solve.repository.lib.mjs to stay under the 1500-line limit, re-exported unchanged). It now
    resolves the current user, skips the fork's default-branch push when the user is not the fork
    owner, and on a permission-denied push warns and continues on the PR branch instead of
    halting. Genuine non-fast-forward divergence still triggers the original guidance. Adds
    verbose diagnostics explaining each skip/continue decision.
  - tests/test-issue-1893-fork-pr-permission-denied.mjs: regression coverage (9 cases) using the
    exact failure output from the run log.
  - docs/case-studies/issue-1893: deep case study with downloaded logs/data, timeline, root
    causes, fix, codebase-wide audit, and existing-components review.

## 1.76.0

### Minor Changes

- 80c56fa: Add experimental `--use-handoff` HANDOFF.md continuity **Agent Skill** (issue
  #1877). When enabled, Hive Mind deploys a real `SKILL.md` (the Agent Skills open
  standard created by Anthropic) into the session working directory for both tools
  natively — `.claude/skills/handoff/SKILL.md` for `--tool claude` and
  `.agents/skills/handoff/SKILL.md` for `--tool codex` — so the very same skill
  teaches each tool to read `HANDOFF.md` (repository root) first when present and
  keep it updated with task, current state, decisions, next steps, gotchas, and
  critical files. A minimal activation nudge in the system prompt ensures the
  read-at-session-start behavior fires reliably. Because each Hive Mind working
  session runs in an ephemeral working directory cloned from the PR branch, the
  handoff file is committed to the branch — making it the shared cross-session,
  cross-tool memory so Claude and Codex can continue each other's work in a single
  pull request. The deployed `SKILL.md` is tooling (re-deployed every session) and
  is kept out of the target repository via `.git/info/exclude`, so it never appears
  in the PR. Disabled by default; auto-forwarded by `hive`. Includes a case study
  in `docs/case-studies/issue-1877/` and tests in `tests/handoff-prompt.test.mjs`.

## 1.75.0

### Minor Changes

- d2adf6b: feat(solve): experimental `--keep-working-until-all-requirements-are-fully-done` (#1883)

  Add an experimental `solve` option that, after the main run (and any `--finalize`
  pass), scans three cheap sources — the pull request description, the AI solution
  summary, and the added lines of changed markdown documents — for strong
  indicators of deferred work ("out of scope", "future work", "follow-up PR",
  "deferred", "delayed", "TODO"/"TBD", etc.) using ~14 regular expressions. When
  indicators are found it auto-restarts the AI tool with the concrete detected
  reasons plus a verbatim reinforcement prompt, and repeats until the scan is clean
  or the restart limit is reached.

  Limit semantics:
  - `--keep-working-until-all-requirements-are-fully-done` (bare) → 5 restarts
  - `... 3` → an explicit count
  - `... forever` / `unlimited` / `infinite` / `0` → no limit (with a hard cap of 3
    consecutive errors as a safety net)

  Aliases: `--keep-going-until-all-requirements-are-fully-done`, `--keep-working`,
  `--keep-going`.

  Detection lives in a pure, network-free module
  (`src/solve.keep-working.detect.lib.mjs`) for full unit-test coverage;
  orchestration lives in `src/solve.keep-working.lib.mjs`. A deep case study is
  compiled under `docs/case-studies/issue-1883/`.

## 1.74.12

### Patch Changes

- e921b34: fix(retry): treat "socket connection was closed unexpectedly" as a transient, retryable error (#1881)

  The Claude/Codex CLI surfaces transient network disconnects (the Anthropic SDK's
  underlying `fetch()` socket dropping mid-stream) as a synthetic error:
  `API Error: The socket connection was closed unexpectedly.` Previously
  `classifyRetryableError()` did not recognise this family of errors, so a single
  dropped socket aborted the entire solve session (exit code 1, zero retries) and
  discarded all in-progress work. These socket/connection drops
  (`socket connection was closed unexpectedly`, `socket hang up`, `ECONNRESET`,
  `connection reset`, `Connection error`, `fetch failed`, `network connection lost`)
  are now classified as retryable, so the session is retried with `--resume`
  (context preserved) via the existing exponential-backoff path. Because
  `classifyRetryableError` is the shared classifier, the fix covers the Claude,
  Codex and Agent execution loops at once.

## 1.74.11

### Patch Changes

- faa10c5: Add support for Claude Fable 5 (`claude-fable-5`) and its un-classified sibling Claude Mythos 5 (`claude-mythos-5`) as selectable models for `--tool claude` (Issue #1875). New aliases `fable`, `fable-5`, `claude-fable-5`, `mythos-5`, and `claude-mythos-5` resolve in the centralized model registry, support the `[1m]` 1M-context suffix, the full effort ladder including `xhigh` and `max` (default `high`), and 128K max output tokens. Both models are adaptive-thinking-only, so `getClaudeEnv` removes `MAX_THINKING_TOKENS` for them (the API rejects disabled thinking), mirroring Opus 4.7/4.8. Documented default fallbacks are registered (`claude-fable-5 -> opus` reflecting Fable 5's safety-classifier hand-off to Opus 4.8; `claude-mythos-5 -> fable`). Existing defaults (`opus`, `sonnet`, `haiku`, `opusplan`) are unchanged — this adds Fable 5 as an option without altering current behavior. `fable` is surfaced in `--model` help. Includes `tests/test-fable-5-model-support.mjs` (127 tests) and a full case study under `docs/case-studies/issue-1875/`.

## 1.74.10

### Patch Changes

- 88adc75: Fix the auto-resume wait calculation for weekly `--tool codex` usage limits (Issue #1869, phase 2). After the display parser was fixed to keep the full reset date, the separate auto-resume parser in `solve.validation.lib.mjs` still crashed with `Invalid time format: Jun 11, 2026, 12:27 AM` and, even when it parsed, discarded the date and scheduled for today/tomorrow — so auto-resume woke up far too early. `calculateWaitTime` now delegates to the robust date-aware `parseResetTime` from `usage-limit.lib.mjs` (honoring explicit year, weekly date, and timezone) and returns the real time-until-reset, and all three call sites now forward the timezone. This consolidates onto a single reset-time parser.

## 1.74.9

### Patch Changes

- c4070e1: Fix incorrect usage-limit reset time for `--tool codex`. Codex reports weekly limits as a full calendar date (e.g. "try again at Jun 11th, 2026 12:27 AM"), but the reset-time parser dropped the month/day/year and kept only the time, making a multi-day weekly reset look like a same-day 5-hour reset. This both mis-informed users and made auto-resume fire far too early. `extractResetTime` now parses ordinal days and explicit years (keyword-independent), `parseResetTime` honors an explicit year, and Codex now traces the raw limit message and parsed reset under verbose mode.
  </content>

## 1.74.8

### Patch Changes

- c132ce0: Fix `/stop <issue-or-pr-url>` so it can stop tasks that started immediately
  (empty queue) or were already dispatched to a detached isolation session. The
  URL lookup now also consults the session-monitor registry and forwards CTRL+C
  to the tracked start-command UUID, so all three stop modes (issue URL, PR URL,
  and session UUID) work end-to-end (#1871).

## 1.74.7

### Patch Changes

- 8ea7110: Document the issue #1858 case study and add an experimental private Telegram
  `/auth` command for allowlisted chat owners to check or start GitHub, Claude,
  and Codex auth flows.

## 1.74.6

### Patch Changes

- e07b243: Split oversized Telegram text messages in the safe reply/edit helper so localized `/help` output cannot exceed Telegram's 4096-character limit.

## 1.74.5

### Patch Changes

- c20c2ec: Stop auto-restart-until-mergeable from restarting on CodeRabbit review quota/credit failures, and report them as Ready for review with skipped checks instead.

## 1.74.4

### Patch Changes

- 9b88700: Fix Telegram Docker isolation to use Hive Mind images with scoped GitHub, Claude, and Codex auth mounts.

## 1.74.3

### Patch Changes

- 741752e: Bump the Docker-in-Docker base image to `konard/box-dind:2.1.4` so `docker exec` sessions default to the `box` user with `/home/box` while dockerd still starts correctly.

## 1.74.2

### Patch Changes

- d726744: Add cleanup process diagnostics for mapping agent PIDs to task sessions and stopping orphaned terminal-session agents.

## 1.74.1

### Patch Changes

- 59eee9a: feat(interactive-mode): display images the AI reads/writes inline in PR comments (#1843)

  When `--interactive-mode` posts Claude/Codex tool activity as PR comments, any
  images the AI reads or produces (the `Read` tool on a screenshot, Playwright
  captures, MCP image results) were previously serialized as multi-kilobyte
  base64 blobs inside the "Raw JSON" section — unreadable and pushing comments
  toward GitHub's size limit.

  Those base64 payloads are now uploaded to hidden custom Git refs
  (`refs/hive-mind-media/pr-...`) via the Git Data API and embedded inline in the
  comment as commit-SHA `![](…?raw=true)` blob URLs, so reviewers see the actual
  image (GitHub's Camo proxy renders `?raw=true` blob URLs inline for both public
  and private repos, whereas `data:` URIs are stripped by the comment sanitizer).
  Uploads are content-hashed (SHA-256) for dedup, and the base64 is redacted from
  the Raw JSON section with a `<image data: N base64 chars>` placeholder.

  Enabled by default; use `--no-interactive-image-upload` to opt out, in which
  case each image degrades to a compact metadata note instead of being embedded.
  All comment bodies continue to pass through the token sanitizer (#1745).

## 1.74.0

### Minor Changes

- b00a51c: feat(cleanup): add a task-aware `cleanup` command to free disk space safely (#1848)

  Adds a new `cleanup` bin that removes stale hive-mind temporary
  directories/files under the system temp dir while preserving folders that belong
  to currently-running tasks, protected system paths, and any clone with
  uncommitted or unpushed work.

  Highlights:
  - `--dry-run` / `-n` prints the full list of kept folders and folders that would
    be deleted (with sizes and reasons), deleting nothing.
  - `--keep-active-tasks-folders` (default on) detects active tasks from running
    processes (`/proc`) and live isolation sessions (`screen`/`tmux` +
    `$ --status`), and matches clones to tasks by branch name using the same logic
    as `solve` (issue → `issue-{n}-{hex}` scoped to the repo; PR → its resolved
    head branch). Disable with `--no-keep-active-tasks-folders`.
  - Keeps `/tmp/start-command/` and system-owned temp entries by default;
    `--force-start-command` allows deleting `/tmp/start-command` when needed.
  - Optional Ubuntu/system cleanup behind explicit flags: `--apt`, `--journal`,
    `--docker`, `--npm` (and `--system` shorthand), with `--sudo`.
  - Safe by default: keeps unrecognised entries unless `--all`, never deletes
    paths held open by a running process or used by the cleanup process itself,
    and requires confirmation unless `--force`.

## 1.73.9

### Patch Changes

- 0a5b615: fix(telegram): list currently-executing tasks in `/solve_queue` (`/queue`), not just count them (#1837)

  After the original #1837 work added clickable lists, the detailed status still
  showed only a `processing: N` **count** for in-flight work — the executing task
  itself was never rendered as a clickable link, which is exactly the case the
  issue cares most about ("search tasks that are stuck or yet executing").

  Root cause: the processing **count** comes from the external snapshot
  (`max(pgrep, tracked-isolation-session count)`), but the processing **list**
  iterated the queue's own in-memory `processing` Map. `executeItem()` deletes an
  item from that Map the moment the work is dispatched to a detached
  screen/isolation session, so while a task is actually executing the Map is empty
  — count says `1`, list shows nothing.

  The fix sources the executing items from the same place the count comes from. A
  new `getRunningSessionItems()` in `session-monitor.lib.mjs` returns the
  currently-running detached sessions (with their GitHub `url`, `tool`, `status`,
  `startTime`), reusing the existing isolation `$ --status` / non-isolation
  screen-liveness checks. New helpers `collectExecutingItems` and
  `formatQueueProcessingItems` merge those sessions with the in-memory Map (deduped
  by normalized GitHub URL, filtered by tool) and render them as the `▶️
[owner/repo#n](url) (status, duration)` lines, capped with `... and N more`.
  `formatDetailedStatus()` now lists executing tasks from this merged source.

  Adds `tests/test-issue-1837-executing-list.mjs` plus new `solve-queue.test.mjs`
  cases, and documents the root cause and fix in `docs/case-studies/issue-1837`.

## 1.73.8

### Patch Changes

- 324ed89: fix(solve): surface the core tool error instead of bare `CLAUDE execution failed` (#1845)

  When an AI tool run failed, both the terminal and the posted GitHub
  `🚨 Solution Draft Failed` comment showed only the generic
  `CLAUDE execution failed`, even though the underlying tool had reported a
  specific cause (for example `API Error: Output blocked by content filtering
policy`). The real message was captured inside the tool runner but dropped at
  the failure-return boundary, so no downstream consumer could display it.

  Every AI tool runner now surfaces a structured `errorInfo` (with a `.message`)
  on its failure returns (`claude`, `gemini`, `opencode`, `qwen`; `codex` and
  `agent` already did). Two shared helpers in `lib.mjs` — `extractToolErrorCore`
  (the core error string) and `formatToolExecutionFailure` (the full
  `CLAUDE execution failed with API Error: Output blocked by content filtering
policy` message) — share one precedence so every surface stays consistent.
  All failure sites now use them: `solve.mjs` (terminal exit, GitHub failure
  comment, critical-error auto-commit reason), `solve.auto-merge.lib.mjs` and
  `solve.watch.lib.mjs` (GitHub message + new terminal `Error details:` lines),
  and `review.mjs`. The helpers collapse whitespace, cap the core error length,
  and never fall back to the agent's success summary.

  `isApiError` in `solve.restart-shared.lib.mjs` now classifies through the same
  extractor, so a Claude `API Error:` reported via `errorInfo` (never `result`)
  is detected and watch mode's `MAX_API_ERROR_RETRIES` backoff guard keeps
  working instead of retrying forever.

  The auto-commit-on-critical-error path (#1834) is confirmed to run on the
  failure exit and is now labeled with the real failure cause; the same guarded
  auto-commit is also added to `handleFailure()` so the `uncaughtException`,
  `unhandledRejection`, and top-level-catch exits preserve uncommitted work too.
  Adds unit, cross-tool, auto-commit, and `isApiError` tests plus a deep case
  study in `docs/case-studies/issue-1845`.

## 1.73.7

### Patch Changes

- 6188172: feat(telegram): list executed issues/PRs as clickable links in /solve_queue, add /queue alias (#1837)

  The `/solve_queue` detailed status previously showed only per-tool counts and a
  final `Completed: N, Failed: M` line, so a stuck or running task could not be
  opened from the message. It now lists each processing (`▶️`), pending (`•`),
  recently completed (`✅`), and failed (`❌`, with the error reason) item as a
  clickable `[owner/repo#number](url)` link, capped per section
  (`HIVE_MIND_MAX_DISPLAY_ITEMS_PER_QUEUE`, default 5) with a localized
  `... and N more` line to stay under Telegram's 4096-character limit.

  Also adds `/queue` as a shorter alias for `/solve_queue` (both the entity-based
  command regex and the text-based fallback handler), and documents the work in
  `docs/case-studies/issue-1837`.

## 1.73.6

### Patch Changes

- defa8c4: fix(claude): repair corrupted thinking-block transcripts so resume preserves context (#1834)

  Follow-up to the Issue #1834 recovery ("can we do even better?"). The previous
  recovery (PR #1835) was reactive: a plain resume of a transcript poisoned by a
  corrupted extended-thinking block (`{ "type": "thinking", "thinking": "" }` with a
  kept signature) just repeats the `400 ... thinking blocks ... cannot be modified`
  error, so recovery almost always fell through to a **fresh restart that discards
  dozens of turns** of accumulated context (50 turns / $3.84 in the second
  reproduction log).

  Recovery Phase 1 now **proactively repairs the on-disk session transcript** before
  resuming: `repairCorruptedThinkingBlocks` (new
  `src/claude.session-transcript-repair.lib.mjs`) strips the empty-text
  `thinking`/`redacted_thinking` blocks from the session JSONL — a workaround proven
  upstream (the Anthropic API permits _omitting_ earlier thinking, just not
  _modifying_ it). When repair succeeds the resume keeps all accumulated context;
  when it can't help, recovery still falls back to a fresh restart, so there is no
  regression.

  The repair is conservative: it never throws, only removes empty-text blocks (valid
  signed thinking is untouched), never empties an assistant message, and writes a
  one-time `<session>.jsonl.pre-repair-backup` before rewriting. The case study under
  `docs/case-studies/issue-1834` is updated with a second reproduction log and the
  new repair-then-resume design.

## 1.73.5

### Patch Changes

- 7cb9b7e: fix(claude): recover from corrupted extended-thinking blocks instead of looping (#1834)

  A long Claude (Opus) agentic run with extended thinking + tool use can leave a
  thinking block in the session transcript corrupted (text emptied while the
  original signature is kept). The Anthropic API then rejects every following turn
  with `400 ... `thinking`or`redacted_thinking` blocks in the latest assistant
message cannot be modified`, permanently poisoning the on-disk session — so any
  `--resume` retry fails forever. This is an upstream Claude Code bug
  (anthropics/claude-code#63147).

  Hive Mind now detects this terminal error (`classifyRetryableError` →
  `requiresFreshSession`) and recovers with a two-phase escalation: it **tries to
  resume the existing session first** (capped by
  `HIVE_MIND_MAX_THINKING_BLOCK_RESUMES`, default 1) and only when resume is not
  possible does it **discard the un-resumable session and restart fresh** (capped
  by `HIVE_MIND_MAX_THINKING_BLOCK_RESTARTS`, default 2) — rather than retrying the
  dead session or failing outright.

  Additionally, on **all** critical errors Hive Mind now auto-commits (and
  best-effort pushes) any uncommitted changes by default before recovery resets
  the session, so partial work is preserved in the PR branch history. This is
  on by default and can be toggled with `HIVE_MIND_AUTO_COMMIT_ON_CRITICAL_ERROR`.

  Verbose logging records the `request_id` and `messages.N.content.N` path for
  diagnostics. A deep case study with the full reproduction log is added under
  `docs/case-studies/issue-1834`.

## 1.73.4

### Patch Changes

- bfdc3fe: Add support for Claude Opus 4.8 (issue #1832). The bare `opus` alias for the `claude` tool now resolves to `claude-opus-4-8`, and the explicit `opus-4-8` / `claude-opus-4-8` aliases (plus their `[1m]` variants for the 1M-token context window) are accepted everywhere existing Opus aliases are. All earlier aliases keep working unchanged — `opus-4-7` / `claude-opus-4-7`, `opus-4-6` / `claude-opus-4-6`, `opus-4-5`, `sonnet`, `haiku`, and `opusplan` continue to map to the same model IDs as before. The `--fallback-model` default chain for the `claude` tool extends to `opus`/`opus-4-8` → `opus-4-7` → `opus-4-6`; the `--think xhigh`/`max` levels remain supported (4.8 shares Opus 4.7's effort surface and adaptive-only thinking, so Claude Code never emits `MAX_THINKING_TOKENS` for it); `--show-thinking-content` still opts into thinking output on 4.8 the same way it does on 4.7. Adds the deep case study under `docs/case-studies/issue-1832/` (covering the requirements, solution plan, and verification matrix) and `tests/test-opus-48-model-support.mjs` (175 assertions) alongside the existing 4.7 regression test. The English `docs/CONFIGURATION.md` row text is left unchanged in this PR to keep all four language siblings in sync; the case study is the authoritative user-facing documentation for the 4.8 behavior.

## 1.73.3

### Patch Changes

- a3eab04: Fix `solve` aborting with `GitHub compare API not ready - cannot create PR safely` when the compare/diff endpoint returns a transient HTTP 500 (`this diff is temporarily unavailable due to heavy server load`, code `not_available`). The auto-PR readiness gate polled `/repos/{owner}/{repo}/compare/{base}...{head}` to confirm the pushed commits were visible, but GitHub renders that diff lazily and returns 500 under load even though the branch and commits were already pushed and `gh pr create` (which does not render the full diff) would have succeeded. A new `isTransientCompareApiError` detector recognises the "heavy server load" / `not_available` 500 and the standard 5xx gateway codes (but NOT 404 fork mismatch or a literal `0`), and the gate now degrades gracefully — marking the compare ready and proceeding to PR creation, still guarded by branch verification and the local `git rev-list` commit check. The fork-404 mismatch and genuine 0-commits paths remain fatal.

## 1.73.2

### Patch Changes

- 0af65ad: Handle the auto-PR placeholder being listed in the target repository's `.gitignore` without aborting the whole run (issue #1825). Previously `git add .gitkeep` exited non-zero and the solver threw `Failed to add .gitkeep` → `FATAL ERROR: PR creation failed`. Now, when the placeholder (`.gitkeep` or `CLAUDE.md`) is gitignored, the solver by default prints a clear, environment-agnostic root-cause explanation and stops cleanly instead of forcing the commit. Two opt-in flags are added (usable with both `solve` and `/solve`): `--remove-git-keep-from-git-ignore` removes the literal placeholder entry from `.gitignore` first and then commits normally, and `--force-git-keep-commit` commits the placeholder anyway with `git add -f`.

## 1.73.1

### Patch Changes

- df8b776: Stop the auto-restart-until-mergeable and watch loops from treating the AI agent's own session comments (e.g. free-form "CI now green" status updates posted through the authenticated account) as new human feedback, which caused an endless restart loop until the iteration limit (issue #1827). The check window is now advanced monotonically, every comment the authenticated account posts during a session is tracked by ID, and watch-mode feedback counting excludes tool-generated comments by marker and tracked ID.

## 1.73.0

### Minor Changes

- 1cd647d: Fix all errors on graceful shutdown and add an experimental working-session guard.

  `hive` now fully waits for every in-flight `/solve` to finish before exiting on CTRL+C / `--stop`: signal handling is delegated to a single owner (resolving a double SIGINT-handler race that called `process.exit(130)` and cut the wait short), each solve worker is spawned in its own detached process group so the terminal's SIGINT no longer aborts solve/codex mid-task, and the wait has no time cap. Worker stderr is no longer mislabeled as `ERROR` — the child exit code remains the authoritative failure signal.

  Building on that, a new experimental `--do-not-shutdown-in-the-middle-of-working-session` option is added to `solve` and enabled by default for `hive`. With it, an interrupt (CTRL+C / SIGTERM) no longer aborts the AI tool mid-run: if an AI working session is in progress, solve finishes it, auto-commits any uncommitted changes, then shuts down gracefully (exit 130/143); if solve is only idle-waiting (e.g. for CI/CD) it stops immediately, and a second interrupt force-stops. `hive` now forwards a controlled SIGTERM to each in-flight `/solve` worker on the first CTRL+C (instead of only waiting) and passes the flag to every worker (opt out with `--no-do-not-shutdown-in-the-middle-of-working-session`). Graceful shutdown is treated as a normal stop, so it no longer posts a spurious "solution draft failed" comment. Standalone `solve` keeps the flag off by default, so its behavior is unchanged except that an interrupt now always auto-commits uncommitted changes before exiting.

## 1.72.7

### Patch Changes

- 61e2935: Fix "Failed to add .gitkeep" abort during auto-PR creation when the target repository's `.gitignore` matches the seed placeholder (issue #1825). Placeholder staging now routes through `addPlaceholderFileToGit`, which detects the ignored path with `git check-ignore` and retries with `git add -f`. Because the placeholder is created by the solver to seed the initial commit and removed once the task completes, force-adding it is safe.

## 1.72.6

### Patch Changes

- 57f15ec: Detect same-account human feedback in auto-restart comment monitoring only when the AI tool is idle, while still filtering hive-mind tool-generated comments by marker and tracked ID.

## 1.72.5

### Patch Changes

- c3a89a3: Recover auto-PR creation when a rejected push leaves the remote branch matching local HEAD, and improve push rejection diagnostics with exact branch and compare links.

## 1.72.4

### Patch Changes

- 82d440c: Fix fork creation verification for dotted repository names such as GitHub Pages forks.

## 1.72.3

### Patch Changes

- 502e78f: Use `lino-i18n` for Hive Mind translation loading and runtime lookup.

## 1.72.2

### Patch Changes

- 055a1a0: Fix `--auto-attach-solution-summary` so Codex-authored comments that use the
  visible "Working session summary" heading are counted as AI comments instead of
  being mistaken for hive-mind's automated summary comment.

## 1.72.1

### Patch Changes

- 249646e: Fix: Move Claude CLI resume command from GitHub comment to logs

  When usage limit is reached, the GitHub comment now only mentions the
  `--auto-continue-on-limit-reset` option instead of showing bash commands.
  This is more user-friendly for Telegram bot users who don't use CLI commands directly.

  The Claude CLI resume command is still available in the logs (in the collapsed
  block or gist link), allowing advanced users to resume manually if needed:

  ```bash
  (cd "/tmp/gh-issue-solver-..." && claude --resume session-id)
  ```

  Changes:
  - GitHub comments now only suggest using the `--auto-continue-on-limit-reset` option
  - Resume commands are kept in logs only (not in the visible comment)
  - Session ID is still shown for reference

  Fixes #942

## 1.72.0

### Minor Changes

- fffdfbf: Add experimental `--resume-on-auto-restart` support for resuming Claude auto-restart sessions with a minimal uncommitted-change prompt.

## 1.71.1

### Patch Changes

- aae5a08: Serialize merge queue auto-resolve sessions so conflicting pull requests resolve and drain CI one at a time.

## 1.71.0

### Minor Changes

- aacdb06: Make the `--tool gemini` integration produce meaningful JSON output and reach
  feature parity with `--tool claude` / `--tool codex`. Resolves #1809.
  - The wrapper now feeds the prompt to gemini-cli through `command-stream`'s
    `stdin` option instead of `cat <prompt-file> | gemini`, so the upstream
    non-zero exit code is no longer swallowed by the pipeline.
  - A new `detectGeminiPlainTextError` helper surfaces gemini-cli's plain-text
    failures (auth required, quota exceeded, invalid model, unknown argument,
    fatal error) as structured wrapper errors so headless callers stop seeing
    silent `success: true` runs when authentication is missing. Tracked upstream
    in [`google-gemini/gemini-cli`'s `validateNonInteractiveAuth`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/validateNonInterActiveAuth.ts);
    see `docs/case-studies/issue-1809/upstream-issue-draft.md` for the proposed
    upstream fix.
  - A run that emits zero `init`/`message`/`tool_use`/`result` JSONL events is
    now classified as a failure regardless of exit code, so empty runs cannot be
    reported as success anymore.
  - New optional flags wired through to gemini-cli: `--gemini-sandbox`
    (`--sandbox`), `--gemini-extensions` (`--extensions`),
    `--gemini-include-directories` (`--include-directories`, in addition to
    `tempDir`/`workspaceTmpDir` which are always included), and
    `--gemini-allowed-mcp-servers` (`--allowed-mcp-server-names`). `--verbose`
    now also toggles gemini-cli's own `--debug` flag.
  - New tests in `tests/test-gemini-support.mjs` lock in plain-text auth-error
    surfacing, zero-event failure detection, and the verbose/include-directories
    argv plumbing.
  - Case study published in `docs/case-studies/issue-1809/`.

## 1.70.0

### Minor Changes

- 35dc089: Add `--auto-resolve` to the `/merge` Telegram command. After the normal queue finishes, the bot now iterates every PR that was skipped because of merge conflicts and dispatches a `solve <pr-url> --auto-merge` session through `start-screen` — the same path other commands use — so conflict resolution runs with the default `sonnet` model and the PR is merged once the session finishes. Each PR/issue reference in the `/merge` progress and final messages is now rendered as a clickable MarkdownV2 link to the actual pull request or issue. Resolves #1805.

## 1.69.18

### Patch Changes

- 9aa5659: Fix `--auto-fork` mode failing when continuing an existing fork PR whose
  fork name already contained the upstream-owner prefix. `setupRepository`
  in `solve.repository.lib.mjs` was applying the
  `--prefix-fork-name-with-owner-name` option to `forkRepoName` (which is
  the authoritative head repo name from the PR's `headRepository.name`),
  producing a doubled prefix like
  `konard/labtgbot-labtgbot-telegram-claude-agent` and a 404 lookup. The
  prefix option now only controls fork _creation_, not fork _lookup_:
  when `forkRepoName` is present, the expected fork is
  `${forkOwner}/${forkRepoName}` and no alternate-name fallback is
  attempted. Resolves #1803.

## 1.69.17

### Patch Changes

- 46422f1: Increase the default `HIVE_MIND_USAGE_API_CACHE_TTL_MS` from 10 → 13 minutes so the Claude Usage API (`/api/oauth/usage`) is queried less frequently and we stop tripping the upstream "Resets in 3m Xs" rate-limit message. Operators can still override the value via the environment variable. Resolves #1798.

## 1.69.16

### Patch Changes

- ca0d938: Fix Telegram work-session completion failing with "Bad Request: can't parse entities" when the discovered Pull request URL contained Markdown-significant characters (`_`, `*`, `` ` ``, `[`). `appendPullRequestLine` (issue #1688) inserted the raw URL into a Markdown message even though the surrounding `Issue:` line was already escaped by `buildTelegramInfoBlock`, so a repo slug like `save_visiogetbb/pull/8` opened an italic entity at byte offset 318 that never closed. The appended `Pull request:` line is now passed through `escapeMarkdown`, and `safeReply`/`safeEditMessageText`/`installTelegramFormattingFallback` now log the offending byte-offset window and the plain-text fallback under `--verbose` so future parse errors point straight to the unescaped character. Resolves #1801.

## 1.69.15

### Patch Changes

- fbda6de: Fix `--auto-fork` failing on private repositories with read-only access when forking is allowed. `handleAutoForkOption` now probes the `allow_forking` repository attribute before bailing out: when it is `true`, fork mode is enabled (the same behaviour already used for public repos without write access); when it is explicitly `false`, the fatal exit explains that direct branch mode needs push/write access, fork mode is disabled, and the maintainer must either grant Write access or enable private forking; when it cannot be determined, we fall through with a verbose warning so `gh repo fork` can produce a precise downstream error. Resolves #1795.

## 1.69.14

### Patch Changes

- 32af9e1: Show subscription end date in `/limits` for Claude and Codex when the underlying providers expose it. Claude trials display the trial end date from the OAuth profile; Codex displays the renewal date decoded from the ChatGPT JWT (`chatgpt_subscription_active_until`). Lines are only rendered when real data is available.

## 1.69.13

### Patch Changes

- 52dfa8e: Preserve pull request `.gitkeep` edits during final cleanup so intentional `.gitkeep` deletions are not re-added.

## 1.69.12

### Patch Changes

- 8ca35d6: Fix Telegram bot localization fallbacks for supported languages.

## 1.69.11

### Patch Changes

- bdca974: Notify existing pull requests when solver pre-exit failures happen before a working session can post its own failure comment.

## 1.69.10

### Patch Changes

- 7d58938: feat: add opt-in GitHub API rate-limit usage logging

  Adds optional logging of current GitHub API rate-limit usage through the centralized `gh` retry wrapper so every wrapped GitHub CLI call can report quota usage while debugging.

  Features:
  - Disabled by default for backward compatibility
  - Enable with `--github-rate-limits-logging` when debugging API usage
  - Logs current `core`, `graphql`, and `search` rate-limit buckets after each centralized wrapped `gh` attempt
  - Keeps the logging probe non-fatal so quota logging cannot break solve workflows

  Example output:

  ```
  📊 GitHub rate limits after $gh (gh api repos): core: 780/5000 used (+29 since last check), 4220 remaining, resets 2026-05-12T10:30:00.000Z; graphql: 10/5000 used (no change), 4990 remaining, resets 2026-05-12T10:30:00.000Z
  ```

## 1.69.9

### Patch Changes

- 9d04a2f: Detect empty repositories before branch creation when Git reports an unborn branch name.

## 1.69.8

### Patch Changes

- 175eaee: Fix two defects in the Telegram `/stop` command. (1) When `/stop` cancels a queued task by URL or reply, the original "⏳ Waiting (… queue #N)" card is now edited in place to show the task was cancelled (instead of leaving it stale). (2) Allow the user who originally ran `/solve` or `/hive` to `/stop` their own task by UUID or URL in a group chat, mirroring the requester authorization already used by `/terminal_watch` and `/watch` (PR #1779). The chat-creator fallback is preserved, so chat owners can still stop any task.

## 1.69.7

### Patch Changes

- 2ea2bb7: Extend Telegram `/stop` to accept a GitHub issue or pull-request URL (passed as the argument or contained in the replied-to message). The bot looks the URL up in the in-memory solve queue and either cancels the queued item or forwards CTRL+C via `$ --stop <UUID>` to the running isolated session. The UUID flow from #524 and the chat-level pause flow from #1081 are preserved.

## 1.69.6

### Patch Changes

- c2c51fa: Allow Telegram `/terminal_watch` and `/watch` to be used by the user who started a tracked session while preserving chat-owner access and private-repository DM routing.

## 1.69.5

### Patch Changes

- 31b0f7e: Add issue language auto-detection for solve work prompts and localize limits output.

## 1.69.4

### Patch Changes

- 105172b: Fix auto-PR creation failure on fork-of-fork repositories. When `solve` runs against an issue in a repository that is itself a GitHub fork and the user has direct write access, `gh pr create` previously resolved the base repository to the upstream parent (because `gh repo clone` auto-adds an `upstream` remote for forks), producing a misleading "No commits between" error. The auto-PR command builder now always passes `--repo ${owner}/${repo}` so the PR is created against the explicit target. The fatal error block also detects the failure mode and prints a fork-aware diagnostic with the resolved remotes and a manual recovery command.
- d89243f: Stabilize the version-info timing test that broke CI/CD by using the same 30 second reasonable bound as the broader version-info structure test. The version collector still runs commands in parallel, but individual commands can legally spend 5 seconds on a timeout and then another 5 seconds on a fallback, so the previous 10 second wall-clock assertion was too tight for GitHub-hosted runners.
- db56b5a: Sync custom fork base branches proactively. When a user passes `--base-branch` in fork mode, the solver now copies the requested branch from `upstream` to the user's fork before creating the issue branch, and falls back to the same recovery if branch creation still trips on a missing `origin/<baseBranch>`. This prevents the `fatal: 'origin/<baseBranch>' is not a commit` failure that surfaced for issue #1772 when an existing fork pre-dated upstream's custom branch.

## 1.69.3

### Patch Changes

- d7f95e8: Add experimental `--auto-support-agents-md-as-claude-md` support for temporarily exposing AGENTS.md as CLAUDE.md during Claude runs.
- 890e81f: Stop auto-merge from waiting forever when cancelled CI cannot be re-run automatically.

## 1.69.2

### Patch Changes

- 0ff36b4: Count open draft pull requests when `/hive --skip-issues-with-prs` checks linked solution drafts, preventing duplicate work while an existing PR is still in progress.

## 1.69.1

### Patch Changes

- 2911597: Fix feedback comment counting to run local git timestamp checks in the prepared repository directory, avoiding misleading `not a git repository` diagnostics in detached solve sessions.

## 1.69.0

### Minor Changes

- 8939a2a: Add experimental `--show-limits` virtual option to hive-telegram-bot's `/solve` and `/hive` commands. When set, the bot embeds a Claude (or Codex) usage snapshot in the executing message and a delta block (start → end, with a parallel-sessions disclaimer) in the completion message. Limits are fetched via the existing 20-minute cached helpers so the upstream usage API isn't rate-limited. The flag is stripped before the args reach `/solve` or `/hive`, and bot administrators can disable it with `TELEGRAM_SHOW_LIMITS=false`. Refs: #594.

## 1.68.0

### Minor Changes

- cbc7033: Switch the test runner to folder-based discovery and deprecate `start-screen` in favour of `--isolated screen` (issue #1758).
  - `scripts/run-tests.mjs` now discovers every `*.mjs` / `*.test.mjs` / `*.test.js` file under `tests/` automatically. The hard-coded `LEGACY_DEFAULT_TESTS` allow-list is gone, so new test files no longer need a runner update to be picked up.
  - New markers complement the existing `@hive-mind-test-suite <name>` marker:
    - `@hive-mind-integration` — skip the file in the default suite; opt in via `--suite integration` or `HIVE_MIND_RUN_INTEGRATION=1`.
    - `@hive-mind-test-skip` — exclude helper / fixture modules from every suite.
  - `tests/integration-guard.mjs` exposes `skipUnlessIntegration(import.meta.url)` for token- or network-heavy tests.
  - `src/start-screen.mjs` and `src/telegram-command-execution.lib.mjs::executeStartScreen` print a one-shot deprecation banner to stderr (suppressible with `HIVE_MIND_SUPPRESS_DEPRECATIONS=1`) recommending `--isolated screen`, which is already the default for `hive`/`solve` invocations through the Telegram bot.
  - Adds regression tests `tests/test-issue-1758-runner-discovery.mjs`, `tests/test-issue-1758-start-screen-deprecation.mjs`, and `tests/test-issue-1758-integration-guard.mjs`.
  - Documents the analysis under `docs/case-studies/issue-1758/`.

## 1.67.2

### Patch Changes

- 240231e: Verify the pull request still links to the issue after every work session inside `--watch`, `--auto-restart-until-mergeable`, and `--finalize`, so that an iteration that turns out to be the last one cannot leave the PR un-linked when the AI rewrote the description without a closing keyword.

## 1.67.1

### Patch Changes

- d37f752: Working session summary now always appears before the working session log on every PR comment thread. The per-iteration code in auto-restart-until-mergeable mode and watch / temporary auto-restart mode now posts the summary comment before uploading the log, matching the existing top-level flow.

## 1.67.0

### Minor Changes

- d88aa94: Add `--ui-language` and `--work-language` flags for two-track i18n (issue #378). The existing `--language LOCALE` continues to set both tracks at once; `--ui-language LOCALE` overrides only UI/log strings, and `--work-language LOCALE` overrides only the language the AI uses for free-form output (PR/issue comments, commit messages, chat replies). Code, identifiers, and CLI strings stay in their original form. Supported locales: `en` (default), `ru`, `zh`, `hi`. The Telegram bot now resolves the user's effective locale and propagates it as `--language` to spawned solve/hive/task processes when no language flag is already present.

## 1.66.0

### Minor Changes

- f744d5a: Add internationalisation (i18n) for user-facing terminal output and the Telegram bot. Translations are stored in `links-notation` files under `src/locales/` (`en`, `ru`, `zh`, `hi`) and loaded via `lino-objects-codec`. Adds a `--language <en|ru|zh|hi>` option to `solve`, `hive`, `task`, and `review` (defaults to detected system locale). The Telegram bot picks each user's language from `ctx.from.language_code` with a per-user override settable through a new `/language <code|default>` command (in-memory, resets on bot restart). Built-in commands `/limits`, `/version`, `/solve`, `/hive`, and `/language` now reply in the user's selected language. AI prompts are intentionally untouched - only human-facing strings are translated.

## 1.65.2

### Patch Changes

- 0214c9e: Retry transient 5xx/network errors across all `gh` exec sites. Previously a single 504 from the GitHub GraphQL endpoint could abort `solve` during `gh pr create`. The retry helper now handles HTTP 502/503/504, socket hang up, ECONNRESET, ETIMEDOUT, and TLS handshake timeouts in addition to rate-limit errors, with a separate retry budget and exponential backoff. All direct `execAsync('gh ...')` sites are routed through `execGhWithRetry`.

## 1.65.1

### Patch Changes

- d5cd096: Add a solve flag to disable separate error-report issue creation while preserving original issue failure comments, and improve pre-PR branch divergence diagnostics.

## 1.65.0

### Minor Changes

- 14fe57e: Prevent normal Docker release manifest jobs from downloading DinD digest artifacts.
- 74ce579: Reduce `/terminal_watch` Telegram edits by updating only when the displayed terminal snapshot changes and count only real terminal snapshot updates.
- 78ab6e2: Add `--auto-delete-branch-on-merge` option for the `solve` command. When set together with `--watch`, the branch is deleted from the remote after the pull request is merged; when set together with `--auto-merge`, the auto-merge call requests branch deletion as part of the merge. The option is opt-in (default `false`), enables full GitHub Flow automation, avoids temporary auto-restart cleanup, uses the GitHub REST API for watch-mode deletion, and treats "branch already gone" responses as success so it does not warn when GitHub's "Automatically delete head branches" repo setting beats us to it.
- 152de95: Add a Claude CLI streaming input case study with reproducible experiment scripts.

## 1.64.4

### Patch Changes

- 20f5898: Add `/stop <UUID>` and reply-to-message-with-UUID modes to the Telegram bot (#524). Sending `/stop <uuid>` (or replying with `/stop` to a message containing a UUID) forwards CTRL+C to the matching isolated `/solve` or `/hive` session via `$ --stop <uuid>` from link-foundation/start (link-foundation/start#112), so individual screen/tmux/docker sessions can be cancelled from Telegram. Mirrors the existing `/log` and `/terminal_watch` UUID-resolution pattern. Bare `/stop` retains its existing chat-pause behaviour (#1081).

## 1.64.3

### Patch Changes

- dd52682: Sanitize all user-facing output to prevent token leaks (#1745).
  - All comment-posting paths (`postComment`, `editComment`, `postTrackedComment`) run bodies through `sanitizeOutput` (canonical name) / `sanitizeCommentBody` (active-token wrapper). `sanitizeLogContent` is preserved as a backward-compatible alias.
  - `KNOWN_LOCAL_TOKEN_ENV_VARS` registry masks tokens by exact env value (Telegram, GitHub, Anthropic/Claude, OpenAI/Codex, Gemini/Google, Qwen/Dashscope, OpenCode, AgentCLI, HuggingFace).
  - Three independent CLI flags: `--dangerously-skip-output-sanitization`, `--dangerously-skip-code-output-sanitization`, `--dangerously-skip-active-tokens-output-sanitization` — all default false; active-tokens skip stays separate so the broad skip flag still keeps active-token masking on.
  - Process-wide sanitization counters (`getSanitizationStats`, `formatSanitizationSummary`) print a one-line summary at the end of each run with a hint to use `--dangerously-skip-output-sanitization` when masking blocks the user's workflow.
  - `extractTokensFromUserContent` carve-out helper: tokens already present in user-provided content (issue body, non-bot comments, pre-existing code) are passed as `excludeTokens` so the sanitizer leaves them untouched while still masking active local tokens.
  - Post-finish sweep (`runPostFinishSweep`) re-reads bot-authored PR comments and the PR description after the AI session completes and edits in place if a leak slipped past the live sanitizer.
  - ESLint guardrail (`gh-rate-limit/require-sanitized-output`) flags raw `gh pr comment`, `gh issue comment`, `gh pr edit`, and `gh api .../comments` calls that bypass the sanitizer.
  - Out-of-band Telegram leak DM with masked summaries when a known-local token is detected in an outbound comment.
  - Hidden owner-only `/tokens` Telegram command lists configured tokens (always masked, private chat only).
  - `maskToken` defaults to 3+3 characters per issue requirements.
  - secretlint preset (best-of-breed) runs alongside our custom patterns; mismatch warnings surface gaps.

## 1.64.2

### Patch Changes

- 320ca42: Fix budget stats sub-agent context-fill calculation so cumulative-only rows (e.g. Claude Haiku 4.5 sub-agent calls that never appear in the parent JSONL) use `input + cache_creation` instead of `input + cache_creation + cache_read`. The previous formula double-counted the cached prefix replayed across calls and produced impossible percentages such as `1.2M / 200K (583%)`.

## 1.64.1

### Patch Changes

- 51a8721: Add a separate `konard/hive-mind-dind` Docker image for nested Docker testing.

## 1.64.0

### Minor Changes

- 2ffb808: Add experimental `--use-agent-commander` option to delegate supported tool execution to the agent-commander library, including Claude, Codex, OpenCode, Agent, Qwen, and Gemini.

## 1.63.0

### Minor Changes

- b7b0721: Add direct Google Gemini CLI support for solve, hive, queueing, model validation, structured stream JSON parsing, and Telegram `/gemini` aliases.

## 1.62.1

### Patch Changes

- a683edf: Fix budget stats restored-context input accounting so sub-session lines include cache reads, use `sub-sessions` wording, and no longer render the obsolete `peak request:` label.

## 1.62.0

### Minor Changes

- Add direct Qwen Code CLI support for solve and hive workflows.

## 1.61.0

### Minor Changes

- 728b0ed: Add Telegram `/task` issue creation from repository links and issue text while preserving `/split` behavior.

## 1.60.0

### Minor Changes

- Add issue-based task splitting with `/task` and `/split` Telegram commands.

## 1.59.7

### Patch Changes

- 4f03aea: fix(solve): post a Working session summary at the end of every working session — issue #1728.

  `--auto-attach-solution-summary` previously only ran in `solve.mjs`'s top-level flow.
  Iterations inside `--auto-restart-until-mergeable` (`src/solve.auto-merge.lib.mjs`) and
  `--watch` / temporary auto-restart (`src/solve.watch.lib.mjs`) called
  `executeToolIteration()`, uploaded a log comment, and discarded the AI's
  `toolResult.resultSummary` — so when the AI finished an iteration without posting
  a comment, the user saw only the start (`Auto-restart triggered`) and end
  (`Auto-restart-until-mergeable Log`) brackets with no AI conclusions in between.
  Reproduced live on link-foundation/box PR #83 between comment ids
  [`4345164478`](https://github.com/link-foundation/box/pull/83#issuecomment-4345164478)
  and [`4345439482`](https://github.com/link-foundation/box/pull/83#issuecomment-4345439482).

  Fix: extracted the attach-decision into a single helper
  `maybeAttachWorkingSessionSummary` in `src/solve.results.lib.mjs` that all three
  working-session call sites (`solve.mjs`, `solve.auto-merge.lib.mjs`,
  `solve.watch.lib.mjs`) invoke with their own `iterationStartTime`. Each successful
  iteration now ends with either an AI-authored comment OR an automated
  "Working session summary" comment.

  Also renamed the comment header from "Solution summary" to "Working session
  summary" because not every working session is a solution draft — many are
  continuation/restart iterations. CLI flag names (`--attach-solution-summary`,
  `--auto-attach-solution-summary`, `--no-auto-attach-solution-summary`) and
  function names are preserved for backwards compatibility. The new header is
  registered in `TOOL_GENERATED_COMMENT_MARKERS` so a previous iteration's summary
  is excluded from the next iteration's "did the AI post anything?" check.

  Tests: extended `tests/test-solution-summary.mjs` to cover the new helper, the
  header rename, the marker registration, and the per-iteration wiring in
  `solve.auto-merge.lib.mjs` / `solve.watch.lib.mjs`.

  Case study: `docs/case-studies/issue-1728/`.

## 1.59.6

### Patch Changes

- d6d05a0: Fully safeguard from GitHub API rate-limit errors — issue #1726.

  `/merge` merged a draft PR even though every `gh api` call had been failing
  with `HTTP 403: API rate limit exceeded`. The merge subsystem caught those
  errors silently in `getActiveRepoWorkflows()` and reported _"no CI checks
  and repo has no active workflows — no CI/CD configured"_, which `/merge`
  interpreted as _"all clear"_. Verbose log
  ([`docs/case-studies/issue-1726/data/a4dccea2-a941-4a0c-a50e-60b1ed454e1e.log`](./docs/case-studies/issue-1726/data/a4dccea2-a941-4a0c-a50e-60b1ed454e1e.log),
  lines 40251–40269):

  ```
  [VERBOSE] /merge: Error fetching workflows for link-foundation/relative-meta-logic:
    Command failed: gh api "repos/link-foundation/relative-meta-logic/actions/workflows" --paginate --slurp
  gh: API rate limit exceeded for user ID 1431904 ... (HTTP 403)

  [VERBOSE] /merge: PR #100 has no CI checks and repo has no active workflows - no CI/CD configured
  ```

  Two combining root causes:
  1. **`getActiveRepoWorkflows()` swallowed exceptions** in
     [`src/github-merge.lib.mjs`](./src/github-merge.lib.mjs) and returned
     `[]`. Rate-limit responses became "this repo has no workflows", which the
     merge gate treated as "no CI configured, safe to merge".
  2. **No gh API call site had rate-limit retry**. The existing
     `ghCmdRetry`/`ghRetry` helpers only recognised transient TCP/TLS faults,
     so a 403 fell straight through. ~135 raw `$gh ...` and
     ``exec(`gh ...`)`` call sites scattered across `src/solve.*`,
     `src/github-merge.*`, scripts, and reviewers.

  Fix:
  - **New rate-limit module**
    [`src/github-rate-limit.lib.mjs`](./src/github-rate-limit.lib.mjs) with
    `isRateLimitError`, `parseRateLimitReset`, `fetchNextRateLimitReset`,
    `computeRateLimitWait`, `ghWithRateLimitRetry`, `execGhWithRetry`,
    `wrapDollarWithGhRetry`. Applies the issue's policy:
    `wait = (resetTime − now) + bufferMs (10 min) + random(0..jitterMs) (0..5 min)`,
    reusing `limitReset.bufferMs` / `limitReset.jitterMs` from
    [`src/config.lib.mjs`](./src/config.lib.mjs) (introduced in #1236).
  - **Propagate errors instead of swallowing**. `getActiveRepoWorkflows()`
    no longer wraps the gh call in try/catch that returns `[]`. Errors bubble
    up; the merge gate sees the failure and stops.
  - **Layered retry in legacy helpers**. `ghRetry` and `ghCmdRetry` in
    [`src/lib.mjs`](./src/lib.mjs) check `isRateLimitError` first and delegate
    to `ghWithRateLimitRetry` before applying transient-network retry.
  - **Local `exec` shim** in 7 merge files rebound through
    `ghWithRateLimitRetry` — converts every existing ``exec(`gh ...`)`` site
    without per-call edits.
  - **Wrapped `$` at every entry point** (15 files). `wrapDollarWithGhRetry`
    routes every `$gh ...` through the retry helper while passing non-gh
    commands unchanged.
  - **Marker imports** in 17 callee files that receive `$` as a parameter,
    declaring rate-limit awareness for the ESLint rule.
  - **Queue threshold lowered** from 75% to 50% in
    [`src/queue-config.lib.mjs`](./src/queue-config.lib.mjs).
  - **Custom ESLint rule**
    [`eslint-rules/no-direct-gh-exec.mjs`](./eslint-rules/no-direct-gh-exec.mjs)
    flags any unsafe `gh` exec call site; files that import a known-safe
    wrapper are exempted at file scope.

  Tests:
  - [`tests/github-rate-limit.test.mjs`](./tests/github-rate-limit.test.mjs)
    — 22 unit tests covering `isRateLimitError` (primary, secondary,
    abuse-detection, stderr, cause-chain), `parseRateLimitReset` (header
    variants), `computeRateLimitWait` (future / null / past reset, jitter
    bounds), `ghWithRateLimitRetry` (success, propagation, retry-then-succeed,
    exhausted retries), `wrapDollarWithGhRetry` (passthrough, retry,
    propagation).
  - [`tests/test-no-direct-gh-exec-rule.mjs`](./tests/test-no-direct-gh-exec-rule.mjs)
    — RuleTester valid/invalid cases.
  - Updated `tests/queue-config.test.mjs` and `tests/limits-display.test.mjs`
    for the 50% threshold.

  Documentation:
  [`docs/case-studies/issue-1726/`](./docs/case-studies/issue-1726/README.md)
  contains the failing run logs, root-cause analysis, fix breakdown, and
  verification commands.

- bb0af8c: Fix `check-file-line-limits` CI failure on `main` after issue #1726 merge.

  After PR #1726 (rate-limit safeguards) merged into `main`, the
  `check-file-line-limits` job failed because three `.mjs` files crossed the
  1500-line hard limit:
  - `src/hive.mjs` — 1500 → 1504 lines
  - `src/limits.lib.mjs` — 1497 → 1501 lines
  - `src/solve.repository.lib.mjs` — 1500 → 1501 lines

  Two root causes combined: (1) the per-file marker block PR #1726 added was 4
  lines (2 comment lines + import + `void`), with no headroom check; (2) ESLint's
  `max-lines` rule was configured with `skipBlankLines: true, skipComments: true`
  while the CI script counts raw `wc -l`, so `npm run lint` passed locally even
  though the CI script would fail. Local lint and CI line-limit had silently
  drifted apart. See
  [`docs/case-studies/issue-1730`](./docs/case-studies/issue-1730/README.md)
  for the timeline, log excerpts, and template comparison.

  Fix:
  - **Synchronize ESLint `max-lines` with the CI script** in
    [`eslint.config.mjs`](./eslint.config.mjs) by setting `skipBlankLines: false,
skipComments: false`. Now `npm run lint` catches the failure locally before
    push, restoring the invariant the rule's comment claimed.
  - **Compact the rate-limit marker** introduced by #1726 from 4 lines to 1 line
    in all 17 files. ESLint's existing `varsIgnorePattern: '^_'` means the
    `void _wrapDollarWithGhRetry;` line was redundant; the trailing-comment form
    preserves rate-limit awareness for `no-direct-gh-exec` while saving 3 lines
    per file. Files: `src/hive.mjs`, `src/limits.lib.mjs`,
    `src/{solve.session,solve.preparation,solve.progress-monitoring,solve.error-handlers,solve.feedback,solve.auto-pr,solve.branch-errors,hive.recheck,github.batch,bidirectional-interactive,token-sanitization}.lib.mjs`,
    `src/youtrack/youtrack-sync.mjs`,
    `scripts/{create-github-release,format-github-release,format-release-notes}.mjs`.
  - **Compact `solve.repository.lib.mjs`** wrap pattern from 4 lines to 3 while
    keeping the destructure form so `eslint-rules/no-direct-gh-exec.mjs` still
    recognizes `wrapDollarWithGhRetry` in scope.

  After the fix, all three previously-failing files are at or below 1500 raw
  lines (1500 / 1498 / 1500) and `npm run lint` would now reject any
  re-introduction of the regression.

## 1.59.5

### Patch Changes

- bb24175: Fix `/merge` to correctly detect active CI runs on the default branch — issue
  #1722.

  The `/merge` command merged PR #1719 even though a CI/CD workflow run was
  still in progress on `main`. The merge triggered a new run, which cancelled
  the previous one. Verbose log:

  ```
  [VERBOSE] /merge: Checking for active CI runs on link-assistant/hive-mind branch main...
  [VERBOSE] /merge: Error checking active runs on main: stdout maxBuffer length exceeded
  [VERBOSE] /merge: No active CI runs on main branch. Ready to proceed.
  ```

  Two compounding root causes in
  [`src/github-merge.lib.mjs`](./src/github-merge.lib.mjs)
  `getActiveBranchRuns()` (and the parallel
  [`src/github-merge-repo-actions.lib.mjs`](./src/github-merge-repo-actions.lib.mjs)
  `getAllActiveRepoRuns()` introduced by issue #1503):
  1. **No `maxBuffer` override on `gh api --paginate --slurp`.** Node's default
     `child_process.exec` buffer is 1 MB; the unfiltered `actions/runs` response
     on this repo's `main` was 12.7 MB, so `exec` rejected with
     `stdout maxBuffer length exceeded`.
  2. **Fetch errors became "no active runs".** The `catch` block returned
     `hasActiveRuns: false`, which the caller (`waitForBranchCI`) interpreted as
     "branch CI is idle, ready to merge". A transient fetch/buffer/parse error
     was indistinguishable from genuine idleness.

  Fix:
  - **Server-side `?status=` filter**, looped over the active set
    (`in_progress`, `queued`, `waiting`, `requested`, `pending`) with run-id
    dedup. Response size scales with active-run count, not with historical-run
    count — typically a few KB instead of 12+ MB.
  - **Raise `exec` `maxBuffer` to `githubLimits.bufferMaxSize`** (10 MB, env
    `HIVE_MIND_GITHUB_BUFFER_MAX_SIZE`) for all `gh` calls in
    `github-merge.lib.mjs` and `github-merge-repo-actions.lib.mjs`. The existing
    `githubLimits` infrastructure was already used in `github.batch.lib.mjs`;
    this just wires it into the `/merge` paths.
  - **Stop swallowing fetch errors as "idle".** Errors now propagate. The
    surrounding `waitForBranchCI` / `waitForAllRepoActions` poll loops already
    retry on the next tick; the timeout-final check has its own try/catch that
    returns an explicit failure (instead of a false-positive "ready to merge").

  Tests:
  [`tests/test-active-branch-runs-buffer-1722.mjs`](./tests/test-active-branch-runs-buffer-1722.mjs)
  shadows `gh` on `PATH` with a Node script that scripts active-run responses,
  and asserts: (a) every call uses `?status=`, (b) duplicate runs across
  statuses are deduplicated, (c) >1 MB responses are handled cleanly, (d)
  `gh` failures throw rather than report idle, (e) `waitForBranchCI` keeps
  polling on errors, (f) idle branches still resolve as ready,
  (g) `getAllActiveRepoRuns` parity.

  Documentation:
  [`docs/case-studies/issue-1722/`](./docs/case-studies/issue-1722/README.md)
  contains the timeline (with downloaded bot log, cancelled-run logs, run
  metadata), facts, per-symptom root-cause analysis, and solution plan.
  [`experiments/issue-1722-buffer-overflow.mjs`](./experiments/issue-1722-buffer-overflow.mjs)
  is a minimal reproduction. No upstream report required — the fix lives
  entirely in this repo.

- 1a92ca1: Fix flaky CI `test-suites` job caused by `use-m`'s no-retry global npm install
  — issue #1724.

  CI run [25109962685](https://github.com/link-assistant/hive-mind/actions/runs/25109962685/job/73581228475)
  on `main` failed in the `test-suites` job at the third test file
  (`tests/test-active-branch-runs-buffer-1722.mjs`) with:

  ```
  Error: Failed to install command-stream@latest globally.
    [cause]: Error: Command failed: npm install -g command-stream-v-latest@npm:command-stream@latest
    npm error code ENOTEMPTY
    npm error path /opt/hostedtoolcache/node/24.14.1/x64/lib/node_modules/command-stream-v-latest/js/src/commands
  ```

  Root cause: `src/github.lib.mjs` and `src/playwright-mcp.lib.mjs` call
  `await use('command-stream')` at module top level (via `use-m`). Every test
  file that transitively imports either module re-runs
  `npm install -g command-stream-v-latest@npm:command-stream@latest`. `use-m`'s
  `ensurePackageInstalled` issues a single `npm install -g` with no retry, and
  npm intermittently fails with `ENOTEMPTY: directory not empty, rmdir` on
  GitHub-hosted Ubuntu runners (a long-standing npm rmdir race against itself
  when the previous global install left files behind).

  Fix:
  - New
    [`scripts/preinstall-use-m-packages.mjs`](./scripts/preinstall-use-m-packages.mjs)
    pre-installs every package the codebase loads through `use-m @latest`
    (`command-stream`, `getenv`, `links-notation`, `@dotenvx/dotenvx`,
    `telegraf`, `zx`, `yargs`) using the same alias scheme `use-m` does
    (`<pkg-without-@-or-/>-v-latest`), with exponential-backoff retry on the
    flake symptoms (`ENOTEMPTY` / `EBUSY` / `EPERM` / `ECONNRESET` / `ETIMEDOUT`
    / `EAI_AGAIN` / `429` / `503`). After this step, `use-m`'s
    `installedVersion === latestVersion` early-return path skips the install at
    test time, so test imports never touch `npm install -g` again.
  - The script also satisfies the case-study "verbose mode for next iteration"
    requirement via `PREINSTALL_USE_M_VERBOSE=1` (or `RUNNER_DEBUG=1`), which
    logs each attempt's command, stdout, stderr, and backoff delay, and
    recognizes "package present on disk after a flake" as recovered success.
  - Wires `node scripts/preinstall-use-m-packages.mjs` into the `test-suites`
    and `test-execution` jobs in
    [`.github/workflows/release.yml`](./.github/workflows/release.yml) right
    after `npm install`, before any step that runs test files or `solve.mjs`.

  Tests:
  [`tests/test-preinstall-use-m-packages-1724.mjs`](./tests/test-preinstall-use-m-packages-1724.mjs)
  covers the alias scheme, retryable-error matcher, exponential backoff, and
  the four `installWithRetry` paths (first-success, retry-then-succeed,
  non-retryable-abort, recovered-from-disk) deterministically (no real npm
  calls). Marked `@hive-mind-test-suite default` so it runs in the same job
  that previously flaked.

  Documentation:
  [`docs/case-studies/issue-1724/`](./docs/case-studies/issue-1724/README.md)
  contains the timeline, verbatim error, downloaded failed-run logs, the
  no-retry snippet from the live `use-m` source
  (`logs/use-m-source.js`), the comparison with both pipeline templates
  (JS/Rust — neither template uses `use-m @latest` at module load yet, so the
  flake is hive-mind-specific until they do), and the implementation plan.

## 1.59.4

### Patch Changes

- b2e0d12: Fix `/terminal_watch` uploading the full session log file when the watch
  completes — addresses issue
  [#1720](https://github.com/link-assistant/hive-mind/issues/1720).

  Before this fix, `/terminal_watch` finished by calling
  `bot.telegram.sendDocument(chatId, ...)` to attach the `<uuid>.log` file. That
  had two unwanted effects:
  - It duplicated work that the dedicated `/log` command already does.
  - The bare `bot.telegram.sendDocument(chatId, ...)` call did not carry
    `message_thread_id`, so in forum-enabled supergroups the document landed in
    the **General** topic instead of the topic where `/terminal_watch` was
    invoked, and it was not threaded as a reply.

  `/terminal_watch` now only updates the live "✅ Terminal watch complete"
  message at the end of the session. To download the log, use
  `/log <uuid>` — it correctly replies in the originating topic via
  `ctx.replyWithDocument`, which Telegraf annotates with `message_thread_id`
  automatically.

  A new regression test (`tests/test-issue-1720-terminal-watch-no-log.mjs`)
  guards both behaviours, and `tests/test-issue-467-terminal-watch.mjs` was
  updated to assert that no document is uploaded by the watcher.

- 5c87a38: Fix `hive` to (a) stop forwarding `false` for solve options whose `type` is
  `'string'` but whose `default` is `false`, and (b) exit non-zero when any
  worker fails — issue #1718.

  Previously, when a user ran `/hive` against several issues, every spawned
  `solve` worker crashed with:

  ```
  Invalid --working-session-live-progress value: "false". Expected "comment" or "pr".
  ```

  …and `hive` itself still exited with code `0`, so the Telegram bot rendered a
  green "Work session finished successfully" envelope even though zero PRs had
  been created.

  Two independent root causes:
  1. **Auto-forwarder leaked `false` as a string.** In
     [`src/hive.mjs`](./src/hive.mjs), the auto-forward block read:

     ```js
     } else if ((def.type === 'string' || def.type === 'number') && value !== undefined) {
       args.push(`--${optionName}`, String(value));
     }
     ```

     For `working-session-live-progress`, `solve.config.lib.mjs` declares
     `type: 'string', default: false`. yargs preserves the boolean `false`
     verbatim, so hive forwarded `--working-session-live-progress false`,
     which `solve` rejects. The fix adds `&& value !== false` to the
     predicate. Other `type:'string'` options whose `default` is `false`
     are now also protected by a single defense-in-depth check.

  2. **No non-zero exit on worker failures.** After `monitorWithSentry()`
     resolved, hive returned without consulting `issueQueue.getStats()`. The
     fix queries `finalStats = issueQueue.getStats()` and calls
     `safeExit(1, …)` when `finalStats.failed > 0`, mirroring the exit
     semantics solve already uses. Wrappers like `start-command`, the Telegram
     bot, and CI now correctly observe the failure.

  `--isolation screen` (R3 of the issue) was already wired through correctly;
  no change required there. The verbose forwarder dump
  (`📋 Command: ${solveCommand} ${args.join(' ')}`) — which is what allowed us
  to diagnose this run in the first place — is preserved.

  Tests: [`tests/test-issue-1718-hive-passthrough-false.mjs`](./tests/test-issue-1718-hive-passthrough-false.mjs)
  locks the option shape, asserts both fixes are present in `src/hive.mjs`,
  replays the forwarder logic on synthetic argv, and adds a defense-in-depth
  sweep that no `type:'string'` / `default:false` option ever produces
  `--<flag> false`.

  Documentation: [`docs/case-studies/issue-1718/`](./docs/case-studies/issue-1718/README.md)
  contains the timeline reconstructed from the user's `screen` log, the
  distilled facts, the per-symptom root-cause analysis, the solution plan, and
  notes confirming no upstream report (yargs / start-command) is required.

## 1.59.3

### Patch Changes

- b0bffdc: Fix `solve` to skip fork mode when the upstream repository is private and the
  user has direct write access — even when the existing PR was created from a
  fork (issue #1716).

  Previously, when a PR was originally created from a fork (e.g. the upstream
  repo was public and the user without write access used `--auto-fork`), but
  the upstream is now private and the user has direct write access, `solve`
  still tried to clone the fork. If the fork had been renamed, deleted, or was
  otherwise inaccessible (which is common after a public→private flip), repo
  setup failed with `Fork not accessible`.

  The auto-fork path already handled this correctly (logging
  _"Auto-fork: Write access detected to private repository, working directly on
  repository"_ and leaving `forkOwner = null`). The bug was that **continue
  mode** — both the auto-continue path and the direct PR-URL path — re-set
  `forkOwner` from the existing PR's head repository unconditionally,
  overriding the auto-fork bypass.

  Fix: in [`src/solve.mjs`](./src/solve.mjs):
  - Hoist `detectRepositoryVisibility(owner, repo)` out of the
    `if (argv.autoCleanup === undefined)` block so `isRepoPublic` is
    unconditionally available.
  - Compute one bypass flag,
    `skipForkForPrivateUpstream = !isRepoPublic && !argv.fork && hasWriteAccess`.
  - Gate both fork-from-PR-data branches behind it. When set, log
    _"Issue #1716: Working directly on the private upstream repository"_ and
    leave `forkOwner = null` so the regular non-fork code path runs.
  - Gate the maintainer-modify auto-toggle on `forkOwner` being non-null so it
    doesn't fire when the bypass triggered.

  Explicit `--fork` still wins (the bypass requires `!argv.fork`), and users
  with no write access on a private repo still hit the existing auto-fork
  private-repo guard (the bypass requires `hasWriteAccess`).

  Tests: [`tests/test-issue-1716-private-repo-skip-fork.mjs`](./tests/test-issue-1716-private-repo-skip-fork.mjs)
  locks the flag declaration, the exact condition formula, both
  fork-detection paths, and four scenario simulations
  (private+writeAccess → bypass; public → no bypass; explicit `--fork` → no
  bypass; no writeAccess → no bypass).

  Documentation: [`docs/case-studies/issue-1716/`](./docs/case-studies/issue-1716/README.md)
  contains the timeline reconstructed from the user's failure log, the
  distilled facts, the per-symptom root-cause analysis, and the implementation
  plan.

## 1.59.2

### Patch Changes

- 9e96635: Fix Telegram `/solve` repo-not-accessible message still suggesting `--auto-accept-invite` even when that flag is already active (issue #1714). After issue #1694 flipped `--auto-accept-invite` to default-on, `src/telegram-bot.mjs` was passing `autoAcceptInvite: args.some(a => a === '--auto-accept-invite')` to `validateGitHubEntityExistence()` — but the literal flag is no longer present in the typical default-on invocation, so the suppression added by issue #1692 silently regressed. The call now reads `parsedSolveArgs?.autoAcceptInvite` (matching the auto-accept pre-check two lines above), so the hint is suppressed when the flag is active and only shown when the user explicitly opts out with `--no-auto-accept-invite`. Adds `tests/test-issue-1714-auto-accept-invite-hint.mjs` covering the parsed-argv contract and a source-level guard against the `args.some(...)` form returning, plus a case study under `docs/case-studies/issue-1714/`.

## 1.59.1

### Patch Changes

- 65d7b99: Fix misleading `/merge` verbose logs that read as "no CI configured" when CI was actually
  running — addresses issue [#1712](https://github.com/link-assistant/hive-mind/issues/1712)
  where a user mistakenly Ctrl+C'd the auto-restart-until-mergeable watcher after seeing:

  ```
  [VERBOSE] /merge: PR #83 has no CI checks yet - treating as no_checks
  [VERBOSE] /merge: PR #83 has no CI check-runs yet, but 1 workflow run(s) were triggered ...
    ⏳ Waiting for CI:         Build and Release Docker Image
  ```

  The classification logic was correct — `/merge` was waiting on the legitimate 30-120s gap
  between GitHub registering a `workflow_run` and publishing the corresponding `check_runs`.
  The wording was the bug: "no CI checks yet" is parseable as "this repo has no CI", and the
  listing showed run IDs without URLs, so the user couldn't quickly verify what `/merge` was
  watching.

  Changes:
  - **`src/github-merge.lib.mjs`** — `getDetailedCIStatus` and `checkPRCIStatus` reword the
    `no_checks` verbose lines to "has no check-runs or commit statuses registered yet",
    including the short SHA. `getWorkflowRunsForSha` now appends `run.html_url` to every
    entry. Normalized check-run / commit-status entries carry an `html_url` field
    (falling back to `details_url` / `target_url`).
  - **`src/solve.auto-merge-helpers.lib.mjs::getMergeBlockers`** — the `no_checks`,
    `pending`, and `cancelled` branches now produce blocker `details` strings of the form
    `"<name> [<status>] — <html_url>"`. The user-facing `⏳ Waiting for CI: …` line in
    `solve.auto-merge.lib.mjs` (which joins `details` with commas) automatically picks up
    the URLs, so the user can click through to the run.
  - **`tests/test-misleading-merge-logs-1712.mjs`** — 13 unit tests covering the wording
    guard, blocker enrichment for the no_checks / pending / cancelled paths, regression
    guard for #1466, and the joined user-facing line format.
  - **`docs/case-studies/issue-1712/README.md`** — full case study with raw logs, timeline,
    root cause, fix description, and verification on the original PR
    [link-foundation/box#83](https://github.com/link-foundation/box/pull/83) (which CI
    passed for, after the user killed the watcher prematurely).

  Also extends the `useWithRetry` helper (originally added in #1710 to recover from corrupt
  hosted-CI npm-install state) with a third failure mode: `ERR_INVALID_PACKAGE_CONFIG` —
  seen in this branch's own CI run when Node refused to parse a truncated
  `getenv-v-latest/package.json`. `src/queue-config.lib.mjs` now loads `getenv` and
  `links-notation` through the retry wrapper, matching `config.lib.mjs` and `lino.lib.mjs`.
  Three new unit tests in `tests/test-use-with-retry.mjs` cover the new mode.

  No upstream issue is needed — the bug was entirely in `link-assistant/hive-mind`. The
  external workflow finished successfully (`check-runs-dfc4c14.json` shows `total_count: 22`).

  **Follow-up round** (after review feedback in
  [PR #1713 comment](https://github.com/link-assistant/hive-mind/pull/1713#issuecomment-4342387674)):
  - **List active runs across ALL PR commits, not just HEAD.** New
    `getActivePRWorkflowRuns()` in `src/github-merge-repo-actions.lib.mjs` walks every
    commit on the PR (`/repos/.../pulls/N/commits`), dedupes by `run.id`, returns groups
    marked `head` / `older`. The verbose log now lists active runs on older commits under
    per-commit URL headers, so the GitHub Actions tab (which shows yellow dots for older
    commits) reconciles with the log.
  - **Eliminate duplicate logging.** `getWorkflowRunsForSha(verbose=true)` already prints
    every run; the no_checks branch no longer re-iterates `workflowRuns`, just emits a
    single explanatory summary line.
  - **Commit URLs instead of short SHAs.** Verbose lines that referenced
    `${sha.substring(0, 7)}` now use `https://github.com/${owner}/${repo}/commit/${sha}`
    (or `/pull/N/commits/${sha}` where the PR context matters).
  - **Inline plain-English explanations.** New `STATUS_HINTS` / `CONCLUSION_HINTS`
    dictionaries plus `explainStatus()` helper — verbose lines read
    `[in_progress] (currently executing)` instead of bare `in_progress`.
  - **Multi-line user-facing waiting message.** The `⏳ Waiting for CI:` line is now
    rendered by `renderBlocker()` — single-line for the common case (one run), but each
    detail on its own indented line when there are multiple.
  - 8 new tests added to `tests/test-misleading-merge-logs-1712.mjs` (Groups 5–8); 21
    total. #1480 (31/31) and #1466 (14/14) regression suites still pass.

## 1.59.0

### Minor Changes

- 903b10e: Add `--auto-input-until-mergeable` (issue #1708): a new experimental
  mode that extends a single Claude session for as long as possible by
  streaming PR/issue comments, CI/CD failures, uncommitted-changes
  status, and PR/issue title/body updates as NDJSON `user` frames into
  the live `claude --input-format stream-json` process — instead of
  killing the process and restarting with the feedback prepended to a
  fresh prompt.

  What it ships:
  - Three new flags in `src/solve.config.lib.mjs`, all defaulting to
    `false` and marked `[EXPERIMENTAL]`:
    - `--auto-input-until-mergeable` — top-level opt-in for the new
      behavior. Implies `--accept-incomming-comments-as-input` and
      defaults to `--queue-comments-to-input` so the AI can finish its
      current step before being interrupted.
    - `--stream-comments-to-input` — forward each comment immediately
      as it arrives. Default for `--accept-incomming-comments-as-input`
      on its own (preserves the existing #817 behavior).
    - `--queue-comments-to-input` — buffer comments while the AI is
      busy and flush them only on `result` events. Default delivery
      mode for `--auto-input-until-mergeable`. Mutually exclusive with
      `--stream-comments-to-input`; queue mode wins if both are set.
  - Queue-vs-stream delivery wired into
    `src/bidirectional-interactive.lib.mjs#createBidirectionalHandler`:
    - New `deliveryMode` option (`'stream'` / `'queue'`) plus
      `markAiBusy()` / `markAiIdle()` lifecycle methods exposed on the
      handler.
    - In queue mode, comment frames and status frames are buffered in
      `pendingFrames` while busy and FIFO-flushed to stdin on the next
      `result` event. In stream mode, frames go to stdin immediately as
      today.
  - Status streaming (only when `--auto-input-until-mergeable` is on)
    in `src/bidirectional-interactive.lib.mjs#checkForStatusChanges`:
    - New parallel poller emits one-shot NDJSON frames for: PR
      title/body changes, issue title/body changes (Issue #1708 G1),
      uncommitted local changes (`git status --porcelain`), and CI
      blockers (via `getMergeBlockers`).
    - Each change is keyed by a stable signature so the same failing
      check doesn't re-emit on every poll; failures in any sub-check
      are swallowed and logged so the poller never breaks the live
      Claude session.
  - Stream parser in `src/claude.lib.mjs#executeClaudeCommand` now
    signals `markAiBusy()` on `assistant` / `tool_use` / `tool_result`
    events and `markAiIdle()` on `result` events, so queue-mode
    buffering tracks the actual AI lifecycle.
  - `src/solve.auto-merge.lib.mjs#watchUntilMergeable` logs a
    "streaming-first" banner when `--auto-input-until-mergeable` was
    active, so it is clear the auto-restart loop is the fallback rather
    than the primary handler.
  - For non-Claude tools, the validator continues to warn and disable
    all four flags — the existing #817 fallback path. The default
    behavior of every existing flag
    (`--auto-restart-until-mergeable`, `--auto-merge`, etc.) is
    preserved (R4: "must not break any existing features").
  - Tests:
    `tests/test-auto-input-until-mergeable-1708.mjs` (59 assertions)
    and 11 new assertions in
    `tests/test-bidirectional-interactive.mjs` cover flag composition,
    queue-vs-stream routing, FIFO flushing on idle, busy-flag
    preservation across stream-mode writes, default-deliveryMode is
    stream, status-frame stamping with the right header per kind
    (`comment` / `ci` / `uncommitted` / `metadata`), and metadata
    diff/snapshot helpers.

  The case study at `docs/case-studies/issue-1708/` is updated to
  reflect that R1, R2 (Claude path), R3 (PR/issue title+body, CI,
  uncommitted, comments), R4, R5, R6, plus G1, G5, G7 are addressed
  here. Codex/Agent/OpenCode still degrade gracefully (no mid-session
  NDJSON channel upstream) and use the existing `watchUntilMergeable`
  loop as documented in G4.

- 6efcab4: Fix cost / token calculation correctness, unify Total / sub-session format,
  add verbose budget trace, and case study for issue #1710

  Resolves the four "strange things" the issue reported by changing both the
  public-pricing math and the rendered output:
  - **R1 — `$0.040000` residual eliminated.** `calculateModelCost`
    ([`src/claude.lib.mjs`](./src/claude.lib.mjs)) now bills Anthropic
    server-side tools. `web_search` is charged at the documented
    $10 / 1 000 requests rate (= $0.01 / req) via the new constants module
    [`src/anthropic-server-tool-pricing.lib.mjs`](./src/anthropic-server-tool-pricing.lib.mjs).
    For the issue's PR #1707 run that comes out to exactly the previously-shown
    $0.040000 / +0.16% delta, so the public-pricing total now reconciles with
    Anthropic's reported `total_cost_usd`. `accumulateModelUsage`
    ([`src/claude.budget-stats.lib.mjs`](./src/claude.budget-stats.lib.mjs))
    also picks up `usage.server_tool_use.web_search_requests` from JSONL.
  - **R2 — Haiku sub-session line includes input information.** Sub-agent
    models never appear as the responding model in the parent JSONL, so
    `peakContextUsage` stays at `0`. The fallback in `buildBudgetStatsString`
    now emits the cumulative `(X new + Y cache writes [+ Z cache reads])`
    phrase instead of dropping the input information entirely.
  - **R3/R5 — Sub-session and Total reconcile.** The bullet line is now
    labelled `peak request: …` so it cannot be confused with the cumulative
    Total line. `requestContext` (the source of `peakContextByModel`) excludes
    cache reads, so the bullet figure is `input + cache_creation` and is
    reconcilable with the cumulative non-cached total. Cache reads remain
    visible — and visible separately — on the Total line.
  - **R4 — Total always splits cache reads / cache writes when present.**
    The conditional that previously keyed on `cacheReadTokens` only is replaced
    with a `buildCumulativeInputPhrase` helper that emits
    `(X new + W cache writes + Y cache reads) input tokens` when both kinds of
    cache activity exist, `(X new + W cache writes)` when only writes exist
    (the Haiku case that triggered the issue), and the back-compat
    `(X + Y cached)` form when only reads exist (so common Opus-only output
    is unchanged). Cache writes are billed at 1.25× / 2× of input — fusing
    them silently into the input figure was a real semantic bug, not a
    cosmetic one.

  Both `displayBudgetStats` (solver-log renderer) and `buildBudgetStatsString`
  (PR-comment renderer) share the helper, so the two paths render identically.

  Also adds **`dumpBudgetTrace`**
  ([`src/claude.budget-stats.lib.mjs`](./src/claude.budget-stats.lib.mjs)),
  a verbose-only structured per-model trace (peak request, cumulative
  input/cache_write 5m+1h split/cache_read/output, server-tool counts with
  implied dollar cost, public and Anthropic-reported costs, and the data
  source) that fires from `displayBudgetStats` only when `{verbose: true}` is
  set, so the default solver output is unchanged. The trace captures all the
  inputs that drive the renderer in one place, so the next "calculation
  correctness" report can be triaged from a saved log alone.

  Tests:
  - `tests/test-issue-1710-budget-trace.mjs` — 10 cases for the verbose trace.
  - `tests/test-issue-1710-format-fixes.mjs` — 8 cases locking each requirement
    to numbers from `docs/case-studies/issue-1710/facts.md` (the actual
    PR #1707 result event the issue quotes).

  Documentation: `docs/case-studies/issue-1710/` contains the root-cause
  analysis (per symptom, with file:line citations), the captured facts, and
  the (now-implemented) solution plans.

  Also fixes the hosted-CI flake that surfaced while validating this PR:
  `use-m` occasionally hands back a truncated/corrupt global package after
  `npm install -g`, surfacing as either
  `Failed to import module from '...': SyntaxError: Unexpected end of input`
  or `Failed to resolve the path to '<pkg>'` when use-m loads `getenv` /
  `links-notation` from `src/config.lib.mjs` and `src/lino.lib.mjs`. Adds
  `src/use-with-retry.lib.mjs`, a small wrapper around `use(...)` that
  recognises both flake modes, removes the broken alias directory, and
  re-fetches once. Covered by `tests/test-use-with-retry.mjs` (13 cases).

## 1.58.0

### Minor Changes

- 3616130: Add `--sub-session-size` and `--disable-1m-context` options for Claude and Codex (issue #1706)

  `--sub-session-size` (default: `150k`) caps the size of each sub-session
  between auto-compaction events. It accepts a token count (`150k`, `1m`,
  `200000`), a percentage of the model context window (`50%`), or `default`
  to keep the tool's built-in threshold.

  `--disable-1m-context` (default: `true`) opts out of the 1M extended
  context window so models stay on their standard 200K-400K window. This
  preserves reasoning quality and avoids the long-context price tier.
  Use `--no-disable-1m-context` to allow 1M.

  Both options work for `--tool claude` and `--tool codex`. For Claude Code
  the wrapper sets `CLAUDE_CODE_DISABLE_1M_CONTEXT`,
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
  env vars (clamped per upstream's "lower-only" semantics). For Codex the
  wrapper appends `-c model_context_window=200000` and
  `-c model_auto_compact_token_limit=<tokens>` overrides.

  Verbose mode logs the applied env vars and `-c` overrides so operators
  can confirm they reached the spawned tool process.

- b341775: Hide the cost-estimation breakdown when the public and Anthropic numbers agree to within display precision (issue #1703)

  Both the live `displayCostComparison` console output and the
  `buildCostInfoString` markdown rendered into PR/issue comments previously
  collapsed to the short `💰 Cost: $X.XXXXXX` form only when the two values
  matched **exactly** at six decimal places. Real-world calls regularly produce
  underlying values that differ by ~`1e-7` and round to **adjacent** displays
  (e.g. `$11.219694` vs `$11.219693`); the rendered difference (`$-0.000000
(-0.00%)`) was therefore noise yet still printed three full lines. The guard
  now triggers whenever `|public − anthropic|.toFixed(6) === '0.000000'`, which
  preserves the existing behaviour at every meaningful (≥ `$0.000001`) delta and
  adds short-form output for the boundary case from issue #1703. Regression
  tests live in `tests/test-build-cost-info-string.mjs` and
  `tests/test-display-cost-comparison.mjs`.

## 1.57.3

### Patch Changes

- 5c65c29: Fix /log and /terminal_watch falsely rejecting real `$` isolation sessions (issue #1700)

  `parseSessionStatusOutput` looked for the isolation backend at `data.isolation`
  or `data.options.isolation`, but the published `link-foundation/start` 0.25.x
  CLI reports it at `options.isolated` in both JSON and the default
  `links-notation` output. As a result, replying `/log` (or `/terminal_watch`) to
  a `Work session finished` message rejected every screen / tmux / docker session
  with `❌ This command currently supports only sessions launched with $
isolation`. The parser now reads `options.isolated` first and keeps the legacy
  field names as fallbacks. The rejection site additionally emits a `[VERBOSE]`
  diagnostic line so future contract drifts can be triaged from a single bot log
  entry. Regression test in `tests/test-issue-1700-isolation-parsing.mjs`.

## 1.57.2

### Patch Changes

- aff6d1d: Add a stable test runner and suite markers to avoid package.json test-script conflicts.

## 1.57.1

### Patch Changes

- e4ece4d: Treat Codex app-server stream-lag item errors as non-fatal warnings when the turn otherwise completes successfully, preventing successful Codex runs from being reported as failed solution drafts.

## 1.57.0

### Minor Changes

- 272a2d4: Add live terminal watch support for hive-telegram-bot

  This feature adds `/terminal_watch` plus the experimental `--auto-start-screen-watch-message` option. The command watches the log reported by `$ --status <uuid>` and updates a separate Telegram message with a terminal-sized text snapshot.

  Key features:
  - Manual `/terminal_watch <uuid>` command, including reply-based usage
  - Configurable terminal snapshot size with `--size`, `--width`, and `--height`
  - Auto-freezes the watch message and attaches the full log when the session ends
  - Public repository logs can update in chat; private/unknown visibility uses DM for manual watches
  - Auto-start remains off by default and never starts for private or unknown-visibility repositories

  Based on the proof-of-concept from konard/telegram-terminal-bot.

## 1.56.19

### Patch Changes

- 0da8eba: Add a `/log` Telegram command that lets a chat owner pull the on-disk log of a `$` isolation session (`screen`, `tmux`, `docker`). The command accepts `/log <UUID>` directly or `/log` as a reply to any session message that contains a session UUID, validates the id with `$ --status`, derives the log path from start-command's `logPath` field, and uploads the file as a reply to the user. Logs from public GitHub repositories are uploaded to the same chat; logs from private (or unknown-visibility) repositories are sent via direct message after forwarding the originating session message into the DM, so private logs never leak into public chats. Access is restricted to the chat owner (Telegram `creator` status), matching the existing `/start`, `/stop`, and `/top` policy.

## 1.56.18

### Patch Changes

- 47810ae: Telegram bot: add experimental `/subscribe` + `/unsubscribe` commands so users can opt in to receive a private DM forward of the `/solve` work-session completion message (commands work in both private and group chats; subscriptions are kept in memory and reset on bot restart). The completion message now includes both an `Issue:` line (the original URL passed to `/solve`) and, when the agent created a pull request for that issue, a follow-up `Pull request:` line so reviewers see both links without leaving the chat. (#1688)

## 1.56.17

### Patch Changes

- b693172: Improve the repository-not-accessible error message in `/solve` (issue #1692). The headline drops the redundant "not found or" wording and the technical "(GitHub returns 404 for private repos without permissions)" parenthetical, leads with the most-actionable hypothesis ("Repository may be private — ensure the bot has been granted access"), and only suggests `--auto-accept-invite` when that flag is _not_ already active. The Telegram bot surface picks up the same suppression so users do not see the hint echoed back when they already passed the flag.

## 1.56.16

### Patch Changes

- 2e2d9e6: Fix `/merge` and `--auto-restart-until-mergeable` getting stuck forever waiting for check-runs that never arrive when a target repo's GitHub Actions workflow file is invalid (e.g. YAML syntax error or `Unrecognized named-value` expression error). GitHub creates a `status=completed, conclusion=failure` workflow run with zero jobs and zero check-runs in this case; the new `getWorkflowRunJobsCount` helper detects the zero-jobs signal and surfaces the broken workflow as a `ci_failure` blocker so the auto-restart loop fires and the AI solver receives the actionable error (workflow file path + run URL) instead of looping silently. See `docs/case-studies/issue-1690/`.
- a0a25de: Make four stabilized options enabled by default (issue #1694): `--auto-accept-invite`, `--tokens-budget-stats`, and `--auto-attach-solution-summary` now default to `true` for `solve` and `hive` (use `--no-…` to disable), and the `hive-telegram-bot`'s `--isolation` defaults to `screen` (set `TELEGRAM_ISOLATION=` or pass `--isolation ''` to disable). The Telegram `/solve` auto-accept-invite pre-check now reads the parsed `argv` so the new default fires without an explicit `--auto-accept-invite` and `--no-auto-accept-invite` works as a real opt-out.

## 1.56.15

### Patch Changes

- cdd8010: Refine the Telegram bot work-session messages: introduce `🔄 Starting...` and `⏳ Executing...` to distinguish launch from execution, change the completion headline to `✅ Work session finished successfully` / `❌ Work session failed (exit code: N)`, show duration before session, and preserve the audit infoBlock (`Requested by`, `URL`, `🛠 Options`, `🔒 Locked options`) on every state — including completion and failure paths — so admins keep a record even when users delete their original `/solve` message.

## 1.56.14

### Patch Changes

- 77d6be2: Prevent failure-log uploads from posting broken `null` links and replace green-check failure-log terminal status with neutral attachment wording.

## 1.56.13

### Patch Changes

- ca1ac93: Start Telegram work-session monitoring before Telegraf long polling can block startup code, and keep completed screen-isolated sessions in memory until their completion message is updated.

## 1.56.12

### Patch Changes

- 71e1ef5: Prevent `--attach-logs` from posting truncated fallback comments when full `gh-upload-log` uploads fail, and parse newer `gh-upload-log` repository output including shared-repository paths.

## 1.56.11

### Patch Changes

- 0c00b7b: Retry Codex stream disconnects by resuming the preserved exec session.

## 1.56.10

### Patch Changes

- e2f9a37: Fix duplicated yargs choice values in Telegram validation errors.

## 1.56.9

### Patch Changes

- 94448c3: Fix screen-isolated work-session Telegram updates so executing messages stay compact and completion messages use `$ --status` start/end timestamps and exit codes.

## 1.56.8

### Patch Changes

- 05a3e42: Fix CI/CD change detection for pull request synchronize events so metadata-only updates skip expensive test jobs while still reporting completed checks.
- c12f99d: Fix screen-isolated solve monitoring so completed `$ --status` sessions no longer block duplicate commands, queued status displays executing isolation sessions, and Telegram start messages stay in an executing state until completion.

## 1.56.7

### Patch Changes

- 37c895c: Retry capacity-related tool failures with exponential backoff and support fallback models for Codex, Claude, OpenCode, and Agent resumes.
- 16f341d: Limit automatic restart/resume loops to five iterations by default and avoid pre-restart branch sync when local merge state must be resolved by the AI session.

## 1.56.6

### Patch Changes

- e4037e1: Support Telegram solve and hive commands when options are placed before the GitHub URL.

## 1.56.5

### Patch Changes

- 0447110: Treat structured Codex error events as failed tool executions even when the Codex process exits with code 0.

## 1.56.4

### Patch Changes

- 2d6d405: Fix Telegram bot LINO configuration parsing for parenthesized option/value links such as `(--isolation screen)`.

## 1.56.3

### Patch Changes

- 86da037: Support `gpt-5.5` for the Codex tool, prefer it as the default model, accept forward-compatible `gpt-5.5-mini` and `gpt-5.5-nano` aliases, and document per-tool model and reasoning defaults.

## 1.56.2

### Patch Changes

- d39f08f: fix(hive-screens): make `--list` default to `--all`, print log/issue after `--enter` exits, and actually close sessions on `--close`

  Addresses issue #1654:
  - `hive-screens --list` now defaults to `--all` so a bare `--list` lists every
    match, matching user expectations. `--enter` and `--close` keep `--oldest` as
    their default because they are destructive.
  - `hive-screens --enter` now prints `Log:` and `Issue:` lines **after** the
    user detaches from the screen session, so the information is not wiped by
    `screen -r` swapping to the alternate buffer.
  - `hive-screens --close` now spawns `screen -X stuff exit\n` directly (with
    the newline as a literal argv element) instead of shelling out with bash
    ANSI-C quoting (`$'exit\n'`). The legacy form relied on `/bin/sh` being
    bash, but on Debian/Ubuntu it is `dash`, which does not understand
    `$'...'` — so the previous command sent the literal string `$exit\n` into
    each session and never actually closed it.
  - Adds a `--verbose` / `-v` flag that prints scanning diagnostics to stderr.

## 1.56.1

### Patch Changes

- 32035a2: Issue #1651: When fork-parent auto-recovery tries to delete the mismatched
  fork and the GitHub CLI token is missing the `delete_repo` scope, `solve`
  now prints the real remediation (`gh auth refresh -h github.com -s delete_repo`)
  plus a non-destructive alternative (rename/archive + `--prefix-fork-name-with-owner-name`)
  instead of re-recommending the same `gh repo delete` command that just failed.
  In `--verbose` mode the full `gh` output is also printed so future root-cause
  analyses have the diagnostic lines GitHub already provides.

  Pre-PR failures that are posted back to GitHub issues now use user-facing
  guidance: they ask the issue reporter to fix repository/account state when
  possible or ask a Hive Mind administrator to handle the affected repository,
  while keeping administrator CLI details in the terminal log instead of the
  public issue comment.

## 1.56.0

### Minor Changes

- 391dbde: Add `hive-screens` bin command. Converts the `hive-screens.sh` script that was
  embedded in README.md into a real JavaScript command shipped with the package.
  Supports `--list` (safe preview), `--enter` (attach), and `--close` (terminate)
  across detached GNU screen sessions that completed a mergeable solve run.
  `--list`, `--enter`, and `--close` share the same matching predicate, so any
  session visible under `--list` is guaranteed to be actionable by the other
  flags. Selection flags `--oldest` (default), `--newest`, and `--all` are
  preserved from the legacy script. Closes #1649.

## 1.55.0

### Minor Changes

- d696423: Add experimental bidirectional interactive mode (issue #817). Introduces three composable opt-in flags for `solve` (auto-forwarded to `hive`): `--accept-incomming-comments-as-input` (feed new PR/issue comments into Claude as stream-json input, excluding solve's own system comments), `--exclude-all-own-incomming-comments-from-input` (also skip comments authored by the same GitHub user that solve runs as), and `--bidirectional-interactive-mode` (composite convenience flag that enables `--interactive-mode` plus the two flags above). All flags default off and only take effect with `--tool claude`.

## 1.54.8

### Patch Changes

- 12f5761: Fix `--auto-restart-until-mergeable` readiness comment deduplication for pull requests with more than one page of comments, and enforce pagination on list-returning `gh api` calls.

## 1.54.7

### Patch Changes

- 06b1a41: Fix `--auto-attach-solution-summary` so the AI-comment scan starts at the current work session instead of the older feedback reference time.

## 1.54.6

### Patch Changes

- 2c15727: Migrate Docker images and deployment paths from `konard/sandbox` to the current
  full `konard/box` base image with the `box` user and `/home/box` home directory.

## 1.54.5

### Patch Changes

- ea79845: Disable noisy Claude Code features for solve runs via merged user settings, subprocess environment variables, and Docker image defaults. Expands the quiet config to also disable fast mode, feedback surveys, mouse tracking, away summaries, Claude attribution (commit/pr), co-authored-by trailer, thinking summaries, and UI animations, sets viewMode to verbose, and caps tool-use concurrency at 4 for deterministic autonomous runs. Keeps Claude's built-in git/PR instructions on (`includeGitInstructions: true`), enables task tracking (`CLAUDE_CODE_ENABLE_TASKS=1`) and turn resume (`CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`), and makes the bypass-permissions mode audible via `permissions.defaultMode: "bypassPermissions"` + `skipDangerousModePermissionPrompt: true` (complementing the existing `--dangerously-skip-permissions` CLI flag). Adds a reusable `configure-claude` bin with an apply default and a `--verify` check-only mode so users and system administrators can reset or audit Claude Code configuration manually after installing `@link-assistant/hive-mind`. Docker release builds now wait for the npm package version to become available, pass that exact version into Docker as `HIVE_MIND_VERSION`, install `@link-assistant/hive-mind@${HIVE_MIND_VERSION}`, and invoke the published `configure-claude` bin directly instead of copying repo source files into the Docker build.

## 1.54.4

### Patch Changes

- 2ac0a14: Notify the source issue when solve exits with a known issue but no pull request, including failure logs when `--attach-logs` is enabled.

## 1.54.3

### Patch Changes

- 5030b04: Fix Codex pricing display by calculating OpenAI public estimates from models.dev token rates, passing Codex totals into shared budget stats, and avoiding duplicate raw token usage lines when a Total line is already shown.

## 1.54.2

### Patch Changes

- 9d4e473: Cap `/limits` CPU cores display at available CPU count when load average demand exceeds capacity.
- ea0b9f5: Use Anthropic's native Claude Code installer in Docker images so the CLI binary is installed even when Bun blocks dependency postinstall scripts.

## 1.54.1

### Patch Changes

- 5f70953: fix(solve): post tool-generated PR comments again after v1.53.1 regression

  `postTrackedComment()` in `src/tool-comments.lib.mjs` (added in #1626) was
  passing the comment body to `gh api --input -` via `$({ input: payload })`,
  but command-stream's option is `stdin`, not `input`. The misnamed key was
  silently ignored, so `gh` read from the parent's stdin, sent an empty POST
  body, and GitHub's edge returned `HTTP 400 "Whoa there!"`. Every tool-posted
  comment — `AI Work Session Started`, log-upload link, `Ready to merge`,
  `Auto-merged`, billing-limit notice, usage-limit notice — failed from this
  one call path starting with v1.53.1.

  Fix: use the documented `stdin` option so the JSON payload actually reaches
  the child's stdin. The regression test pins the option name so a future
  rename can't silently recur.

  Fixes #1631.

## 1.54.0

### Minor Changes

- ee156ba: Disable Claude Code built-in tools and MCP servers that have no value in autonomous headless runs. A new `--useless-tools-disabled` flag (default: `true`, use `--no-useless-tools-disabled` to opt out) adds `AskUserQuestion`, `CronCreate/Delete/List`, `EnterPlanMode/ExitPlanMode`, `EnterWorktree/ExitWorktree`, `Monitor`, `NotebookEdit`, `PushNotification`, `RemoteTrigger`, `ScheduleWakeup` and the three `claude.ai` OAuth MCP connectors (Gmail, Google Drive, Google Calendar) to `--disallowedTools` / `--strict-mcp-config` on each `solve` run. The Docker images (`Dockerfile`, `coolify/Dockerfile`) also bake the same `disallowedTools` list into the baseline `~/.claude/settings.json` so interactive `claude` sessions inside the image don't surface them either (issue #1627).

## 1.53.1

### Patch Changes

- c0e8c6d: Fix `--auto-attach-solution-summary` falsely detecting solve.mjs's own session bookkeeping comments ("AI Work Session Started", "Solution Draft Log", "Auto-restart", "Ready to merge", etc.) as AI-authored comments, which caused the solution summary to always be suppressed even when the AI session produced no comments of its own.

  The fix introduces a new `src/tool-comments.lib.mjs` module as the single source of truth for every marker string embedded in tool-posted comments, along with in-memory tracking of the GitHub comment IDs that solve.mjs itself creates during a session. `checkForAiCreatedComments` now uses the tracked ID set as the primary filter — any comment the tool posted in this session is excluded regardless of body text — and falls back to marker-based substring matching only when an ID was not captured.

  Every tool-posting site (`solve.session.lib.mjs`, `solve.auto-merge.lib.mjs`, `solve.watch.lib.mjs`, `github.lib.mjs`'s `attachLogToGitHub`/`attachTruncatedLog`/`attachRegularComment`, `claude.lib.mjs`'s force-kill notice, `interactive-mode.lib.mjs`, `solve.progress-monitoring.lib.mjs`, `solve.repo-setup.lib.mjs`, `solve.repository.lib.mjs`, and `solve.mjs`'s usage-limit notifications) now routes through `postTrackedComment` / `postTrackedCommentFromFile`, so every solve-posted comment is registered and filtered correctly across all supported AI tools (claude, codex, agent, opencode). See issue #1625.

## 1.53.0

### Minor Changes

- 906f61e: Add Playwright MCP browser automation fallback hints to all tools (opencode, agent), WebSearch fallback guidance to all tools (claude, codex, opencode, agent), and --no-playwright-mcp flag to physically disable Playwright MCP server connection per session without affecting global registration.

## 1.52.1

### Patch Changes

- d5d3762: Fix calculation bugs and format unification for budget stats using decimal.js-light for precision.

## 1.52.0

### Minor Changes

- 5b24866: Add Claude Opus 4.7 model support with adaptive thinking, model-correct xhigh/max effort mapping, Opus 4.5/Mythos effort detection, and the --show-thinking-content option.

## 1.51.0

### Minor Changes

- fd3c76c: Add per-tool Telegram solve aliases: /claude, /codex, /opencode, and /agent.

## 1.50.15

### Patch Changes

- 7cecf09: Fix auto-resume reset time parsing when usage-limit output includes a month/day prefix such as `Apr 17, 4:00 AM`.

## 1.50.14

### Patch Changes

- f013f53: Fix PR mergeability consensus to ignore unrelated repo actions by default

## 1.50.13

### Patch Changes

- 3eb1428: Preserve GitHub issue-closing links after temporary auto-restart sessions edit pull request descriptions.

## 1.50.12

### Patch Changes

- 065deae: ## Summary

  Fix Playwright MCP setup guidance and verification for Codex environments.

## 1.50.11

### Patch Changes

- bf9cf54: Fix prompt template builders crashing when literal `.png` appears in screenshot guidance.

## 1.50.10

### Patch Changes

- 0dc1613: Fix log upload raw URL resolution so gist metadata lookups do not mirror full gist contents to stdout, and harden stdio handling when the terminal pipe is already broken.

## 1.50.9

### Patch Changes

- cfe4e36: Improve Codex support across solve, limits, queue, version reporting, and Playwright MCP integration.

## 1.50.8

### Patch Changes

- 5760755: fix: default to PR-branch-only CI check, add pagination and typo fix (#1573)
  - Fix typo: `--wait-for-all-actions-in-repository-before-mergable` → `--wait-for-all-actions-in-repository-before-mergeable` (deprecated alias kept for backward compatibility)
  - When repo-wide flag is enabled, block on ALL active runs regardless of branch (no branch filtering) to ensure safety when CI/CD pipelines interact
  - Add `--paginate` to `getPRCommitShas()` to load all PR commits (not just first page)
  - Add all-commits CI check: verify CI completes for every commit on the PR branch, not just HEAD
  - Add `getPRCommitShas()` and `checkAllPRCommitsCI()` for per-commit CI verification

## 1.50.7

### Patch Changes

- 84b9853: fix: make all long sleeps interruptible so CTRL+C responds immediately (#1574)
  - Replace raw `setTimeout` sleeps with an interruptible sleep utility that listens for SIGINT
  - Ensure CTRL+C during CI polling, auto-merge waits, and auto-continue delays terminates the process immediately
  - Add `interruptible-sleep.lib.mjs` with full test coverage

## 1.50.6

### Patch Changes

- 854a74b: feat: track sub-agent calls and show per-call stats in budget display (#1590)
  - Split budget usage statistics per sub-agent call when working sessions contain multiple sub-agent invocations
  - Extract and display individual sub-agent call metrics from Claude API session data
  - Add budget stats library for parsing and formatting per-call usage information

## 1.50.5

### Patch Changes

- 61b2a32: fix: prevent solution draft log and ready to merge comments from appearing between limit reached and auto resume (#1571)
  - `autoContinueWhenLimitResets()` now awaits child process exit instead of returning immediately after spawn
  - Added defense-in-depth guard in solve.mjs to skip post-processing when limit was reached with auto-continue enabled
  - This ensures the correct comment ordering: Limit Reached → Auto Resume → Solution Draft Log → Ready to merge

## 1.50.4

### Patch Changes

- 15f25db: Make merge queue cancel immediate during CI waits so users don't have to wait for CI to finish before cancellation takes effect

## 1.50.3

### Patch Changes

- dce8218: fix: extract helper functions from solve.auto-merge.lib.mjs to fix 1500-line limit violation (#1593)
  - Extract `checkForExistingComment`, `checkForNonBotComments`, and `getMergeBlockers` into new `solve.auto-merge-helpers.lib.mjs`
  - Add warning threshold (1350 lines) to `check-file-line-limits.sh` to flag files approaching the 1500-line limit
  - Add case study documenting the concurrent PR merge race condition root cause

- 89ad776: fix: add timeout-based expiry for non-isolation active sessions to prevent false positives (#1586)
  - Non-isolation (plain `start-screen`) sessions are now tracked with a 10-minute timeout
  - Within the timeout window, duplicate `/solve` commands for the same URL are blocked (prevents accidental re-runs)
  - After 10 minutes, non-isolation sessions auto-expire, preventing permanent false positives
  - Isolation-backed sessions (`--isolation screen|tmux|docker`) have no timeout — their completion is reliably detected
  - This prevents the bot from indefinitely blocking `/solve` commands with "A working session is already running for this URL"

- 3bf9501: fix: narrow "Ready to merge" duplicate check to current session scope (#1584)
  - Fix `checkForExistingComment` to only search for duplicate "Ready to merge" comments AFTER the last "Solution Draft Log" comment, not in the entire PR history
  - Previously, a "Ready to merge" from a previous working session would suppress the notification for a new session after user feedback
  - The fix scopes deduplication to the current working session while maintaining cross-process duplicate detection

## 1.50.2

### Patch Changes

- f09dead: fix: always post GitHub comment when usage limit is reached in auto-restart mode (#1570)
  - Fix silent waiting behavior in watchUntilMergeable() when usage limit is reached
  - Previously the system would silently wait 40+ minutes without any user notification
  - Now posts a GitHub comment to the PR using attachLogToGitHub() with usage limit details
  - Comment includes reset time, session ID, and indicates auto-restart will resume automatically
  - Log output now also shows the calculated resume time in UTC

## 1.50.1

### Patch Changes

- 494989e: Add paths filter to CI/CD workflow trigger to skip unnecessary runs for non-code file changes (#1582)
- c4fadea: fix: prevent push failures in auto-restart and cleanup by syncing with remote (#1572)
  - Add `git pull` before restart sessions and cleanup push to prevent stale local state
  - Add `2>&1` to all `git push` commands so stderr is captured for proper error handling
  - Fix multi-line log message formatting to include timestamps on each line

## 1.50.0

### Minor Changes

- 4aed1c1: fix: interactive mode GitHub comments display improvements (#1576)
  - Fix agent task comments stuck at "⏳ Running..." by propagating taskId through comment queue
  - Fix misleading token counts by preferring modelUsage (cumulative per-model) over usage (last-iteration)
  - Change truncation format from "[N lines truncated]" to "[X-Y lines are omitted]" showing actual line range
  - Rename "Session Complete" to "Interactive session completed"
  - Rename Write tool "Content" to "Change", expand by default, add line numbers to diffs
  - Show checked/total count in TodoWrite: "Todos (2/9 items)" instead of "Todos (9 items)"
  - Make Task prompt and Edit Change sections expanded by default
  - Add ToolSearch-specific display with Query/Max Results fields
  - Mark sub-agent tasks with 🤖🔀 emoji and Agent ID field
  - Add queue flushing before waiting for comment IDs in task progress/notification handlers

## 1.49.3

### Patch Changes

- b15a494: fix: make usage limit footer message consistent with auto-resume mode (#1569)
  - Fix footer message in "Usage Limit Reached" GitHub comments to reflect auto-resume/auto-restart mode
  - Previously the footer always showed "You can resume once the limit resets." even when auto-resume was enabled
  - Now shows mode-specific messages: "The session will automatically resume when the limit resets." or "The session will automatically restart when the limit resets."

## 1.49.2

### Patch Changes

- 026c95c: fix: non-consistent auto-restart logic on comments (#1567)
  - Reduce CI check interval from 5 minutes to 2 minutes for faster response times
  - Prevent concurrent sessions on the same PR/issue via active session URL checking
  - Add cross-process deduplication for "Ready to merge" comments
  - Add initial 2-minute cooldown before first mergeable check to ensure proper ordering

## 1.49.1

### Patch Changes

- 00512d6: Fix broken screenshot URL in fork mode: use forked repo path instead of original repo path in screenshot URL template when operating in fork mode (#1561).

## 1.49.0

### Minor Changes

- 9a904ae: feat: replace deprecated qwen3.6-plus-free default with nemotron-3-super-free for --tool agent (#1563)
  - Change default agent model from `qwen3.6-plus-free` to `nemotron-3-super-free` (~262K context, NVIDIA hybrid Mamba-Transformer)
  - Move `qwen3.6-plus-free` to deprecated (free promotion ended April 2026, now requires OpenCode Go subscription)
  - Update documentation, tests, and model priority lists
  - Syncs with upstream agent PR #243

## 1.48.3

### Patch Changes

- 2ac7f3c: Fix CI/CD lint failure caused by code duplication exceeding jscpd threshold (11.03% > 11%). Refactored test files to use shared `test-helpers.mjs` instead of duplicating assert/summary boilerplate, reducing duplication to 10.93%.
- 0b06bda: Fix `--isolation screen` session monitoring bug where sessions were prematurely detected as completed (Issue #1545). Add `screen -ls` fallback for screen-backend sessions to work around start-command UUID mismatch issues (link-foundation/start#101).
- 94eeaac: Immediately reject queued tasks when disk space (or any reject-strategy threshold) is exceeded, instead of leaving them in a waiting state indefinitely
- f955f0b: Add GitHub entity existence validation to /solve command to fail immediately on non-existent issues, PRs, repos, or users

## 1.48.2

### Patch Changes

- 7c3a8c1: Fix agent queue not isolated from claude queue in bot entry point. The start decision and position display now use tool-specific queue counts instead of the total across all tools, so items in one tool's queue don't block or mislead the other.

## 1.48.1

### Patch Changes

- 6d385ab: Simplified cost display when public and Anthropic costs match, removed USD suffix from Anthropic cost line
- Validate GitHub entity existence (user/org, repository, issue/PR) before executing /solve command. The telegram bot and solve CLI now fail immediately with helpful error messages when targeting non-existent entities, preventing wasted resources and providing faster feedback.

## 1.48.0

### Minor Changes

- 28f7ace: Add /do and /continue as alias commands for /solve in telegram bot

## 1.47.2

### Patch Changes

- 7afe67b: Fix ghPrView false positive on "Could not resolve" in PR body causing "Failed to get PR details" error on fork PRs, and add stdio log interceptor for terminal/log output parity

## 1.47.1

### Patch Changes

- 3bbd66e: Improve Context and tokens usage output format: move percentage before unit label, parenthesize cached tokens in Total line, use consistent X / Y (Z%) format for output tokens when limit is known, and show sub-sessions under model heading instead of globally

## 1.47.0

### Minor Changes

- 7997308: feat: update free models for --tool agent, set qwen3.6-plus-free as default (#1543)
  - Change default agent model from `minimax-m2.5-free` to `qwen3.6-plus-free` (~1M context window)
  - Add `qwen3.6-plus-free` (Alibaba Qwen, ~1M context) to free models
  - Add `nemotron-3-super-free` (NVIDIA hybrid Mamba-Transformer, ~262K context) to free models
  - Update documentation, tests, and provider priority lists
  - Syncs with upstream agent PR #234

## 1.46.9

### Patch Changes

- 8104fad: Fix wrong context window calculation showing impossible percentages like 250% (Issue #1539). When peakContextUsage is unknown (e.g. sub-agent models from result JSON only), skip the context window input tokens display entirely instead of falling back to cumulative totals across all requests, which are not valid per-request context window metrics.

## 1.46.8

### Patch Changes

- Fix wrong context window calculation showing impossible percentages like 250% (Issue #1539). When peakContextUsage is unknown (e.g. sub-agent models from result JSON only), skip the context window input tokens display entirely instead of falling back to cumulative totals across all requests, which are not valid per-request context window metrics.
- bcf2b9b: Retry on network issues and minimize terminal/log output differences (#1536): add ghRetry/ghCmdRetry utilities with exponential backoff for transient network errors (TCP reset, TLS timeout, connection refused, unexpected EOF). Apply retry to critical gh CLI calls: accept-invite, repository setup, auto-fork permission check, visibility detection, write permission check. Log stderr to log file on command failure for terminal/log parity. Add 'unexpected eof' to transient error detection patterns.

## 1.46.7

### Patch Changes

- 249cf93: Fix --isolation option not working in /solve and /hive Telegram commands (#1534): extract --isolation from user args before validation, so it's used for execution isolation (via $ CLI from start-command) instead of being forwarded to solve/hive as an unknown argument. Per-command --isolation takes precedence over bot-level ISOLATION_BACKEND setting.

## 1.46.6

### Patch Changes

- 6ab718a: Fix --interactive-mode completely broken (#1532): replace promisify(execFile) with spawn-based execFileAsync that correctly pipes stdin to child processes. The Node.js promisify(execFile) silently ignores the `input` option, causing `gh api --input -` to hang forever waiting for stdin data that never arrives, which blocks the entire stream processing loop.

## 1.46.5

### Patch Changes

- c900fb8: Usage stats improvements for Agent CLI and Claude Code CLI (Issue #1526)
  - Fix context window 288% bug by skipping display when peakContextUsage is 0
  - Add Agent CLI "Context and tokens usage" section with model/context parsing
  - Shorter output format combining context window and output tokens on single line
  - Consolidated Total line with cost information
  - Sub-sessions use numbered Context window lines directly

## 1.46.4

### Patch Changes

- a3bdea6: Fix CI/CD false positive for .gitkeep files using positive matching (Issue #1528).

  Use consistent positive matching in detect-code-changes.mjs: "Files considered as code changes" now only shows files matching codePattern, so unknown file types like .gitkeep are naturally excluded without explicit exclusion rules. Add 40 unit tests covering the full detection pipeline.

## 1.46.3

### Patch Changes

- c425744: Standardize /version output — strip OS/arch, normalize dates, enhance platform detection (Issue #1524)
  - Strip OS/architecture info (e.g. x86_64-unknown-linux-gnu, linux/amd64) from version strings for cleaner output
  - Normalize date formats to ISO (YYYY-MM-DD) across all version components
  - Enhance platform detection for consistent environment reporting

## 1.46.2

### Patch Changes

- 37daeb7: Auto-recover from non-fork repositories during fork validation (Issue #1518)
  - When a repository exists but is NOT a proper GitHub fork (or has wrong parent), safely auto-recover by comparing commits against upstream first — only delete and re-fork if no additional commits would be lost
  - Add verbose logging of fork commands for debugging non-fork creation scenarios
  - Add post-creation fork validation to detect non-fork repos immediately after `gh repo fork`
  - Report non-fork creation to Sentry for monitoring
  - Add `--allow-force-non-fork-repository-deletion` flag to force deletion even when additional commits would be lost
  - Add case study documenting the root cause analysis of konard/MixaByk1996-elements-app
  - Document all previously undocumented solve options in CONFIGURATION.md (12 options including --allow-force-non-fork-repository-deletion)
  - Add CI/CD test to verify documentation stays in sync with code options (prevents drift)

## 1.46.1

### Patch Changes

- 84aacf7: fix: pass LINK_ASSISTANT_AGENT_VERBOSE env var to agent process for HTTP logging (#1521)

## 1.46.0

### Minor Changes

- d9721c0: Add work session completion notifications and isolation mode to Telegram bot

  Session notifications:
  - Tracks sessions started by `/solve` and `/hive` commands
  - Monitors sessions every 30 seconds and sends completion notifications
  - Sends notification with session name, duration, URL, and exit status
  - Persistent session tracking via ExecutionStore from start-command

  Isolation mode (`--isolation` option, experimental):
  - New `--isolation` flag for Telegram bot: `screen`, `tmux`, or `docker`
  - Uses `$` CLI from link-foundation/start with GUID-based session tracking
  - Tracks session completion via `$ --status <uuid>` for reliable detection
  - Solve queue supports isolation-aware execution and process counting
  - Each isolated session gets a unique UUID for unambiguous tracking
  - Without `--isolation`, uses existing `start-screen` command (unchanged)

## 1.45.1

### Patch Changes

- 003c5ca: Fix premature finish signaling and leaked child processes (Issue #1516)
  - Kill entire process group on stream timeout using negative PID, preventing leaked /bin/sh child processes from continuing to make commits after completion
  - Move .gitkeep cleanup to after all completion signals (log upload, "Ready to merge" comment) so no new commits appear after the system reports "session ended"
  - drainHandles now reports surviving child processes as errors instead of silently killing them, so root causes are investigated rather than hidden

## 1.45.0

### Minor Changes

- c308660: Add experimental live progress monitoring for work sessions
  - Implement `--working-session-live-progress [comment|pr]` CLI flag for both solve and hive commands
    - `comment` mode (default): Creates a per-session PR comment with updatable progress section
    - `pr` mode: Updates PR description with live progress section
    - Plain `--working-session-live-progress` defaults to `comment` mode
  - Create progress monitoring module (`solve.progress-monitoring.lib.mjs`) with:
    - Live TODO list tracking from TodoWrite tool calls
    - Progress bar visualization (percentage complete)
    - Comment mode: creates/edits a dedicated PR comment per work session
    - PR mode: updates PR description with progress section
    - Task list is always shown expanded (never collapsible)
    - Rate limiting to avoid GitHub API throttling
  - Integrate progress monitoring into claude.lib.mjs event stream processing
    - Detects TodoWrite tool_use events (assistant) and tool_use_result events (user)
    - Updates progress when TodoWrite tool is invoked
    - Displays task completion stats and progress bar
    - Supports work session identification
  - Works with or without `--interactive-mode` (independent feature)
  - Auto-registered in hive via SOLVE_OPTION_DEFINITIONS (no manual forwarding needed)
  - Add comprehensive test suite (89 tests) covering:
    - Progress calculation and formatting
    - Display mode normalization
    - CLI configuration in solve and hive
    - Auto-registration and forwarding via getSolvePassthroughOptionNames
    - Claude integration for TodoWrite detection
    - Comment and PR display modes
  - Feature is experimental, opt-in via `--working-session-live-progress`
  - Implements issue #936

## 1.44.0

### Minor Changes

- e7ce2dd: Add TELEGRAM_ALLOWED_TOPICS for forum topic filtering (issue #1100)

## 1.43.0

### Minor Changes

- 91479e3: Better /version command output with uniform formatting and bug fixes: add regex version parsers for all 40+ tools, fix LLD/Xvfb/Playwright MCP detection, add Playwright browser cache fallback, fail Docker build on MCP registration failure

## 1.42.0

### Minor Changes

- 5aa82f5: Add /stop and /start commands for telegram bot to control task acceptance per chat (Issue #1081)

## 1.41.0

### Minor Changes

- 2c9396d: feat: simplify Dockerfile — bump sandbox 1.5.0→1.6.0, remove Playwright setup, eliminate USER root, remove silent fallbacks (#1505)

## 1.40.2

### Patch Changes

- 3dbbe9c: fix: improve context, token and cost estimation accuracy for multi-model sessions (#1508)
  - Merge resultModelUsage from Claude Code result JSON into JSONL-based calculations to include sub-agent model tokens (e.g., Haiku) that are missing from JSONL
  - Split token and context usage per model in budget stats PR comments
  - Show per-model cost breakdown in budget stats
  - Fix sub-sessions being duplicated under each model heading in multi-model mode
  - Add verbose diagnostics indicating when token data is sourced from result JSON vs JSONL

## 1.40.1

### Patch Changes

- 9df62ed: fix: increase activity timeout to 1hr, fix idle tracking, improve graceful kill (#1510)

## 1.40.0

### Minor Changes

- 6b8465a: feat: add browsers, browser tools, and missing software to /version command

## 1.39.0

### Minor Changes

- b162658: Migrate to sandbox 1.5.0 with /workspace shared directory, replacing user rename approach with group-based access (issue #1499)

## 1.38.3

### Patch Changes

- deb31bf: fix: add multi-mechanism CI consensus, repo-wide action monitoring, and 5-min minimum CI check interval to prevent false positive "Ready to merge"

## 1.38.2

### Patch Changes

- 290139f: fix: correct cost and token/context budget calculations (#1501)
  - Deduplicate JSONL session entries by message ID to fix inflated token counts caused by upstream anthropics/claude-code#6805
  - Show peak context window usage (max single-request fill) instead of cumulative sum which produced nonsensical percentages like 7516%
  - Add "Total tokens processed" as a separate cumulative metric for session throughput visibility
  - Add verbose logging for JSONL deduplication stats and peak context values

## 1.38.1

### Patch Changes

- 1525ecb: fix: prevent 'Failed to send formatted message' Telegram error by adding safeReply helper and escaping unescaped Markdown in bot messages

## 1.38.0

### Minor Changes

- ee331ef: Enhance --tokens-budget-stats with sub-session tracking, stream comparison, and GitHub comment display

## 1.37.4

### Patch Changes

- 72bbb31: Add emphasis on reproducible automated testing in system prompts
  - Add new "Reproducible testing" section to all prompt files (claude, agent, codex, opencode)
  - Update "Solution development and testing" to emphasize test-first approach
  - Enhance Playwright MCP guidelines with UI bug reproduction workflow
  - Enhance Visual UI work section with before/after screenshot guidelines
  - Fix spelling and grammar issues across all prompt files
  - Soften forceful language to use recommendation style ("When x, do y.")
  - Add comprehensive case study for issue #1179 documenting best practices

## 1.37.3

### Patch Changes

- 7bc72fa: add early --base-branch/--target-branch validation in telegram bot to reject URLs and invalid branch names before spawning solve/hive processes (Issue #1482)

## 1.37.2

### Patch Changes

- f07ae29: fix false positive "Ready to merge" by cross-validating CI success status with GitHub Actions workflow runs API and removing unreliable commit-age-based grace period (Issue #1480)

## 1.37.1

### Patch Changes

- 8df5a3d: Treat ENOSPC as immediate failure at all stages (issues #1212, #1211)

  When disk space runs out during any stage — including git clone, execution, and log
  upload — ENOSPC is now treated as a hard failure (not partial success). Added ENOSPC
  detection to git clone error classification so disk-full clone failures are not
  retried. The isENOSPC utility now detects git-specific patterns like "unable to write
  file" and "cannot create directory". Actionable disk cleanup guidance is provided.

## 1.37.0

### Minor Changes

- f02c1fc: fix synthetic model appearing in PR comments by filtering internal Claude CLI router entries (Issue #1486)
- dd87b23: Add opusplan model support and --plan-model option for flexible plan/execution model pairing

## 1.36.1

### Patch Changes

- 74bf211: fix false positive 'Ready to merge' by adding workflow run grace period (Issue #1480)

## 1.36.0

### Minor Changes

- 3adbf2b: feat: add --auto-report-issue and --disable-report-issue flags for non-interactive error reporting (Issue #1484)
  - Add `--auto-report-issue` flag that automatically creates a GitHub issue on failure without prompting.
    The auto-reported issue includes error details, logs, and case study analysis instructions in the body.
    Issue is labeled as `bug`.
  - Add `--disable-report-issue` flag that completely disables error issue creation (no prompt, no auto-creation).
    Takes precedence over `--auto-report-issue` if both are specified.
  - Default behavior (neither flag) preserves the existing interactive y/n prompt.
  - Both flags are automatically available as passthrough options in hive and TELEGRAM_HIVE_OVERRIDES.

## 1.35.12

### Patch Changes

- 05a72c3: fix: reject URLs and invalid git branch names used as --base-branch (Issue #1482)
  - Add `validateBranchName()` function to `solve.branch.lib.mjs` that validates branch names against git-check-ref-format rules
  - Reject URLs (https://, http://, git@, ssh://) passed as --base-branch with clear error message
  - Reject invalid git ref characters (spaces, ~, ^, :, ?, \*, [, ], \, control chars, .., @{)
  - Add validation in `solve.config.lib.mjs` parseArguments (early catch), `solve.branch.lib.mjs` createOrCheckoutBranch (defense-in-depth), and `hive.mjs` (before forwarding to solve)
  - Add 19 test cases in `tests/test-base-branch-validation.mjs`
  - Add case study documentation in `docs/case-studies/issue-1482/`

## 1.35.11

### Patch Changes

- 6edb401: fix: add stream startup timeout to detect stuck Claude CLI (Issue #1472/#1475)

  Both affected sessions showed ~4.5 hours with zero stdout/stderr from Claude CLI despite a successful API response. Adds a configurable startup timeout (default: 2 minutes, env: HIVE_MIND_STREAM_STARTUP_MS) that force-kills the Claude CLI process if no output is received, preventing indefinite hangs and enabling retry logic.

## 1.35.10

### Patch Changes

- 21e1f5e: fix: fix model recognition logic and update free models docs (Issue #1473)
  - Consolidate `model-info.lib.mjs`, `model-mapping.lib.mjs`, and `model-validation.lib.mjs` into single `src/models/index.mjs`
  - Fix `resolveModelId()` to use `mapModelForTool()` as single source of truth instead of duplicated hardcoded maps that were missing agent free model mappings
  - Fix false warning "Main model does not match requested model" for agent free models (e.g., `kimi-k2.5-free` → `opencode/kimi-k2.5-free`)
  - Add missing base model pricing mappings for `minimax-m2.5-free`, `glm-5-free`, `glm-4.5-air-free`, `deepseek-r1-free`, `giga-potato-free` in `getBaseModelForPricing()`
  - Update `validateAgentConnection()` default model to `minimax-m2.5-free`
  - Update `docs/FREE_MODELS.md` to sync with upstream [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md)
  - Update README.md examples to use `minimax-m2.5-free` instead of deprecated `kimi-k2.5-free`

## 1.35.9

### Patch Changes

- 2e4e00e: fix: update tool display names to full official names (Issue #1470)
  - Update `getToolDisplayName()` in `src/model-info.lib.mjs` to return full official names: "Anthropic Claude Code", "OpenAI Codex", "OpenCode", "Agent CLI"
  - Update usage limit messages in `src/claude.lib.mjs`, `src/codex.lib.mjs`, and `src/agent.lib.mjs` to use full tool names
  - Update test assertions in `tests/model-info.test.mjs` and `tests/test-usage-limit.mjs` to match new display names

## 1.35.8

### Patch Changes

- ca57154: fix: add retry with exponential backoff for PR verification after creation (Issue #1468)
  - Add retry logic with exponential backoff (up to 5 attempts: 2s, 4s, 6s, 8s, 10s) to PR verification step in solve.auto-pr.lib.mjs to handle GitHub API eventual consistency
  - Add case study with timeline reconstruction and root cause analysis
  - Add 11 unit tests covering retry behavior, backoff timing, and edge cases

## 1.35.7

### Patch Changes

- fca8460: fix: prevent infinite CI waiting loop when workflows complete with action_required (Issue #1466)
  - Detect when all workflow runs completed with non-executing conclusions (action_required, cancelled, stale, skipped) and treat as "CI not triggered" instead of waiting indefinitely for check-runs that will never appear
  - Add verbose log interceptor (setupVerboseLogInterceptor) to capture [VERBOSE] console.log output in log files, fixing the discrepancy between terminal and log file output
  - Add case study with root cause analysis and timeline reconstruction from 5 production log files
  - Add 14 unit tests covering action_required handling, non-executing conclusions, race conditions, and edge cases

## 1.35.6

### Patch Changes

- 4b0beaf: Fix interactive mode PR comment output: use stdin for GitHub API calls to prevent shell quoting corruption, flush comment queue before tool result timeout to prevent stuck "Waiting for result..." comments, and guard against duplicate session started comments from late system.init events

## 1.35.5

### Patch Changes

- 37481da: fix: improve PR creation failure error messaging and log upload fallback (Issue #1462)
  - Consolidate triple error output into a single clear error message when PR creation fails
  - Upload failure logs to the issue as fallback when PR is not available (--attach-logs)
  - Capture and log `gh pr create` stdout/stderr in verbose mode for root cause diagnosis
  - Add fallback GitHub user detection via `gh auth status` when `gh api user` fails
  - Rename `github-issue-creator.lib.mjs` to `github-error-reporter.lib.mjs` for clarity

## 1.35.4

### Patch Changes

- 0df2139: Harden Telegram message formatting: escape special characters in user mentions, options text, and server overrides. Add safeReply with plain text fallback and diagnostic logging when Telegram rejects Markdown. Improve error messages with user identity context for root cause analysis.

## 1.35.3

### Patch Changes

- 22ae6d6: fix: rename "attempt" to "iteration" in auto-restart messages (Issue #1456)

  The auto-restart PR comment title and log message now use "iteration" instead of "attempt" to match the project's terminology. Affected messages:
  - PR comment: `Auto-restart triggered (iteration N)` (was `attempt N`)
  - Log: `Exiting auto-restart mode after N iterations` (was `attempts`)

## 1.35.2

### Patch Changes

- 0cfcb6a: Fix CI/CD changelog formatting when multiple PRs merge before a release (Issue #1452). The merge-changesets script now keeps each changeset as a separate file (only harmonizing bump types) instead of merging descriptions into one, so @changesets/cli produces separate bullet items. Also enhances release notes PR detection to find all related PRs via tag-range merge commit lookup.
- a689f6b: fix: use result JSON modelUsage for accurate multi-model display in GitHub comments

  When Claude Code uses multiple models (e.g., main model + subagent), the completion
  comment now correctly displays all models instead of just the main model.

## 1.35.1

### Patch Changes

- Fix misleading "Retry after: 0s" message in /limits command when Claude Usage API returns 429. Now shows "Try again later." for zero/missing retry-after values, or proper reset time format (e.g., "Resets in 5m (Mar 19, 8:00pm UTC)") for meaningful values. Also caches 429 errors to prevent repeated requests to rate-limited endpoint, and adds full request/response verbose logging for debugging.

  improve Solution Draft Log comment formatting for better readability (issue #1448)

## 1.35.0

### Minor Changes

- f3de781: Add handlers for agent task lifecycle events (task_started, task_progress, task_notification) and rate_limit_event in interactive mode, reducing PR comment noise by ~30%

## 1.34.8

### Patch Changes

- c95a472: Add test timeout guidelines to system prompt and case study documentation
  - Added guidelines for setting reasonable test timeouts in CI/CD pipelines
  - Created comprehensive case study in docs/case-studies/issue-1197/
  - Recommendations include: 5-30s for unit tests, 30-60s for E2E tests
  - Guidelines for job-level workflow timeouts and fail-fast patterns

## 1.34.7

### Patch Changes

- bb83be9: fix: fail with helpful error when --fork used on own repository (issue #1206)

## 1.34.6

### Patch Changes

- 3157192: Optimize CI/CD to skip checks for .gitkeep-only changes and harden .gitkeep cleanup logic (Issue #1436).

  CI/CD jobs `version-check` and `helm-pr-check` now skip when only `.gitkeep` files changed, saving ~21 seconds of runner time per PR on the initial commit. The `detect-code-changes.mjs` script now excludes `.gitkeep` files from code change detection and outputs a `gitkeep-only` flag.

  The `.gitkeep` cleanup logic in `solve.results.lib.mjs` is hardened with: (1) full commit message body detection (`%B` instead of `%s`) so `.gitkeep` references in commit body are found, (2) fallback file detection via `git diff-tree`, and (3) post-cleanup verification with direct removal fallback to prevent leftover `.gitkeep` files.

  Also removes the leftover `.gitkeep` file from the repository that was left behind by PR #1420.

## 1.34.5

### Patch Changes

- ab070db: Use workflow runs API to detect when CI is not triggered, preventing infinite loop (Issue #1442)

  When `--auto-restart-until-mergeable` monitors a PR in a repo that has active GitHub Actions workflows but CI checks never start (e.g., fork PRs needing maintainer approval, `paths-ignore` filtering all changed files, workflow trigger conditions not matching), the monitoring loop now exits immediately instead of waiting indefinitely.

  Instead of using a timeout-based approach, the fix uses the GitHub Actions workflow runs API (`repos/{owner}/{repo}/actions/runs?head_sha={sha}`) to definitively determine if any workflow runs were triggered for the PR's commit. If zero workflow runs exist, CI was not triggered and there is nothing to wait for — the system exits immediately with a diagnostic PR comment.

## 1.34.4

### Patch Changes

- c3806b5: Fix missing log upload on tool failure and make HTTP 529 overload error retryable (Issue #1439)

  Two fixes:
  1. When `--attach-logs` is enabled and the tool execution fails during an auto-restart session, the failure log was not being uploaded to GitHub. Now the log is attached before stopping on both tool execution failure paths.
  2. HTTP 529 (Anthropic "Overloaded") errors were not recognized as transient/retryable by the outer retry loop. The code only matched `API Error: 500` + `Overloaded`, but 529 uses `API Error: 529` + `overloaded_error`. Now both 500 and 529 overload errors trigger the retry logic with exponential backoff.

## 1.34.3

### Patch Changes

- 22a8868: Fail fast when API signals x-should-retry: false and retries make no progress (Issue #1437). Increase minimum retry delay to 2 minutes.

  When the Anthropic API returns HTTP 500 with `x-should-retry: false` AND subsequent retries immediately fail with `num_turns <= 1`, the outer retry loop now exits early instead of waiting through up to 10 retries with exponential backoff. This prevents stuck sessions where recovery is impossible.

  Two new signals are tracked: (1) `apiMarkedNotRetryable` — set when `ANTHROPIC_LOG=debug` stderr contains `"error; not retryable"` or `x-should-retry: false`; (2) `resultNumTurns` — captured from the result event to detect sessions that failed immediately on resume. If both conditions are met after `HIVE_MIND_MAX_NOT_RETRYABLE_ATTEMPTS` (default: 5) retry attempts, the loop fails fast with a clear error message instead of continuing indefinitely.

  The minimum retry delay for transient API errors (Overloaded, 503, Internal Server Error) is increased from 1 minute to 2 minutes (`HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS`), giving the API more time to recover between retries.

## 1.34.2

### Patch Changes

- dc92237: Set `opus` alias to target Opus 4.6 instead of Opus 4.5 (Issue #1433). Opus 4.6 offers a 1M token context window and comparable cost efficiency. The `isOpus46OrLater` function is updated to recognise the `opus` alias directly so Opus 4.6 features (128K output tokens, effort-level thinking) are applied automatically when using the default alias.

## 1.34.1

### Patch Changes

- 0f02dc5: Better wording for auto-restart comment

  Updated the auto-restart comment to say "Starting new session to review and commit or discard them" instead of "Starting new session to review and commit them". This makes the wording consistent with the system prompts that already instruct the AI to either COMMIT or REVERT (discard) uncommitted changes.

## 1.34.0

### Minor Changes

- 614c3d9: Add model information display in PR/issue log comments. Shows actual models used (extracted from CLI JSON output) vs requested model. Main model is bolded when it matches the request; a warning appears when it doesn't. Supporting models are listed separately. Uses models.dev API for full model name, provider, and knowledge cutoff. Replaces duplicated tool name mapping with unified getToolDisplayName() helper.

## 1.33.0

### Minor Changes

- f7a2fdd: Add --auto-init-repository option to automatically initialize empty repositories by creating a simple README.md file, enabling branch creation and pull request workflows on repositories with no commits

## 1.32.3

### Patch Changes

- 04cf237: fix: properly drain active handles at exit to prevent indefinite process hang (Issue #1431)

  Root causes identified and fixed: process.stdin (ReadStream) was never unreferenced; undici's global connection pool (Socket×2) was never closed; surviving command-stream child processes (ChildProcess) were never unreferenced; process.stdout/stderr (WriteStream×2) were not unreferenced on non-TTY descriptors.

  Added drainHandles() in exit-handler.lib.mjs that unrefs/closes all four handle types before process.exit(). Added logActiveHandles() export with per-handle detail (fd, path, pid, remoteAddress) that always logs to the log file. Added no-leaked-streams ESLint rule to catch bare createReadStream/createWriteStream calls whose return value is discarded — the stream companion to the existing no-leaked-timers rule.

## 1.32.2

### Patch Changes

- 695954c: Remove duplication of locked options in /solve and /hive command responses by showing only user-provided options in the Options line, adding emoji prefix for visual distinction, and adding empty line separator between URL and options

## 1.32.1

### Patch Changes

- 2f710dd: fix: sanitize orphaned UTF-16 surrogates across all CLI output parsing paths (Issue #1324)

  Extract `sanitizeUnicode()` and `sanitizeObjectStrings()` into a shared `unicode-sanitization.lib.mjs` module and apply sanitization in all CLI output parsing paths — `claude.lib.mjs`, `agent.lib.mjs`, `codex.lib.mjs`, `opencode.lib.mjs`, and `interactive-mode.lib.mjs`. This ensures orphaned UTF-16 surrogates (from Claude CLI's `<persisted-output>` truncation) are replaced with U+FFFD before any JSON re-serialization, logging, or API calls. Add 62 unit tests covering surrogate edge cases, real-world Claude NDJSON events, and JSON round-trip safety.

## 1.32.0

### Minor Changes

- b2c94db: Support all options via /solve command when replying to a message containing a GitHub link (issue #1325)

  Previously, `/solve` as a reply only worked when used without any arguments. Now users can reply to a message containing a GitHub issue/PR link with `/solve --model opus` or any other options, and the bot will:
  1. Extract the GitHub URL from the replied message
  2. Use the provided options
  3. Execute the solve command with both the extracted URL and the user-provided options

## 1.31.4

### Patch Changes

- Extract large inline script blocks from release.yml into ./scripts/ to fix CI line-limit violation (issue #1428)

  fix: configure release pipeline to react to docker=true so Dockerfile changes trigger Docker image rebuild (Issue #1423)

  Previously, commits that changed only `Dockerfile` or `coolify/Dockerfile` produced `docker=true` but `code=false`. The `release` job required all test jobs to `succeed` — but those tests were correctly skipped (no JavaScript code changed). Since `skipped != 'success'`, the release job was also skipped, and no Docker image was rebuilt.

  This was observed when PR #1420 (fixing `/home/hive/.config` ownership) was merged: both Dockerfiles changed, but CI run `23040959919` showed all Docker publish jobs as skipped.

  The `release` job condition is now updated to:
  - Also trigger when `docker-changed == 'true'` (not only `code=true`)
  - Accept `skipped` as well as `success` for test/lint jobs (skipped = intentionally not run, not a failure)
  - Block on any actual job `failure`

  This directly configures CI/CD to react to `docker=true` — without misclassifying Dockerfiles as "code" files.

  Full root cause analysis and timeline in `docs/case-studies/issue-1423/`.

  Migrate GitHub Actions to Node.js 24 compatible versions to eliminate deprecation warnings before the June 2026 deadline

## 1.31.3

### Patch Changes

- b77704d: fix: set Docker image version labels to actual release version (Issue #1419)

  The `docker/metadata-action@v5` defaulted the `org.opencontainers.image.version`
  OCI label to the Git ref name `"main"` instead of the actual release version.
  Added explicit `labels` override to all four Docker metadata steps in both regular
  and instant release pipelines.

  Also added `.config` directory ownership and write-access verification to the Docker
  image verification script to prevent the permission regression from recurring.

## 1.31.2

### Patch Changes

- efe3506: fix: /merge command no longer falsely fails when latest CI is in progress (Issue #1425)

  The `checkBranchCIHealth` function previously queried only `status=completed` runs
  to determine if the default branch CI was healthy. When a new commit had an in-progress
  CI run, the function returned the previous (now superseded) commit's failure as the
  "latest" CI status, causing the merge queue to be blocked with a false positive error.

  The fix resolves the actual HEAD SHA of the branch first, then queries CI runs
  specifically for that SHA (without a status filter). If the latest commit's runs are
  in progress, the function returns `pending: true` (healthy) instead of reporting a
  failure from an older commit. The merge queue then proceeds to the existing
  `waitForTargetBranchCI` step which correctly waits for those runs to complete.

## 1.31.1

### Patch Changes

- 5108367: fix: fix root causes of 20-32h process hang after session ends (Issue #1335)

  Two separate bugs caused `solve` processes to run for 20–32 hours after work was complete:

  **Bug A — Infinite loop for repos without CI:** When `--auto-restart-until-mergeable` is used
  on a repository with no CI/CD workflows, the `watchUntilMergeable` loop was permanently stuck
  on "CI/CD checks have not started yet" with no exit condition. The root cause was that the code
  treated `no_checks` identically for both transient race conditions (CI hasn't started yet after
  a push) and permanent states (repo has no CI at all). Fixed by checking whether the repository
  actually has GitHub Actions workflows configured (`hasRepoWorkflows()`). If none exist, the
  `no_checks` state is permanent and the monitor exits immediately, treating the PR as CI-passing.
  If workflows exist, the state is a transient race condition and the loop keeps waiting.

  **Bug B — No process exit after session ends:** After a successful run (PR became mergeable,
  work session ended), `solve.mjs` never called `process.exit()`. Sentry's profiling integration
  (`@sentry/profiling-node`) kept the Node.js event loop alive indefinitely. Fixed by calling
  `safeExit(0)` at the end of the `finally` block in `solve.mjs`, which flushes Sentry events
  (up to 2 seconds) and then calls `process.exit(0)`.

  Also adds `--verbose` debug logging of active Node.js handles at exit to aid diagnosis of
  future occurrences.

## 1.31.0

### Minor Changes

- feat: add --finalize option (Issue #1383)

  Adds new experimental CLI options to the `solve` command:
  - `--finalize [N]`: After the main solve completes, automatically restarts the AI tool N times (default: 1 when used as a flag) with a requirements-check prompt to verify all requirements are met. Uses the same model as `--model` by default.
  - `--finalize-model`: Override the model used during `--finalize` iterations (defaults to `--model`).
  - `--prompt-ensure-all-requirements-are-met`: Adds a system prompt hint in the "Self review" section instructing the AI to ensure all changes are correct, consistent, validated, tested, logged and fully meet all discussed requirements. Enabled automatically during `--finalize` iterations only (not the first regular run).

  This forces the AI tool to double-check itself after the main solve, verifying changes meet all requirements from the issue description and PR comments, and that CI/CD checks pass.

  feat: auto-commit uncommitted changes and upload log on CTRL+C interrupt (Issue #1351)

  Previously, when a user pressed CTRL+C to interrupt a running solve session, uncommitted changes were silently lost (or left uncommitted) and log files were not uploaded to the PR/issue even when `--attach-logs` was enabled. Additionally, the terminal showed "Claude command completed" instead of "Claude command interrupted".

  Now on CTRL+C:
  1. **Auto-commit**: Any uncommitted changes in the working directory are automatically committed and pushed to the branch before cleanup occurs.
  2. **Log upload**: If `--attach-logs` is enabled, the log file is automatically uploaded to the GitHub PR/issue as a comment.
  3. **Accurate message**: The terminal now correctly shows "Claude command interrupted" instead of "Claude command completed" when the process exits with code 130 (SIGINT).

  Changes made:
  - `src/exit-handler.lib.mjs`: Added optional `interrupt` parameter to `initializeExitHandler()`; SIGINT handler now calls it before cleanup, guarded against double invocation
  - `src/solve.mjs`: Extended `cleanupContext` with branch/PR/owner/repo fields; new `interruptWrapper` auto-commits and uploads logs on CTRL+C
  - `src/claude.lib.mjs`, `src/opencode.lib.mjs`, `src/codex.lib.mjs`, `src/agent.lib.mjs`: Detect exit code 130 and print "interrupted" instead of "completed"

  Full case study analysis including timeline reconstruction, root cause analysis, and implementation details in `docs/case-studies/issue-1351/`.

  fix: prevent false positive ready tag sync by using issue timeline API (Issue #1413)

  Previously, `syncReadyTags()` used a GitHub full-text body search to find PRs linked to an issue:

  ```js
  gh pr list --search "in:body closes #1411 OR fixes #1411 OR resolves #1411"
  ```

  This caused a false positive: PR #843 matched because `1411` appeared as a source code line reference inside its body, not as a genuine issue-closing keyword.

  Now uses the GitHub issue timeline API (`GET /repos/{owner}/{repo}/issues/{issue_number}/timeline`) to find PRs with genuine `cross-referenced` events, which is the same data GitHub uses to auto-close issues when PRs are merged.

  fix: hide cancel button and show cancelling state on /merge cancel (Issue #1407)

  When user clicked the "🛑 Cancel" button during `/merge` queue processing, the cancel button remained visible in the Telegram message until the current PR finished processing (potentially hours if waiting for CI). The toast message "The current PR will finish processing" was also confusing.

  The fix immediately hides the cancel button by editing the message without `reply_markup`, shows a "🛑 Cancelling..." indicator in the progress message when cancellation is requested, and adds `isCancelled` support to `waitForCI()` for early exit when the operation is cancelled.

## 1.30.5

### Patch Changes

- a9a58ab: Switch Docker builds to registry cache for faster arm64 builds
  - Changed from GitHub Actions cache to Docker Hub registry cache backend
  - Use architecture-specific cache tags (buildcache-amd64, buildcache-arm64) to prevent cross-platform cache overwriting
  - Increased Docker job timeout from 45 to 60 minutes for safety margin
  - Added comprehensive case study documentation for issue #1415

## 1.30.4

### Patch Changes

- 65eefd9: fix: prevent solve command from hanging after PR is merged (Issue #1346)

  Previously, after the solve command detected a merged PR and printed "PR MERGED! Stopping auto-restart-until-mergeable mode", the process would hang indefinitely instead of exiting.

  Root cause: The `finally` block in `src/solve.mjs` completed all async work but never called `process.exit(0)`. Active handles on the Node.js event loop (from libraries like `command-stream` and network connections) prevent natural process exit. When Sentry is enabled (`--sentry`), `@sentry/profiling-node` native handles also contribute.

  The fix:
  1. Restores explicit `📁 Complete log file:` display in the `finally` block (matching original behavior)
  2. Calls `closeSentry()` from `sentry.lib.mjs` to properly flush Sentry events and release profiling handles when Sentry is enabled (no-op when disabled)
  3. Calls `process.exit(0)` as a required safety net to prevent hanging from any remaining active handles
  4. Adds a hard `Promise.race` timeout (3s) around `sentry.close()` in `exit-handler.lib.mjs` to prevent it from hanging if Sentry's transport stalls

## 1.30.3

### Patch Changes

- 1fc6a15: Disable Sentry error tracking by default for maximum user privacy. Users must now explicitly opt in with `--sentry` flag or `HIVE_MIND_SENTRY=true` env var. This guarantees 100% privacy by default — no usage data is sent to Sentry unless the user chooses to enable it.

## 1.30.2

### Patch Changes

- e0bf56a: feat: make --gitkeep-file content shorter with single-line format (Issue #1397)

  Previously, the `.gitkeep` file generated by `--gitkeep-file` contained multiple verbose lines:

  ```
  # Auto-generated file for PR creation
  # Issue: https://github.com/...
  # Branch: issue-3-57a79ede43e6
  # Timestamp: 2026-03-07T23:53:23.107Z
  # This file was created with --gitkeep-file (default)
  # It will be removed when the task is complete
  ```

  Now it uses a concise single-line format:

  ```
  # .gitkeep file auto-generated at 2026-03-07T23:53:23.107Z for PR creation at branch issue-3-57a79ede43e6 for issue https://github.com/...
  ```

## 1.30.1

### Patch Changes

- 27b4f09: Fix Docker CI/CD amd64 build cancellation due to GHA cache export timeout
  - Increase `timeout-minutes` from 30 to 45 in `docker-publish` and `docker-publish-instant` jobs
  - Switch GHA cache mode from `mode=max` to `mode=min` to reduce sequential cache export payload
  - Add `ignore-error=true` to `cache-to` so cache export failure does not cancel a successful image push
  - Add comprehensive case study in `docs/case-studies/issue-1394/CASE-STUDY.md` with root cause analysis and CI log data

  Root cause: The sandbox-based hive-mind image (~2-3 GB) takes ~30 min to build and push to Docker Hub.
  After the push, BuildKit exports all image layers sequentially to GHA cache (`mode=max`). This sequential
  write of ~800 MB per layer exhausted the 30-minute job timeout mid-export, cancelling an already-successful
  build. The Docker image itself was published correctly; only the cache export step was interrupted.

## 1.30.0

### Minor Changes

- ee6233a: Optimize Docker build by using pinned konard/sandbox version as base image
  - Docker image now inherits from `konard/sandbox:1.3.16` (pinned) instead of building from scratch
  - Significantly faster build times (2-3 min vs 10-15+ min) as general-purpose tools are pre-installed
  - Reduced timeout risk since heavy installations (Homebrew, PHP, etc.) are handled by base image
  - Removed `scripts/ubuntu-24-server-install.sh` (functionality now provided by sandbox)
  - User renamed from `sandbox` to `hive` for backward compatibility
  - Sandbox version is pinned to `1.3.16` for stable, reproducible builds (instead of `latest`)
  - Docker image is versioned to match the published npm package version
  - Docker builds are triggered only after npm package availability is confirmed

  This change implements the separation of concerns described in link-foundation/sandbox#65:
  - sandbox: Universal development environment with all general-purpose tools
  - hive-mind: AI-specific tools (Claude CLI, Playwright MCP, etc.) built on top of sandbox

## 1.29.0

### Minor Changes

- 161b595: feat: add --auto-accept-invite option to solve command

  Adds a new `--auto-accept-invite` boolean option to the `solve` command that automatically accepts the pending GitHub repository or organization invitation for the specific repository/organization being solved, before checking write access.

  Unlike the `/accept_invites` Telegram command (which accepts ALL pending invitations), this option is scoped to the target repo/org only, making it safer and more targeted. Useful when you've just been invited to a repository and want to run `solve` without manually accepting the invitation first.

## 1.28.0

### Minor Changes

- docs: expand best practices with CI/CD guide, universal prompts, and architecture improvement (Issue #1403)

  Splits the existing `docs/BEST-PRACTICES.md` into two focused documents:
  - **`docs/CI-CD-BEST-PRACTICES.md`** (renamed from the original) — Updated and expanded CI/CD guide covering all key points from existing workflow templates, including: running checks only on relevant file changes, fast-fail job ordering, fresh merge simulation, concurrency control, changeset exemptions for docs-only PRs, secrets detection, documentation validation, and OIDC trusted publishing.
  - **`docs/BEST-PRACTICES.md`** (new general guide) — Universal best practices for AI-driven development including: deep analysis bug/feature prompts, universal validation prompt, plan mode prompt, issue writing guidelines with acceptance criteria patterns, an architecture improvement prompt linking to the Code Architecture Principles repository, CI/CD summary with link to the CI/CD guide, and subagent coordination patterns.

  Also updates `README.md` to link to both new documents in the Best Practices section.

  feat: enable --auto-restart-until-mergeable by default (Issue #1360)

  The `--auto-restart-until-mergeable` feature has become stable enough to be enabled by default. Previously, users had to explicitly pass this flag to enable automatic restart until the PR becomes mergeable.

  Now the feature is enabled by default, meaning the solver will automatically restart on new comments from non-bot users, CI failures, merge conflicts, or other issues — without requiring any extra flags. Users who want to disable this behavior can pass `--no-auto-restart-until-mergeable`.

  fix: filter GitHub Pages deployment workflows from PR CI check (Issue #1399)

  `getActiveRepoWorkflows()` included the `pages-build-deployment` workflow (path: `dynamic/pages/pages-build-deployment`) as if it were a PR CI workflow. This workflow is auto-created by GitHub for GitHub Pages and only runs on the default branch after merge — it never creates check-runs on PR branches. As a result, `--auto-restart-until-mergeable` got stuck in an infinite loop waiting for CI checks that would never appear.

  The fix filters out workflows with the `dynamic/pages/` prefix from `getActiveRepoWorkflows()`. These are GitHub Pages internal workflows, not user-defined CI pipelines.

  Affected scenario: repositories with GitHub Pages enabled but no `.github/workflows/` files (e.g., `konard/links-visuals`).

  fix: resolve Prettier formatting issue in README.md (Issue #1401)

  The CI/CD `lint` job was failing on the `main` branch because README.md had Prettier formatting violations after commit `da376061` ("Clarify Time Freedom and Any Device Programming features"). That commit added longer text to two table cells, which made the table column widths inconsistent with Prettier's expected format.

  The fix runs `prettier --write` on README.md to re-align the table column widths, bringing the file back into conformance with the `format:check` CI step.

## 1.27.0

### Minor Changes

- f6e909e: feat: make --gitkeep-file enabled by default for all --tools (Issue #1385)

  Previously, `--claude-file` was the default for `--tool claude`, while `--gitkeep-file` was the default for other tools. Now `--gitkeep-file` is the universal default for all `--tool` values, including `--tool claude`.

  As explained in the referenced video, CLAUDE.md and AGENT.md files generally do not help AI tools and should be avoided. Users who need CLAUDE.md-based task passing can still explicitly opt in with `--claude-file`.

## 1.26.4

### Patch Changes

- ff46719: fix: update default agent model to minimax-m2.5-free (Issue #1391)

  `kimi-k2.5-free` is no longer supported by OpenCode Zen and returns a `ModelError` (HTTP 401). The new default for `--tool agent` is now `minimax-m2.5-free`, matching the upstream fix in [agent PR #209](https://github.com/link-assistant/agent/pull/209).
  - `minimax-m2.5-free` is now the default model for `--tool agent`
  - `kimi-k2.5-free` is moved to the deprecated backward-compatibility section across all model maps
  - Updated `docs/FREE_MODELS.md` to reflect the new default and document `kimi-k2.5-free` as discontinued

## 1.26.3

### Patch Changes

- 864023d: Add case study and regression test for issue #1389: no `ready to merge` comment when `--auto-restart-until-mergeable` is enabled

  Documents root cause (checkForExistingComment searching all-time PR history in v1.25.7),
  timeline reconstruction from log b623ee9f, and confirms the fix from issue #1371 (in-memory
  readyToMergeCommentPosted flag) resolves the cross-session notification suppression.
  Adds test-ready-to-merge-cross-session-1389.mjs to prevent regression to the old approach.

## 1.26.2

### Patch Changes

- 72c933c: Skip empty Claude subsection headers when auth error occurs in /limits output

## 1.26.1

### Patch Changes

- 278415a: fix: post "Ready to merge" comment after auto-restart sequence with --auto-restart-until-mergeable (Issue #1371)

  When `--auto-restart-until-mergeable` was used after a regular auto-restart sequence (triggered by uncommitted changes), the "Ready to merge" comment was silently suppressed because `checkForExistingComment` found a matching comment from a previous `solve` run.

  The deduplication logic in `watchUntilMergeable` now uses an in-memory flag (`readyToMergeCommentPosted`) scoped to the current session, rather than searching all PR comment history. This correctly prevents duplicate comments within a single run while allowing new notifications when a fresh `solve` invocation starts.

## 1.26.0

### Minor Changes

- d96ae3b: feat: /merge command syncs ready tags between linked PRs and issues (Issue #1367)

  The `/merge` Telegram bot command now syncs the `ready` label between PRs and their linked issues before building the merge queue.
  - If a PR has the `ready` label and its body links to an issue via standard GitHub closing keywords (fixes/closes/resolves #N), the linked issue also gets the `ready` label
  - If an issue has the `ready` label and has a clearly linked open PR (found via body search), the PR also gets the `ready` label
  - Sync happens during `MergeQueueProcessor.initialize()`, before the final list of ready PRs is collected

## 1.25.8

### Patch Changes

- fix: update system messages to use authenticated curl for private GitHub issue images

  Images attached to GitHub issues/PRs (github.com/user-attachments/assets/\*) require authentication. Without auth, GitHub returns "Not Found" (9 bytes ASCII) with HTTP 200 — a silent failure. The AI would then call Read on the non-image file, encoding "Not Found" as base64, causing Anthropic API to return "Could not process image" (HTTP 400), crashing the session.

  Updated system messages in all 4 prompt files (claude, agent, codex, opencode) to explicitly identify user-attachments URLs as requiring GitHub authentication and provide the exact authenticated curl command using `gh auth token`.

  fix: auto-restart with --resume on "Request timed out" in --tool claude (Issue #1353)

  When Claude CLI encounters a network timeout, it exhausts its own internal retries and emits a synthetic result event: `{"type":"result","is_error":true,"result":"Request timed out","session_id":"..."}`. Previously hive-mind treated this as a fatal failure and exited, losing all session context (conversation history, cached tokens, partially completed work).

  This fix detects the timeout pattern and automatically retries with `--resume <session-id>` to preserve the session, using exponential backoff starting at 5 minutes (increasing to max 1 hour) — longer than regular API errors since Claude CLI has already exhausted its own retries before reporting the timeout.

## 1.25.7

### Patch Changes

- ad57ea6: fix: prevent false positive error detection when multi-line stderr chunks contain JSON warnings (Issue #1354)

  Previously, when Claude CLI emitted multiple JSON log lines in a single stderr chunk (newline-separated), the entire multi-line string was passed to `isStderrError()` as one unit. Since `JSON.parse()` would fail on two concatenated JSON objects, it fell through to keyword matching — finding words like `"failed"` inside warning messages — and incorrectly flagged a successful run as an error.

  Additionally, `messageCount === 0 && toolUseCount === 0` could fire even after a 60-turn successful session, because the counter only checked for `data.type === 'message'` but Claude CLI emits outer events as `"assistant"` type.

  Now the fix applies two targeted changes to `src/claude.lib.mjs`:
  1. **Split multi-line stderr chunks by newline** and check each line individually with `isStderrError()`, so valid JSON warning lines are correctly parsed and not conflated with error patterns.
  2. **Track `resultSuccessReceived`** when `data.type === 'result' && data.subtype === 'success'` is received, and add a `!resultSuccessReceived` guard to the false positive detection condition — ensuring a confirmed successful result prevents spurious error reporting.

  Full case study analysis including timeline reconstruction, root cause analysis, and evidence in `docs/case-studies/issue-1354/`.

## 1.25.6

### Patch Changes

- 5200c2a: Fix auto-restart spamming PR with comments when usage limit is reached (#1356)

  When the AI tool's usage limit is reached during --auto-restart-until-mergeable mode, the loop now:
  1. Detects the `limitReached` flag from the tool result
  2. Silently waits for the limit reset time plus a 10-minute buffer (no GitHub comment posted)
  3. Resumes the session using `--resume <sessionId>` with a "Continue" prompt, preserving context

  For non-limit tool failures, the loop now stops immediately instead of retrying, preventing infinite loops on unrecoverable errors.

## 1.25.5

### Patch Changes

- e0d68a4: fix: prevent false positive 'Ready to merge' for repos with CI but no required branch protection (Issue #1363)

  Previously, the auto-merge logic would incorrectly declare a PR "Ready to merge — no CI/CD configured" when a repository had GitHub Actions workflows but no required status checks in branch protection rules. This happened because:
  - `mergeStateStatus=CLEAN` (no required checks to block merging)
  - `check_runs=[]` (CI hadn't started yet — race condition, GitHub takes ~10-30s to register checks)

  The fix adds a workflow detection step (`getActiveRepoWorkflows`) that queries the GitHub Actions API to check if the repository has any active workflows. When workflows exist but no checks have started, the system now correctly identifies this as a race condition (CI hasn't started yet) rather than "no CI configured", and waits for the checks to appear before proceeding.

  Full case study analysis in `docs/case-studies/issue-1363/`.

## 1.25.4

### Patch Changes

- 2a670b0: fix: use universal GitHub blob URL format for screenshots to fix broken images in private repositories (Issue #1349)

  Previously, the system prompt instructed AI agents to embed screenshots using `raw.githubusercontent.com` URLs. These URLs always return HTTP 404 for private repositories because GitHub does not authenticate raw content requests when rendering PR description markdown.

  Now agents are instructed to use the `https://github.com/{owner}/{repo}/blob/{branch}/path?raw=true` URL format instead, which works for both public and private repositories. This simplifies the implementation by removing the need to check repository visibility at all.

## 1.25.3

### Patch Changes

- 0ed3ccb: fix: prevent --auto-restart-until-mergeable infinite loop when no CI/CD is configured (Issue #1345)

  Previously, when a repository had no GitHub Actions workflows configured, `--auto-restart-until-mergeable` would loop indefinitely because `getDetailedCIStatus()` returned `{ status: 'no_checks' }` and the code always treated this as a transient race condition (checks haven't started yet).

  Now the fix correctly handles the `no_checks` case by also checking `checkPRMergeable()`. If GitHub reports the PR as `MERGEABLE` (`mergeStateStatus: CLEAN`), the repository has no required CI checks and the process exits immediately with an appropriate message ("No CI/CD checks are configured for this repository — PR is mergeable"). If the PR is not yet mergeable, the existing wait behavior is preserved.

  Full case study analysis including timeline reconstruction from logs in `docs/case-studies/issue-1345/`.

## 1.25.2

### Patch Changes

- 0453550: feat: show all limits even when Claude authentication is expired (Issue #1343)

  Previously, when Claude authentication expired, the `/limits` command would fail completely and show no information at all.

  Now the command gracefully handles Claude auth failures:
  - The error message (e.g., "Claude authentication expired. Please use /solve or /hive commands to trigger re-authentication of Claude.") is shown inline in the Claude limits sections
  - All other limits sections (CPU, RAM, Disk space, GitHub API) continue to display normally

## 1.25.1

### Patch Changes

- 2a87d56: tests: expand unit tests for token accumulation logic (Issue #1313)

  Added comprehensive unit tests for the token accumulation fix (Issue #1250)
  that resolved the "Token usage: 0 input, 0 output" bug reported in Issue #1313.

  New test coverage includes:
  - End-to-end token display pipeline (accumulation → display format)
  - Large token count handling (millions of tokens across many steps)
  - NDJSON boundary cases (CRLF line endings, arrays, extra fields)
  - Accumulator state isolation (independent accumulators)
  - Exact reproduction of the Issue #1313 bug scenario
  - Demonstration of why the streaming fix was necessary (concatenated JSON)

  Total: 44 tests covering both `parseAgentTokenUsage` and streaming accumulation.

## 1.25.0

### Minor Changes

- cbac3dd: feat: wait for post-merge CI to complete before merging next PR (Issue #1341)

  This change ensures that the /merge command waits for GitHub Actions to complete after each merge before processing the next PR in the queue.

  **Problem:**
  - Merge queue was merging PRs too quickly (70 seconds apart)
  - Workflow runs were being cancelled (superseded by new commits)
  - Only one version published instead of multiple

  **Solution:**
  1. Check branch CI health before starting the queue
  2. Wait for post-merge CI after each successful merge
  3. Stop queue on CI failure (configurable)

  **New configuration options:**
  - `HIVE_MIND_MERGE_QUEUE_WAIT_FOR_POST_MERGE_CI` (default: true)
  - `HIVE_MIND_MERGE_QUEUE_STOP_ON_CI_FAILURE` (default: true)
  - `HIVE_MIND_MERGE_QUEUE_CHECK_BRANCH_HEALTH` (default: true)
  - `HIVE_MIND_MERGE_QUEUE_POST_MERGE_CI_TIMEOUT_MS` (default: 60 minutes)
  - `HIVE_MIND_MERGE_QUEUE_POST_MERGE_CI_POLL_INTERVAL_MS` (default: 30 seconds)

  **New API functions:**
  - `waitForCommitCI()` - Wait for workflow runs on a commit
  - `checkBranchCIHealth()` - Check for failed CI on a branch
  - `getMergeCommitSha()` - Get merge commit SHA for a PR

## 1.24.6

### Patch Changes

- Make `--auto-resume-on-limit-reset` enabled by default to improve user experience when hitting API rate limits. Previously defaulted to `false`, now defaults to `true` for both `solve` and `hive` commands. Users can explicitly disable with `--no-auto-resume-on-limit-reset` if needed.

  Fix false positive error detection for step_finish with reason stop

  When an agent encounters a timeout error during execution but successfully recovers and completes (indicated by `step_finish` with `reason: "stop"`), the error detection was incorrectly flagging this as a failure due to fallback pattern matching.

  The `agentCompletedSuccessfully` flag was only being set for `session.idle` and `"exiting loop"` log messages (Issue #1276), but not for the more common `step_finish` event with `reason: "stop"`. This meant the fallback pattern matching would still trigger and detect error patterns in the full output, even when the agent had clearly completed successfully.

  Fix: Add `step_finish` with `reason: "stop"` as a success marker in both stdout and stderr processing loops in `src/agent.lib.mjs`.

## 1.24.5

### Patch Changes

- 17317bb: fix: prevent false positive error detection for JSON-structured stderr warnings (Issue #1337)

  Claude Code SDK can emit structured JSON log messages to stderr with format `{"level":"warn","message":"..."}`. When these messages contained error-related keywords like "failed", the detection logic incorrectly flagged them as errors.

  Added JSON parsing for stderr messages starting with `{`. If the parsed JSON has a `level` field that is not `"error"` or `"fatal"`, the message is treated as a warning (non-error), preserving existing emoji-prefix detection as a fallback.

  Also enables `ANTHROPIC_LOG=debug` when running with `--verbose` flag, allowing users to see detailed API request information as suggested by the BashTool pre-flight warning.

## 1.24.4

### Patch Changes

- 40282f3: fix: escape '...' ellipsis in MarkdownV2 and retry on UNKNOWN merge state (Issue #1339)

  Two root causes fixed:
  1. **MarkdownV2 escaping**: In `formatProgressMessage()`, literal '...' was appended in PR titles, error messages, and overflow lines. Telegram's MarkdownV2 requires '.' to be escaped as '\.' - unescaped periods caused 400 Bad Request errors on every message update during CI wait.
  2. **UNKNOWN merge state**: GitHub computes PR mergeability asynchronously, so initial queries may return `mergeStateStatus: 'UNKNOWN'`. The old code immediately skipped PRs in this state. Fixed by adding retry logic to `checkPRMergeable()` that retries up to 3 times with 5-second delays before giving up.

## 1.24.3

### Patch Changes

- 297e07c: Fix incorrect iteration counter and duplicate comments in auto-restart mode
  - Fixed iteration counter to show actual AI restart count instead of check cycle number
  - Added deduplication check to prevent duplicate "Ready to merge" status comments
  - Added case study documentation for issue #1323

## 1.24.2

### Patch Changes

- a74e10c: fix: add auto-resume with session preservation on Internal Server Error (Issue #1331)

  When Claude tool returns `API Error: 500 Internal server error`, automatically retry with exponential backoff starting from 1 minute, capped at 30 minutes per retry, up to 10 retries. Session ID is preserved so Claude Code can resume from where it left off using `--resume <sessionId>`.

## 1.24.1

### Patch Changes

- 4b032ca: fix: use headRepository.name from PR data to construct fork name correctly

  Previously, when solving a PR from a fork where the fork's repository name
  differs from the base repository name, the tool incorrectly built the fork
  name using the base repo's name instead of the actual head repo name.

  Example failure scenario (Issue #1332):
  - Base repo: `konard/MILANA808-Milana-backend` (a fork itself)
  - PR head repo: `MILANA808/Milana-backend`
  - Tool tried: `MILANA808/MILANA808-Milana-backend` (wrong, 404)
  - Should try: `MILANA808/Milana-backend` (correct)

  The fix propagates `forkRepoName` (from `headRepository.name` in PR data)
  through the call chain: `solve.mjs` → `setupRepositoryAndClone` →
  `setupRepository`, where it's used as the correct source of truth for
  building fork repo names. Falls back to base repo name if unavailable.

  Also improves the error message when a fork cannot be found, clarifying
  that the fork name may differ from the base repo name.

## 1.24.0

### Minor Changes

- c93b8cd: Add support for Claude Sonnet 4.6 and set it as the default model for `--tool claude`
  - Added `claude-sonnet-4-6` as the new default model when using `sonnet` alias
  - Added `sonnet-4-6` short alias for explicit Sonnet 4.6 selection
  - Added backward compatibility aliases: `sonnet-4-5` and `claude-sonnet-4-5` for Sonnet 4.5
  - Added 1M token context window support for Sonnet 4.6 (`sonnet[1m]`, `sonnet-4-6[1m]`)
  - Maintained full backward compatibility with previous model versions

## 1.23.14

### Patch Changes

- 069d437: Parallelize version gathering with Promise.all for 6-30x performance improvement
  - Replaced sequential `execSync` calls with parallel `execAsync` using `Promise.all`
  - Reduced execution time from 30-150s to ~2-5s for version info gathering
  - Added support for all `--tool` options: agent, codex, opencode, qwen-code, gemini, copilot
  - Reorganized Telegram output to group tools by programming language instead of generic categories
  - Consolidated hive-mind version display to show single version with restart warning when process version differs from installed
  - Added `gatherTimeMs` metric to track performance

## 1.23.13

### Patch Changes

- af1f456: fix: suppress dotenvx MISSING_ENV_FILE warnings in hive-telegram-bot --version
  - Add early --version handling before loading dotenvx to avoid warnings
  - Add ignore: ['MISSING_ENV_FILE'] option to make .env file optional
  - Add tests for version output in tests/test-telegram-bot-version.mjs

## 1.23.12

### Patch Changes

- 50a69ae: Update free models: replace minimax-m2.1-free with minimax-m2.5-free

  OpenCode Zen:
  - Replace `minimax-m2.1-free` with `minimax-m2.5-free` (M2.1 no longer free)
  - Remove `glm-4.7-free` from recommended free models (no longer free)

  Kilo Gateway:
  - Add `glm-4.5-air-free` (agent-centric model)
  - Add `minimax-m2.5-free` (upgraded from M2.1)
  - Add `deepseek-r1-free` (advanced reasoning model)

  Breaking change: Users relying on `minimax-m2.1-free` or `glm-4.7-free` should switch to the updated models. Deprecated models are kept for backward compatibility but may not work.

## 1.23.11

### Patch Changes

- f1ba29d: Comprehensive CI/CD status handling for --auto-restart-until-mergeable mode
  - Detect when CI failures are caused by billing/spending limits via check run annotations
  - For private repositories: Post an explanatory comment and stop (requires human intervention)
  - For public repositories: Apply exponential backoff and wait (unusual case)
  - Distinguish between CI failure, cancelled, pending, queued, and billing limit states
  - Automatically re-trigger cancelled CI/CD workflow runs instead of restarting AI
  - Only restart AI when genuine code failures occur (not for cancelled/pending/billing)
  - Wait for all CI/CD checks to complete before deciding on AI restart
  - New functions: getDetailedCIStatus(), rerunWorkflowRun(), rerunFailedJobs(), getWorkflowRunsForSha()
  - Expanded test coverage: 45 tests covering all CI/CD status scenarios and decision logic

## 1.23.10

### Patch Changes

- cc57624: Add retry logic for fork validation network errors (Issue #1311). The validateForkParent function now retries up to 3 times with exponential backoff for transient network errors like TCP timeouts. Network errors now show a distinct error message with helpful retry suggestions instead of incorrectly reporting a fork parent mismatch.

## 1.23.9

### Patch Changes

- 4456760: Fix merge queue to wait for target branch CI before merging (Issue #1307). The merge queue now checks for active CI runs on the target branch (main) before processing the first PR in the queue. This prevents cancelled workflows, incomplete releases, and failed post-merge checks when multiple PRs are merged in quick succession.

## 1.23.8

### Patch Changes

- Fix spelling: rename --auto-restart-until-mergable to --auto-restart-until-mergeable throughout the codebase. This includes CLI options, function names, variable names, documentation, and code comments to use the correct English spelling.

  Increase limit reset buffer from 5 to 10 minutes and add random jitter (0-5 min) to avoid thundering herd problem when multiple instances wait for the same limit reset. Format reset time in PR comments with relative time and UTC timezone for better user understanding.

## 1.23.7

### Patch Changes

- d951635: Fix --auto-restart-until-mergeable false positive on empty CI checks

  The `--auto-restart-until-mergeable` mode was incorrectly posting "Ready to merge" when CI checks hadn't started yet. This was caused by JavaScript's vacuous truth: `[].every(fn)` returns `true`, so an empty checks array would pass all validation.

  Fix: Return `pending` status when no CI checks exist yet, instead of `success`.

## 1.23.6

### Patch Changes

- 0a7dbcf: Add exponential backoff retry when bot launch fails with 409 Conflict error (e.g., due to restart overlap, stale connections, or network issues). Retry schedule: 1s, 2s, 4s, ... up to 10 minutes max. Non-retryable errors (401 Unauthorized) still cause immediate exit.

## 1.23.5

### Patch Changes

- 28b7f22: Add code duplication detection with jscpd
  - Add .jscpd.json configuration for JavaScript code duplication detection
  - Add jscpd (^4.0.5) as devDependency
  - Add npm script: `npm run check:duplication`
  - Integrate code duplication check into CI workflow
  - Set 11% threshold baseline (current codebase level)

## 1.23.4

### Patch Changes

- 22a1940: fix: display skip/fail reasons in merge queue Telegram messages (#1294)

  Previously, when PRs were skipped or failed during merge queue processing, the Telegram message only showed the PR number without explaining why it was skipped. This left users unable to understand what action was required to resolve the issue.

  Now the merge queue displays the reason for each skipped or failed PR in both:
  - Progress messages (during processing)
  - Final report messages (after completion)

  Example output:

  ```
  Results:
  ⏭️ #1241 (Issue #1240): PR has merge conflicts
  ⏭️ #1257 (Issue #1256): PR has merge conflicts
  ```

  This change follows UX best practices for error messages by:
  - Showing the specific reason for each failure
  - Using clear, human-readable language
  - Helping users understand what action is needed

## 1.23.3

### Patch Changes

- a797e56: fix: escape owner/repo names for Telegram MarkdownV2 in /merge command

  Fixed the `/merge` command silently failing when updating Telegram messages for repositories with hyphens in their names (e.g., `link-assistant/hive-mind`). The issue was caused by unescaped special characters in MarkdownV2 format.

## 1.23.2

### Patch Changes

- 241ce36: Fix false error categorization and missing log upload for `--tool agent` auto-restart
  - Fix `isUsageLimitError()` "resets" pattern causing false positives when scanning code output
    - Changed from substring match to regex that requires time-like content after "resets"
    - Prevents ordinary English words like "loads a shell and resets" from triggering usage limit detection
  - Fix agent fallback pattern matching running after agent successfully recovered from errors
    - Skip fallback when exitCode=0 and agentCompletedSuccessfully to prevent false error detection
  - Upload failure logs when auto-restart iteration fails for `--tool agent` with `--attach-logs`
  - Add comprehensive tests for false positive scenarios (Issue #1290)

## 1.23.1

### Patch Changes

- 5c635fc: Fix agent tool error handling: upload failure logs to PR even when sessionId is not available
  - Remove overly strict sessionId requirement for failure log upload in solve.mjs
  - Add FreeUsageLimitError pattern detection for Agent/OpenCode Zen rate limits
  - Improve rate limit detection by checking multiple sources (lastMessage, errorMatch, fullOutput)
  - Add comprehensive case study documentation for issue #1287
  - Add tests for FreeUsageLimitError detection

## 1.23.0

### Minor Changes

- 7a74bc6: Add Kilo Gateway free models support for --tool agent

  This release adds support for 6 free models from Kilo Gateway:
  - `kilo/glm-5-free` - Z.AI flagship model (free for limited time)
  - `kilo/glm-4.7-free` - Z.AI agent-centric model
  - `kilo/kimi-k2.5-free` - MoonshotAI agentic model
  - `kilo/minimax-m2.1-free` - MiniMax general-purpose model
  - `kilo/giga-potato-free` - Evaluation model
  - `kilo/trinity-large-preview` - Arcee AI preview model

  Short aliases are also supported (e.g., `glm-5-free`, `kilo-glm-4.7-free`).

  Usage:

  ```bash
  solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
  /solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
  ```

  See docs/FREE_MODELS.md for comprehensive documentation.

  Fixes #1282

## 1.22.6

### Patch Changes

- ed87517: Fix: Add workaround for process stream hanging after completion (Issue #1280)

  After the Claude CLI sends the final result event, the `for await` loop over
  `command-stream`'s `stream()` can hang indefinitely. Root cause: `command-stream` v0.9.4's
  `stream()` async iterator waits for both process exit AND stdout/stderr pipe close before
  ending. If the CLI process keeps stdout open after sending the result, `pumpReadable()` hangs,
  `finish()` never fires, and the stream iterator never terminates.

  Additionally, `command-stream` v0.9.4 `stream()` does NOT yield `{type:'exit'}` chunks,
  making the exit code detection via `chunk.type === 'exit'` dead code (exit code is obtained
  from `execCommand.result.code` after the loop instead).

  Workaround: after receiving the result event, start a configurable timeout (default 30s,
  `HIVE_MIND_RESULT_STREAM_CLOSE_MS`) to force-kill the process with SIGTERM/SIGKILL.

  Related: https://github.com/link-foundation/command-stream/issues/155

## 1.22.5

### Patch Changes

- fdd8eaa: Fix auto-merge failure in fork mode with permission pre-check (Issue #1226)
  - Add fork-mode guard in `startAutoRestartUntilMergeable()` to detect when `--auto-merge` cannot work
  - Add `checkMergePermissions()` function to verify write/push/admin/maintain access before merge attempts
  - Add permission pre-check in `attemptAutoMerge()` to fail fast when user lacks write access
  - Post "Ready to merge" comment to PR when auto-merge cannot be performed due to permissions
  - Prevent silent failures and infinite restart loops in fork mode scenarios

## 1.22.4

### Patch Changes

- 2204f18: Fix workflow cancellation blocking by replacing always() with !cancelled() in Docker jobs (Issue #1278)
  - Replace `always()` with `!cancelled()` in all Docker publish and Helm release job conditions
  - Allow concurrency cancellation to properly interrupt Docker builds when new commits are pushed
  - Reduce Docker job timeout from 60 to 30 minutes to minimize blocking time
  - Fix issue where PR merges to main branch did not trigger releases due to stuck workflow runs

## 1.22.3

### Patch Changes

- 34a6937: Fix false positive error detection when agent recovers from transient errors (Issue #1276)
  - Trust exit code 0 as authoritative indicator of success even if errors occurred during execution
  - Clear streaming error detection when agent completes successfully (emits session.idle or "exiting loop")
  - Fix message extraction to prefer "error" field over "message" field for agent error events
  - Add tests for agent recovery scenarios and false positive prevention

## 1.22.2

### Patch Changes

- 5b018dc: fix: prevent CI/CD release blocking by enabling cancel-in-progress for main branch (Issue #1274)

  When multiple commits are pushed to main quickly (e.g., multiple PRs merged in succession),
  the old concurrency configuration would queue newer runs indefinitely until older runs complete.
  This caused releases to be blocked when Docker ARM64 builds took too long.

  Changes:
  - Add `cancel-in-progress: true` for main branch to allow newer releases to proceed
  - PR branches still queue runs to avoid cancelling checks during development
  - Document the issue and solution in docs/case-studies/issue-1274/

## 1.22.1

### Patch Changes

- fix: add --merge flag to gh pr merge command to prevent "not running interactively" error (Issue #1269)

  The merge queue was stuck because `gh pr merge` requires an explicit merge method flag
  (`--merge`, `--squash`, or `--rebase`) when running in a non-interactive context.
  Without a merge method, the command would fail with:
  "--merge, --rebase, or --squash required when not running interactively"

  This fix:
  - Adds `--merge` flag by default to the `mergePullRequest()` function
  - Adds `mergeMethod` option to configure the merge strategy ('merge', 'squash', 'rebase')
  - Adds `HIVE_MIND_MERGE_QUEUE_MERGE_METHOD` environment variable for configuration

  Fix release notes to show ALL related pull requests when multiple PRs are merged before a release (Issue #1271)
  - Extract ALL commit hashes from changelog entry (not just the first one)
  - Look up PRs for each commit hash via GitHub API
  - Display all unique PR numbers in release notes (e.g., "Related Pull Requests: #1268, #1270")
  - Use plural "Pull Requests" label when multiple PRs are found
  - Add comprehensive case study documentation in docs/case-studies/issue-1271/

## 1.22.0

### Minor Changes

- c000f7b: Add `--attach-solution-summary` and `--auto-attach-solution-summary` options

  This feature allows users to automatically attach the AI's result summary as a PR/issue comment:
  - `--attach-solution-summary`: Always attach the solution summary when available
  - `--auto-attach-solution-summary`: Only attach the summary if the AI didn't create any comments during the session

  The solution summary is extracted from the JSON output stream of all AI tools (claude, agent, codex, opencode). Each tool captures the last text content from various JSON event types (text, assistant, message, result) to provide a summary of the work done.

  Fixes #1263

## 1.21.4

### Patch Changes

- ea19c72: Fix queue issues: rejection, display, and formatting
  - Fix disk rejection not blocking queue placement when threshold exceeded
  - Restore "used" label on progress bars when below threshold
  - Show per-queue breakdown in /limits command
  - Group queue items by tool and use human-readable time in /solve_queue

- aa42f3a: fix: improve merge queue error handling and debugging (Issue #1269)
  - Always log errors (not just in verbose mode) for critical merge queue failures
  - Always notify users via Telegram when merge queue fails unexpectedly
  - Add timeout wrapper (60s) for onStatusUpdate callback to prevent infinite blocking
  - Add error handling for CI check failures in waitForCI loop
  - Add comprehensive case study documentation in docs/case-studies/issue-1269/

## 1.21.3

### Patch Changes

- 4426112: Fix error detection for `--tool agent` when JSON errors are pretty-printed (Issue #1258)
  - Add fallback pattern matching for error events when NDJSON parsing fails
  - Detect `"type": "error"` and `"type": "step_error"` patterns in raw output
  - Detect critical error patterns like `AI_RetryError` and `UnhandledRejection`
  - Extract error messages from output for better error reporting

## 1.21.2

### Patch Changes

- 586b84d: Add retry mechanism for GitHub 500 errors during repository clone

  This change adds intelligent retry logic with exponential backoff to handle transient GitHub server errors during repository cloning operations.

## 1.21.1

### Patch Changes

- fbfc0c3: Fix `--tool agent` pricing display for free models (Issue #1250)
  - Add base model pricing lookup for free model variants (e.g., `kimi-k2.5-free` → `kimi-k2.5`)
  - Show actual market price as "Public pricing estimate" based on the underlying paid model
  - Display base model reference in cost output: "(based on Moonshot AI kimi-k2.5 prices)"
  - Distinguish between truly free models and free access to paid models
  - Fix token usage showing "0 input, 0 output" by accumulating tokens during streaming
  - Token accumulation now happens in real-time as step_finish events arrive, avoiding NDJSON concatenation issues

## 1.21.0

### Minor Changes

- 6cf54b7: Add configurable queue threshold strategies (reject, enqueue, dequeue-one-at-a-time)
  - Add three handling strategies for each queue threshold:
    - `reject`: Immediately reject the command, no queueing
    - `enqueue`: Block and wait in queue until metric drops
    - `dequeue-one-at-a-time`: Allow one command, block subsequent
  - Support configuration via `HIVE_MIND_QUEUE_CONFIG` environment variable (links notation format)
  - Support individual strategy env vars (e.g., `HIVE_MIND_DISK_STRATEGY`)

  **Breaking change:** Disk threshold default strategy changed from `dequeue-one-at-a-time` to `reject`
  because the queue is lost on server restart. To restore old behavior: `HIVE_MIND_DISK_STRATEGY=dequeue-one-at-a-time`

## 1.20.1

### Patch Changes

- 1689caf: Fix agent tool pricing display to show correct provider
  - Add proper model mapping for free models (kimi-k2.5-free, gpt-4o-mini, etc.)
  - Add getProviderName helper function to detect provider from model ID
  - Prioritize provider from model ID over API response to fix issue #1250
  - Display correct provider names: Moonshot AI, OpenAI, Anthropic instead of generic "OpenCode Zen"

## 1.20.0

### Minor Changes

- 98a7582: Set kimi-k2.5-free as default model for --tool agent and enhance documentation with free model examples.

## 1.19.0

### Minor Changes

- 64687ce: Add support and documentation for free AI models:
  - Added support for opencode/big-pickle, opencode/gpt-5-nano, opencode/kimi-k2.5-free, opencode/glm-4.7-free, opencode/minimax-m2.1-free
  - Updated model mapping and validation to handle free models
  - Created comprehensive documentation in FREE_MODELS.md
  - Added tests for all free model support
  - Created case study analysis for issue #1244

## 1.18.0

### Minor Changes

- 6b7f026: Add threshold markers to /limits command progress bars

  This change implements visual threshold markers in the progress bars displayed by the /limits command. Users can now see:
  - **Threshold position marker (│)**: Shows where queue behavior changes (e.g., blocking, one-at-a-time mode)
  - **Warning emoji (⚠️)**: Appears when usage exceeds the threshold

  Thresholds displayed:
  - RAM: 65% (blocks new commands)
  - CPU: 65% (blocks new commands)
  - Disk: 90% (one-at-a-time mode)
  - Claude 5-hour session: 65% (one-at-a-time mode)
  - Claude weekly: 97% (one-at-a-time mode)
  - GitHub API: 75% (blocks parallel claude commands)

  Example output:

  ```
  CPU
  ▓▓▓▓▓▓▓░░░░░░░░░░░░│░░░░░░░░░░ 25%
  0.04/6 CPU cores used

  Claude 5 hour session
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓ 98% ⚠️
  Resets in 2h 10m (Dec 6, 12:00pm UTC)
  ```

  Fixes #1242

## 1.17.2

### Patch Changes

- ae013b3: Default thinking budget to zero (thinking disabled by default), align Opus 4.6 max thinking budget with standard models (31999), change `opus` alias to map to Opus 4.5 by default (supports both `opus-4-5` and `opus-4-6` aliases)

## 1.17.1

### Patch Changes

- 0e59647: Fix /solve-queue command: register /solve_queue handler, fix hint text to use underscore instead of hyphen (Telegram Bot API only supports underscores in command names)

## 1.17.0

### Minor Changes

- 52cef77: feat: automatic solve option forwarding from hive config (issue #1209)

  Refactored hive-to-solve option forwarding to be fully automatic. New solve options are now
  automatically available in hive and TELEGRAM_HIVE_OVERRIDES without manual code changes.
  - Extracted `SOLVE_OPTION_DEFINITIONS` from solve.config.lib.mjs as a shared data structure
  - hive.config.lib.mjs auto-registers all solve options (minus hive-only and solve-only exclusions)
  - hive.mjs uses a generic forwarding loop instead of per-option if statements
  - Added `getSolvePassthroughOptionNames()` export for programmatic access to passthrough list

## 1.16.1

### Patch Changes

- f596d3e: Fix branch checkout failure when PR is from fork with different naming convention

## 1.16.0

### Minor Changes

- 5f78253: Add Claude Opus 4.6 model support with [1m] suffix
  - `opus` alias now defaults to `claude-opus-4-6` (latest and most capable Opus model)
  - Added shorter version aliases: `opus-4-6`, `opus-4-5`, `sonnet-4-5`, `haiku-4-5`
  - Added `claude-haiku-4-5` alias for consistency
  - `[1m]` suffix enables 1 million token context window for supported models
  - Opus 4.6 gets 128K max output tokens and 64K thinking budget
  - Backward compatibility: `claude-opus-4-5` maps to `claude-opus-4-5-20251101`

## 1.15.2

### Patch Changes

- 5723a93: fix: prevent early exit when --auto-merge flag is used

  The `verifyResults()` function was calling `safeExit(0)` before the auto-merge logic could run. This caused the `--auto-merge` flag to be silently ignored. Now the exit condition properly checks for `argv.autoMerge|autoRestartUntilMergeable` and `argv.autoMerge|autoRestartUntilMergeable` flags.

## 1.15.1

### Patch Changes

- docs: Expand auto-cleanup case study with 9 additional solutions (Issue #912)

  Expanded the case study analysis from 6 to 15 solutions covering:
  - OOM protection (earlyoom, systemd-oomd, OOM score tuning)
  - Resource isolation (cgroups via systemd)
  - Log management (logrotate)
  - Process monitoring (Monit, Supervisord)
  - Event-driven cleanup (incron)
  - Resource watchdog scripts
  - Kubernetes liveness probes and resource limits

  Added tiered recommendation system (Essential, Recommended, Advanced) and updated implementation guide with steps for earlyoom, OOM score tuning, cgroup limits, and logrotate configuration.

  Extract message filter functions to testable module with 34 unit tests for message recognition pipeline (issue #1207)

## 1.15.0

### Minor Changes

- c5dad3c: feat: add --auto-restart-on-non-updated-pull-request-description option (Issue #1162)

  When using `--tool agent` mode, the pull request title and description could remain
  in their initial WIP placeholder state. This adds an opt-in `--auto-restart-on-non-updated-pull-request-description`
  flag that detects placeholder content after agent execution and auto-restarts with a
  short factual hint. Also adds gentle checklist suggestions to agent/opencode/codex prompts
  (excluding Claude, which handles PR updates naturally).

## 1.14.2

### Patch Changes

- 69a34a6: fix: NDJSON stream buffering for Claude CLI output (Issue #1183)

  Fixed issue where `total_cost_usd` and other critical fields were not being captured from Claude CLI sessions when the output JSON was split across multiple stdout chunks.

  **Root Cause**: Claude CLI outputs NDJSON (newline-delimited JSON) format, but long JSON messages (like the `result` type containing `total_cost_usd`) can be split across multiple stdout buffer chunks. The code was splitting each chunk by newlines and parsing independently, causing partial JSON fragments to fail parsing.

  **Solution**:
  - Implemented line buffering to accumulate incomplete lines across chunks
  - Lines are only parsed when they're complete (have a trailing newline)
  - Added processing of any remaining buffer content after the stream ends

  This ensures that even very long JSON output (e.g., result messages with extensive usage data) is properly parsed and cost tracking works correctly.

  **Evidence from logs**: The broken session showed JSON truncated mid-word at `ephemeral_5m_input_tok` continuing on the next line with `ens":97252}}` - making both lines unparseable.

## 1.14.1

### Patch Changes

- b139b00: fix: detect agent tool errors during streaming for reliable failure detection (Issue #1201)

  Previously, agent tool errors (`"type": "error"`) could be missed when the post-hoc
  detection function failed to parse NDJSON lines that were concatenated without newline
  delimiters. Now errors are detected inline during stream processing, ensuring
  `"type": "error"` events always trigger a failure exit regardless of output buffering.

## 1.14.0

### Minor Changes

- 3a48254: Add configurable experiments/examples folder paths with ability to disable

  New CLI options for both `solve` and `hive` commands:
  - `--prompt-experiments-folder <path>`: Path to experiments folder used in system prompt. Set to empty string to disable experiments folder prompt. Default: `./experiments`
  - `--prompt-examples-folder <path>`: Path to examples folder used in system prompt. Set to empty string to disable examples folder prompt. Default: `./examples`

  Features:
  - Backwards compatible: defaults to `./experiments` and `./examples` as before
  - Custom paths: Specify custom folder paths for experiments and examples
  - Disable functionality: Set to empty string (`''`) to disable the experiments/examples prompt section entirely
  - Works with all AI tools: claude, opencode, codex, and agent

## 1.13.0

### Minor Changes

- 03adcb6: Add --auto-merge and --auto-restart-until-mergeable options for autonomous PR management

  New CLI options:
  - `--auto-merge`: Automatically merge the pull request when CI passes and PR is mergeable. Implies --auto-restart-until-mergeable.
  - `--auto-restart-until-mergeable`: Auto-restart the AI agent until PR becomes mergeable (no iteration limit). Restarts on new comments from non-bot users, CI failures, merge conflicts, or uncommitted changes. Does NOT auto-merge.

  Features:
  - Non-bot comment detection with configurable bot patterns
  - Automatic detection of CI/CD status and merge readiness
  - Continuous monitoring loop with configurable check intervals
  - Progress and status reporting throughout the process
  - Graceful handling of API errors with exponential backoff
  - Session data tracking for accurate pricing across iterations

## 1.12.0

### Minor Changes

- 8393f99: Improve auto-resume-on-limit-reset functionality
  - Add 5-minute buffer after limit reset to account for server time differences (configurable via HIVE_MIND_LIMIT_RESET_BUFFER_MS)
  - Add --auto-restart-on-limit-reset option for fresh start without previous session context
  - Remove CLI commands from GitHub comments when auto-resume is active (less confusing for users)
  - Differentiate work session comments: "Auto Resume (on limit reset)" vs "Auto Restart (on limit reset)"
  - Differentiate solution draft log comments based on session type
  - Improve reset time formatting with relative time + UTC (e.g., "in 1h 23m (Jan 15, 7:00 AM UTC)")

## 1.11.6

### Patch Changes

- 5eef9e4: Skip Claude API limits for --tool agent tasks in queue
  - Agent tools (Grok Code, OpenCode Zen) use different backends with their own rate limits
  - Add tool parameter to canStartCommand() and checkApiLimits() functions
  - Skip Claude-specific limits (5-hour session, weekly) when tool is 'agent'
  - Consumer loop now passes next queue item's tool to limit checks
  - Add 7 new tests for tool-specific limit handling
  - Add case study documentation

  Fixes #1159

## 1.11.5

### Patch Changes

- 7d3387c: Fix duplicate Solution Draft Log comments on GitHub PRs

  When a Claude session ends with uncommitted changes and --attach-logs is enabled, the solution draft log was being uploaded twice - once by verifyResults() during normal completion, and again after temporary watch mode completes. This fix tracks whether logs were already uploaded and skips the duplicate upload.

## 1.11.4

### Patch Changes

- b8318dd: fix: support opencode/gpt-5-nano and gpt-5-nano for --tool agent (Issue #1185)

  Fixed AGENT_MODELS mapping to correctly support free OpenCode Zen models:
  - `gpt-5-nano` short alias now correctly maps to `opencode/gpt-5-nano` (previously incorrectly mapped to `openai/gpt-5-nano`)
  - `opencode/gpt-5-nano` full model ID is now recognized as valid
  - Updated `mapModelToId` function in agent.lib.mjs to use correct provider prefix
  - Fixed regex filter in `getAvailableModelNames` to include `gpt-5-nano` in available models display
  - Added comprehensive test suite with 18 tests for agent model validation
  - Added case study documentation with root cause analysis

## 1.11.3

### Patch Changes

- 9f24356: Fix 'ready' label not being created by /merge command

  Two bugs prevented the /merge command from creating the 'ready' label:
  1. `checkReadyLabelExists()` incorrectly treated GitHub API's 404 JSON error response as the label existing. The function now properly checks for "Not Found" message in the response.
  2. `createReadyLabel()` used bash-specific heredoc syntax (`<<<`) which fails in `/bin/sh`. Now uses `gh api -f` flags for shell compatibility.

  Fixes #1177

## 1.11.2

### Patch Changes

- 8ee116a: fix: detect "command not found" errors to prevent false success

  When the `claude` CLI command is not found (not installed or not in PATH), the tool was incorrectly reporting "Claude command completed" instead of detecting the failure. This fix adds "not found" to the stderr error detection pattern to properly detect when commands fail to start.

## 1.11.1

### Patch Changes

- de2cc28: Use .gitkeep by default for --tool agent/opencode/codex instead of CLAUDE.md

  When using non-Claude tools (agent, opencode, codex), the system now defaults to creating a `.gitkeep` file for task details instead of `CLAUDE.md`. This prevents pollution of CLAUDE.md, which has special meaning for Claude Code as a project-level instruction file.

  **Tool-Specific Defaults:**
  - `--tool claude`: defaults to `--claude-file` (existing behavior)
  - `--tool agent/opencode/codex`: defaults to `--gitkeep-file`

  Users can still explicitly override defaults with `--claude-file` or `--gitkeep-file` flags regardless of the selected tool.

## 1.11.0

### Minor Changes

- ca28333: Add system prompt guidance for visual UI work when model supports vision

  **Changes:**
  - Add `checkModelVisionCapability` function in claude.lib.mjs to detect if a model supports image input using models.dev API
  - Add vision-specific system prompt section in claude.prompts.lib.mjs and agent.prompts.lib.mjs
  - When model supports vision, add guidance for including screenshots/renders of visual UI changes in pull request descriptions
  - Use "When x, do y." style as requested

  **Vision prompt guidance includes:**
  - When working on visual UI changes, include a render or screenshot in the PR description
  - When showing visual results, save screenshots to the repository (e.g., docs/screenshots/)
  - When referencing images, use permanent raw file links in the PR description markdown
  - When uploading images, commit them first, then use raw GitHub URL format
  - When the visual result is important, mention it explicitly with embedded image

  **Technical details:**
  - Uses models.dev API to check if 'image' is in the model's input modalities
  - All current Claude models (opus, sonnet, haiku) support vision
  - Gracefully handles unknown models by returning false

  Fixes #1175

## 1.10.2

### Patch Changes

- e1ed8fc: fix: enable large log file uploads using gh-upload-log (issue #1173)
  - Remove premature 25MB size check that incorrectly rejected large log files
  - Files larger than 25MB now use gh-upload-log which can handle any size
  - Default to private visibility when repository visibility cannot be determined (safer for private repos)
  - Add case study documentation for issue #1173

## 1.10.1

### Patch Changes

- 24e70f8: Fix agent --verbose output by properly handling stderr stream
  - Agent CLI sends ALL output (including verbose logs and structured events) to stderr, not stdout
  - Previous code only processed stdout with JSON parsing, treating stderr as plain error text
  - Now stderr is processed the same way as stdout: NDJSON line-by-line parsing with JSON formatting
  - Session IDs are now correctly extracted from stderr messages
  - stderr output is now collected for error detection

  Fixes #1151

## 1.10.0

### Minor Changes

- 9b56b26: feat(solve): configure MCP_TIMEOUT and MCP_TOOL_TIMEOUT for claude tool calls

  Added MCP timeout configuration to prevent tool calls from hanging indefinitely:
  - Added `mcpTimeout` config (default: 900000ms / 15 minutes) for MCP server startup
  - Added `mcpToolTimeout` config (default: 900000ms / 15 minutes) for MCP tool execution
  - Support for override via `MCP_TIMEOUT`/`HIVE_MIND_MCP_TIMEOUT` and `MCP_TOOL_TIMEOUT`/`HIVE_MIND_MCP_TOOL_TIMEOUT` environment variables
  - Updated `getClaudeEnv()` to pass both timeout values to Claude CLI
  - Added verbose logging for MCP timeout values

  Fixes #1066

## 1.9.2

### Patch Changes

- d39bf3e: Fix disk threshold to use one-at-a-time mode instead of blocking all commands
  - When disk usage exceeds threshold (90%), now allows exactly one command to run
  - Previously, disk threshold blocked ALL commands unconditionally (like RAM/CPU)
  - Now matches behavior of Claude API thresholds (CLAUDE_5_HOUR_SESSION_THRESHOLD, CLAUDE_WEEKLY_THRESHOLD)
  - Allows controlled task execution during high disk usage while preventing multiple tasks from exhausting resources

  Fixes #1155

## 1.9.1

### Patch Changes

- 06da02c: Improve /accept_invites command output with grouped items and real-time updates

  **Changes:**
  - Group output by "Repositories:" and "Organizations:" instead of repeating "Repository:" for each item
  - Add clickable GitHub links for each repository and organization
  - Implement real-time message updates after each invitation is processed
  - Show progress indicator (e.g., "Processing GitHub Invitations (3/10)") during processing

  Fixes #1148

## 1.9.0

### Minor Changes

- e15f307: Add bidirectional translation between --think and --thinking-budget options for Claude Code

  **Changes:**
  - Add 'off' option to --think values: ['off', 'low', 'medium', 'high', 'max']
  - Add --thinking-budget-claude-minimum-version option (default: 2.1.12)
  - For Claude Code >= 2.1.12: translate --think to --thinking-budget (off→0, low→8000, medium→16000, high→24000, max→31999)
  - For Claude Code < 2.1.12: translate --thinking-budget back to --think thinking keywords
  - Both options now coexist and support all Claude Code versions

  **Rationale:**
  Claude Code v2.1.12+ no longer responds to thinking keywords (think, think hard, ultrathink) because extended thinking is enabled by default. The only way to control thinking budget programmatically is via MAX_THINKING_TOKENS environment variable.

  Fixes #1146

## 1.8.0

### Minor Changes

- 53e1686: Add experimental /merge command to hive-telegram-bot for sequential PR merging
  - New `/merge <repository-url>` command to process merge queues
  - Automatically checks/creates 'ready' label in repository
  - Merges PRs with 'ready' label sequentially (oldest first)
  - Waits for CI/CD completion between each merge
  - Includes `/merge_cancel` and `/merge_status` helper commands
  - Supports linking issues to PRs (uses minimum creation date for ordering)

## 1.7.2

### Patch Changes

- e6a656f: Use `screen -R` instead of `screen -S` and `screen -r` in all docs and code for better session management. The `-R` flag ensures we open existing screen if created, and new if not yet created, making it the most safe and universal option.

## 1.7.1

### Patch Changes

- d86ba79: Prevent duplicate URLs from being added to the /solve queue (Issue #1080)
  - Added `findByUrl()` method to SolveQueue to detect existing items by URL
  - Updated /solve command handler to check for duplicates before queueing
  - Uses normalized URLs for consistent comparison
  - Returns informative error message when duplicate is detected

## 1.7.0

### Minor Changes

- 5794e2f: Add `--working-directory` / `-d` option for proper session resume

  Claude Code stores sessions per-directory path, so resuming a session in a different directory fails. This change:
  1. Adds `--working-directory` / `-d` option to solve.mjs
     - If directory exists with git repo, uses it without cloning
     - If directory exists but empty, clones into it
     - If directory doesn't exist, creates it and clones
  2. Updates `--auto-resume-on-limit-reset` to pass `--working-directory`
     - When limit resets and session auto-resumes, it uses the same directory as the original session
     - This ensures Claude Code can find and resume the session
  3. Improves resume error messaging
     - Warns when resuming without --working-directory
     - Explains that Claude Code sessions are tied to directory paths

  Example usage:

  ```bash
  ./solve.mjs "<url>" --resume <session-id> --working-directory /tmp/gh-issue-solver-123
  ```

## 1.6.3

### Patch Changes

- Fix Anthropic cost extraction from JSON stream when session has error_during_execution
  - Added anthropicTotalCostUSD to all failure return paths in executeClaudeCommand
  - Changed cost capture logic to only extract from `subtype === 'success'` results
  - This is explicit and reliable - error_during_execution results have zero cost
  - Added case study documentation for issue #1104

  Fixes #1104

  Synchronize line count checks in CI/CD
  - Add ESLint max-lines rule (1500 lines) to match CI workflow check
  - Extract handleClaudeRuntimeSwitch to claude.runtime-switch.lib.mjs
  - Reduce claude.lib.mjs from 1506 to 1354 lines
  - Add case study documentation for issue #1141

  Fixes #1141

## 1.6.2

### Patch Changes

- 4ccbbd7: Fix CLAUDE_WEEKLY_THRESHOLD not enforcing one-at-a-time mode when external Claude processes are running
  - Fixed oneAtATime mode to also consider externally running Claude processes (detected via pgrep), not just queue-internal processing
  - Standardized all threshold comparisons to use >= (inclusive) instead of mixed > and >= operators
  - Updated documentation comments to accurately reflect inclusive threshold behavior
  - Added README recommendation to capture bot logs using tee for post-incident analysis
  - Added case study documentation for issue #1133

## 1.6.1

### Patch Changes

- b07fa91: Improve /limits output format for better clarity and consistency: use 5m load average for CPU calculation (matching /solve queue), show CPU cores as "X.XX/Y CPU cores used" format consistent with RAM and Disk display

## 1.6.0

### Minor Changes

- 56d95bd: Add `--prompt-subagents-via-agent-commander` option to guide Claude to use agent-commander CLI for subagent delegation instead of native Task tool. This allows using any supported agent type (claude, opencode, codex, agent) with a unified API and saves main agent context. The prompt guidance is only included when agent-commander (start-agent) is actually installed on the system.

## 1.5.0

### Minor Changes

- 2d41edb: Add /accept_invites command to Telegram bot for automatically accepting GitHub repository and organization invitations via gh CLI

## 1.4.0

### Minor Changes

- 4a476ae: Add separate log comment for each auto-restart session with cost estimation
  - Each auto-restart iteration now uploads its own session log with cost estimation to the PR
  - Log comments use "Auto-restart X/Y Log" format instead of generic "Solution Draft Log"
  - Issue #1107

### Patch Changes

- 3239fa1: Add git identity validation to prevent commit failures
  - Added `checkGitIdentity()` and `validateGitIdentity()` functions to validate git user configuration
  - Added git identity check to `performSystemChecks()` that runs before any work begins
  - Added `--auto-gh-configuration-repair` option that uses external `gh-setup-git-identity` command for automatic repair
  - Added unit tests for identity validation

  This fix prevents the "fatal: empty ident name" error that occurs when git user.name and user.email are not configured. When git identity is missing, users now see a clear error message with instructions for fixing it. The auto-repair feature requires the external [gh-setup-git-identity](https://github.com/link-foundation/gh-setup-git-identity) package to be installed.

## 1.3.0

### Minor Changes

- a403c0e: Add --auto-gitkeep-file option to automatically fallback to .gitkeep when CLAUDE.md is in .gitignore

  This feature pre-checks if CLAUDE.md would be ignored by .gitignore BEFORE creating the file, preventing the "paths are ignored by one of your .gitignore files" error. When detected, automatically switches to .gitkeep mode. Enabled by default (--auto-gitkeep-file=true).

## 1.2.11

### Patch Changes

- 8404b75: fix: Support weekly limit date parsing in extractResetTime and parseResetTime
  - Added Pattern 0 to extractResetTime() to handle date+time formats like "resets Jan 15, 8am"
  - Updated parseResetTime() to parse date+time strings with month name and day
  - This ensures weekly limit messages are displayed with the "Usage Limit Reached" format

## 1.2.10

### Patch Changes

- 7ba1476: Auto-cleanup .playwright-mcp/ folder to prevent false auto-restart triggers
  - Add auto-cleanup of .playwright-mcp/ folder before checking uncommitted changes
  - Add --playwright-mcp-auto-cleanup option (enabled by default)
  - Use --no-playwright-mcp-auto-cleanup to disable cleanup for debugging
  - Add comprehensive case study documentation for issue #1124

## 1.2.9

### Patch Changes

- b5e047a: Fix branch checkout error showing null/null instead of actual repository URL
  - Pass owner/repo/prNumber to branch error handlers for accurate error messages
  - Add upstream remote fallback when PR branch not found in origin (handles bot PRs)
  - Add case study documentation for issue #1120

## 1.2.8

### Patch Changes

- Add case study for issue #1114 analyzing AI solver performance in hyoo-ru/mam_mol repository

  fix: Propagate --verbose flag to agent tool for debugging DecimalError issues
  - Added --verbose flag propagation to agent tool execution in agent.lib.mjs
  - Created case study documentation for DecimalError root cause analysis

## 1.2.7

### Patch Changes

- 12831a1: fix: Allow issues_list and pulls_list URLs for /hive command (Issue #1102)
  - Accept issues_list URLs (e.g., `https://github.com/owner/repo/issues`) for /hive command
  - Clean non-printable characters from URLs to prevent Markdown parsing errors
  - Escape special characters in error messages
  - Normalize issues_list URLs to base repo URLs before processing

## 1.2.6

### Patch Changes

- 94dfb13: Fix gh-upload-log argument parsing bug causing "File does not exist" error
  - Fixed bug where `gh-upload-log` received all arguments as a single concatenated string
  - The issue was caused by using `${commandArgs.join(' ')}` in command-stream template literal, which treats the entire joined string as one argument
  - Now using separate `${}` interpolations for each argument to ensure proper argument parsing
  - Also fixed: description flag is now properly passed to gh-upload-log (was only displayed, never sent)
  - Added comprehensive regression tests and case study documentation

## 1.2.5

### Patch Changes

- 65ee214: fix: Detect malformed flag patterns like "-- model" (Issue #1092)

  Added `detectMalformedFlags()` function that catches malformed command-line options and provides helpful error messages:
  - Detects "-- option" (space after --) and suggests "--option"
  - Detects "-option" (single dash for long option) and suggests "--option"
  - Detects "---option" (triple dash) and suggests "--option"
  - Integrated into both Telegram bot and CLI argument parsing
  - Added 23 comprehensive unit tests

- af950c8: fix(hive): require closing keywords for PR detection

  The `/hive` command was incorrectly skipping issues by reporting they had
  PRs when those PRs only mentioned the issues without actually solving them.

  **Root cause**: The `batchCheckPullRequestsForIssues` function used GitHub's
  `CROSS_REFERENCED_EVENT` timeline items, which are created whenever a PR
  body/title/commit mentions an issue number - regardless of whether the PR
  actually solves the issue.

  **Example**: PR #369 in VisageDvachevsky/StoryGraph is an audit PR that
  created 28 new issues (#370-#397) and listed them in a table. This caused
  GitHub to create cross-reference events linking that PR to all 28 issues,
  but PR #369 only actually fixes #368.

  **Solution**:
  - Add `prClosesIssue()` function to detect GitHub closing keywords
    (fixes, closes, resolves - case-insensitive)
  - Update GraphQL query to include PR body text
  - Only count PRs that contain "fixes #N", "closes #N", or "resolves #N"
    for the specific issue number
  - Add verbose logging when PRs are skipped for only mentioning issues

  This aligns with GitHub's own auto-close behavior where only specific
  keywords trigger issue closure when a PR is merged.

  Fixes #1094

- 0d997ac: fix(telegram-bot): stop solve queue on SIGINT/SIGTERM for clean exit

  The telegram bot was hanging after pressing Ctrl+C because the SolveQueue
  consumer loop kept running with active timers that prevented the Node.js
  event loop from emptying.
  - **Root cause identified**: The SIGINT/SIGTERM handlers only called
    `bot.stop()` (Telegraf) but did not stop the SolveQueue, whose `sleep()`
    timers kept the event loop alive.
  - **Solution**: Added `solveQueue.stop()` call in both SIGINT and SIGTERM
    handlers to stop the consumer loop before calling `bot.stop()`.
  - **Added verbose logging**: When running with `--verbose`, the bot now
    logs "Solve queue stopped" during shutdown.
  - **Case study documentation**: Added detailed analysis in
    `docs/case-studies/issue-1083/` with timeline, root cause investigation,
    and evidence collection.

  Fixes #1083

## 1.2.4

### Patch Changes

- 14ea4b6: Add validation for LINO configuration to detect invalid input
  - Add validation in `lenv-reader.lib.mjs` to reject multiple values on the same line (e.g., `--option1  --option2`)
  - Add validation to reject unrecognized characters in command-line options (e.g., `?`, `@`, `!`)
  - Errors include clear messages showing the problematic value and instructions for correction
  - Valid option characters: letters, numbers, hyphens, underscores, equals signs
  - Add comprehensive unit tests for LINO parsing logic (`test-lino.mjs`)
  - Add validation tests to lenv-reader test suite (`test-lenv-reader.mjs`)
  - Add lino tests to CI/CD workflow

  This approach helps users identify and correct configuration errors early, rather than silently dropping invalid options.

  Fixes #1086

## 1.2.3

### Patch Changes

- 5411e77: Fix gh-upload-log command invocation error caused by empty string argument
  - Fixed bug where `gh-upload-log` failed with "Unknown argument: ''" when verbose=false
  - The issue was caused by template literal interpolation `${verbose ? '--verbose' : ''}` passing empty string as an argument
  - Now using array-based command building to avoid empty arguments
  - Added improved handling for `error_during_execution` result subtype from Claude CLI
  - Added tests for log upload command construction to prevent regression

## 1.2.2

### Patch Changes

- db84104: Remove QEMU from CI/CD entirely
  - Remove unnecessary QEMU and Docker Buildx setup from docker-pr-check job
  - The PR check only builds for linux/amd64, so QEMU was never needed
  - docker-publish jobs already use native ARM64 runners (ubuntu-24.04-arm)
  - This addresses feedback to remove QEMU from CI/CD to avoid slowdowns and freezes

## 1.2.1

### Patch Changes

- 04cb3d2: Fix false positives in token masking for log sanitization
  - Remove overly broad regex pattern that was matching legitimate identifiers like `browser_take_screenshot` and MCP tool names
  - Add allowlist of safe token patterns (browser\_, mcp\_\_, function names with underscores, UUIDs)
  - Add context-aware detection for 40-char hex strings to avoid masking git commit hashes and gist IDs
  - Export new helper functions `isSafeToken` and `isHexInSafeContext` for testing
  - Add comprehensive unit tests for false positive prevention

## 1.2.0

### Minor Changes

- Add experimental --execute-tool-with-bun option to improve speed and memory usage

  This feature adds the `--execute-tool-with-bun` option that allows users to execute the AI tool using `bunx claude` instead of `claude`, which may provide performance benefits in terms of speed and memory usage.

  **Supported commands:**
  - `solve` - Uses `bunx claude` when option is enabled
  - `task` - Uses `bunx claude` when option is enabled
  - `review` - Uses `bunx claude` when option is enabled
  - `hive` - Passes the option through to the `solve` subprocess

  **How It Works:**
  When `--execute-tool-with-bun` is enabled, the `claudePath` variable is set to `'bunx claude'` instead of `'claude'` (or `CLAUDE_PATH` environment variable).

  **Usage Examples:**

  ```bash
  # Use with solve command
  solve https://github.com/owner/repo/issues/123 --execute-tool-with-bun

  # Use with task command
  task "implement feature X" --execute-tool-with-bun

  # Use with review command
  review https://github.com/owner/repo/pull/456 --execute-tool-with-bun

  # Use with hive command (passes through to solve)
  hive https://github.com/owner/repo --execute-tool-with-bun
  ```

  The option defaults to `false` to maintain backward compatibility.

  Fixes #812

  feat(hive): recheck issue conditions before processing queue items

  Added `recheckIssueConditions()` function to validate issue state right before processing,
  preventing wasted resources on issues that should be skipped due to changed conditions since queuing.

  **Checks performed:**
  - **Issue state**: Verifies the issue is still open
  - **Open PRs**: Checks if issue has PRs (when `--skip-issues-with-prs` is enabled)
  - **Repository status**: Confirms repository is not archived

  **Benefits:**
  - Prevents processing closed issues
  - Avoids duplicate work when PRs already exist
  - Stops work on newly archived repositories
  - Saves AI model tokens and compute resources

  **Performance impact:**
  Minimal overhead per issue (~300-500ms for API calls), negligible compared to 5-15 minute solve time.

  Fixes #810

## 1.1.0

### Minor Changes

- 4c46685: Add --enable-workspaces option for separate workspace directories

  This feature adds support for creating separate workspace directories for all AI tools (claude, opencode, codex, agent). When enabled with `--enable-workspaces`, the tool creates a structured workspace:
  - `/tmp/hive-mind-solve-gh-{owner}/{repo}-issue-{issueNumber}-workspace-{timestamp}/repository` - for the cloned repo
  - `/tmp/hive-mind-solve-gh-{owner}/{repo}-issue-{issueNumber}-workspace-{timestamp}/tmp` - for temp files, logs, downloads

  The workspace tmp directory is passed to all tool prompts, with explicit examples for saving CI logs, diffs, and command outputs.

- Add relative time display for usage limit reset messages in GitHub comments

  When the AI tool hits its usage limit, GitHub comments now show the reset time in a more user-friendly format:
  - Before: `11:00 PM`
  - After: `in 1h 23m (11:00 PM UTC)`

  This helps users in different timezones understand when the limit will reset more quickly.

## 1.0.5

### Patch Changes

- a68a9f2: fix(queue): simplify queue logic based on PR feedback
  - **Use 5-minute load average for CPU**: Uses `loadAvg5` instead of instantaneous CPU usage,
    providing a more stable metric not affected by transient spikes during claude startup.
    Cache TTL is 2 minutes.
  - **Keep RAM threshold with caching**: RAM_THRESHOLD (50%) is still checked but uses cached
    values only (no uncached rechecks) to simplify the logic.
  - **Increase MIN_START_INTERVAL_MS to 2 minutes**: Allows enough time for solve command to
    start actual claude process, ensuring running processes are counted when API limits are checked.
  - **Increase CONSUMER_POLL_INTERVAL_MS to 1 minute**: Reduces unnecessary system checks.
    One-minute polling is sufficient for queue management.
  - **Running processes not a blocking limit**: Commands can run in parallel as long as actual
    limits (CPU, API, etc.) are not exceeded. Claude process info is only supplementary.

  Fixes #1078

## 1.0.4

### Patch Changes

- 4e5e1ab: Use gh-upload-log for log file uploads (issue #587)
  - Replace custom gist creation with gh-upload-log command
  - Implement smart linking: 1 chunk = direct raw link, >1 chunks = repo link
  - Update case study documentation with gh-upload-log v0.5.0 fixes
  - Remove custom log compression in favor of gh-upload-log auto mode

## 1.0.3

### Patch Changes

- 26b69f2: Fix Claude Code output token limit by setting CLAUDE_CODE_MAX_OUTPUT_TOKENS to 64000
  - Claude Code CLI defaults to 32K output token limit, but Claude Sonnet/Opus/Haiku 4.5 models support 64K
  - Added `claudeCode.maxOutputTokens` configuration in `config.lib.mjs` (default: 64000)
  - Pass `CLAUDE_CODE_MAX_OUTPUT_TOKENS` environment variable when executing Claude CLI
  - Configuration can be overridden via `CLAUDE_CODE_MAX_OUTPUT_TOKENS` or `HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS` environment variables
  - Added comprehensive case study analysis in `docs/case-studies/issue-1076/`

  See: https://github.com/link-assistant/hive-mind/issues/1076

## 1.0.2

### Patch Changes

- 1a96d9f: Fix Claude Usage API rate limiting by increasing cache TTL to 20 minutes
  - The Claude Usage API (`/api/oauth/usage`) was returning null values due to rate limiting when called too frequently
  - Increased default cache TTL from 3 minutes to 20 minutes for Claude Usage API
  - Added configurable environment variable `HIVE_MIND_USAGE_API_CACHE_TTL_MS` (default: 1200000ms = 20 minutes)
  - Added HTTP response status logging for easier debugging
  - Added explicit 429 rate limit error handling
  - Updated documentation in `docs/CONFIGURATION.md`

  See: https://github.com/link-assistant/hive-mind/issues/1074

## 1.0.1

### Patch Changes

- 2a3848d: Add --prompt-architecture-care flag for managing REQUIREMENTS.md and ARCHITECTURE.md files

  Adds an optional experimental flag `--prompt-architecture-care` that provides guidance for:
  - Managing REQUIREMENTS.md (high-level why/what documentation)
  - Managing ARCHITECTURE.md (high-level how documentation)
  - TODO.md workflow management for task persistence across sessions

  The flag is disabled by default and works with all tools (claude, agent, opencode, codex).

- a18a664: Fix session ID extraction error for --tool agent
  - Fixed JSON parsing logic in agent tool to extract session IDs from NDJSON output
  - Modified session summary to show informational message for agent tool instead of error

## 1.0.0

### Major Changes

- 4e8d141: Rename `--auto-continue-on-limit-reset` to `--auto-resume-on-limit-reset` for clarity

  BREAKING CHANGE: The `--auto-continue-on-limit-reset` option has been renamed to `--auto-resume-on-limit-reset`. Users must update their commands and configurations to use the new flag name.

  The option is related to `--resume` for `claude` command and has an entirely different meaning from `--auto-continue` mode. This rename makes the distinction clearer and aligns the terminology with the resume functionality.

  Migration:
  - Replace `--auto-continue-on-limit-reset` with `--auto-resume-on-limit-reset` in all commands
  - Update environment variables and configuration files accordingly

## 0.54.6

### Patch Changes

- f734d5d: feat: Add --base-branch to /help and implement option typo suggestions
  - Added --base-branch option to Telegram bot /help command
  - Implemented intelligent option name suggestions using Levenshtein distance
  - Added --base-branch to README.md solve options section
  - Enhanced error messages with helpful suggestions for typos (e.g., --branch → --base-branch)

## 0.54.5

### Patch Changes

- Fix duplicate APT sources warning in installation script
  - Add `cleanup_duplicate_apt_sources()` function to detect and remove duplicate APT source files
  - Clean up duplicate Microsoft Edge sources (`microsoft-edge.list` vs `microsoft-edge-stable.list`)
  - Clean up duplicate Google Chrome sources (`google-chrome.list` vs `google-chrome-stable.list`)
  - Run cleanup before `apt update` to prevent "Target Packages configured multiple times" warnings
  - Ensures script supports clean upgrade mode when run on previously installed systems

  Improve Telegram bot error messages for better user experience (issue #1070)
  - Enhanced URL validation to provide specific, actionable error messages based on URL type (issues list, pulls list, repository)
  - Added step-by-step fix instructions with examples when users provide wrong URL formats
  - Improved global error handler to properly escape Markdown special characters, preventing "400: Bad Request: can't parse entities" errors
  - Added special handling for Telegram API parsing errors with clearer messaging
  - Added `cleanNonPrintableChars()` to automatically remove invisible Unicode characters from user input
  - Added `makeSpecialCharsVisible()` to show users exactly where problematic special characters are in their input
  - Enhanced error messages to display user input with special characters made visible for easier debugging
  - Refactored telegram-bot.mjs to meet 1500 line limit requirement
  - Created comprehensive test suites to verify URL validation improvements and special character handling
  - Documented case study analysis in docs/case-studies/issue-1070/ANALYSIS.md

## 0.54.4

### Patch Changes

- 4e53d67: fix: resolve TypeError in telegram-bot when using --tokens-budget-stats

  Fixed type safety bug that prevented the --tokens-budget-stats option from working via telegram bot configuration overrides. Changed from lino.parse() to lino.parseStringValues() to ensure only string values are returned, making .trim() safe to call. The feature was already fully implemented but crashed when used via TELEGRAM_HIVE_OVERRIDES or TELEGRAM_SOLVE_OVERRIDES.

## 0.54.3

### Patch Changes

- 4d4b461: Add Playwright browser verification to installation script and CI
  - Enhanced `scripts/ubuntu-24-server-install.sh` with detailed browser verification after installation
  - Added CI checks in `.github/workflows/release.yml` to verify required Playwright browsers (chromium, firefox, webkit) are installed
  - CI now fails if required browsers are missing, ensuring Playwright MCP server has all dependencies

## 0.54.2

### Patch Changes

- c5f5194: Fix Telegram message getting stuck at "Starting solve command..."
  - Add error handling to `executeAndUpdateMessage` function to catch Telegram API errors
  - Fix critical bug where `messageInfo` was being cleared before the final message update
  - Add proper error logging for message edit failures in both immediate and queued execution paths

## 0.54.1

### Patch Changes

- 55576af: fix: allow parallel queue execution when no limits exceeded

  Previously, "Claude process is already running" was treated as a blocking reason on its own, preventing parallel execution even when all system and API limits were within thresholds.

  Changes:
  - `claude_running` is now tracked as a metric, not a blocking reason
  - Commands can run in parallel as long as actual limits are not exceeded
  - When any limit >= threshold, allow exactly one claude command to pass

## 0.54.0

### Minor Changes

- 4af584c: Add producer/consumer queue for /solve command in Telegram bot

  This feature implements resource-aware throttling to prevent system overload when multiple /solve commands are submitted simultaneously.

  **Queue Configuration (using usage ratios 0.0-1.0):**
  - `RAM_THRESHOLD: 0.5` - Stop new commands if RAM usage > 50%
  - `CPU_THRESHOLD: 0.5` - Stop new commands if CPU usage > 50%
  - `DISK_THRESHOLD: 0.95` - One-at-a-time mode if disk usage > 95%
  - `CLAUDE_5_HOUR_SESSION_THRESHOLD: 0.9` - Stop if Claude 5-hour limit > 90%
  - `CLAUDE_WEEKLY_THRESHOLD: 0.99` - One-at-a-time mode if weekly limit > 99%
  - `GITHUB_API_THRESHOLD: 0.8` - Stop if GitHub API > 80% with parallel claude commands
  - 1-minute minimum interval between command starts
  - Running claude process detection

  **Status Flow:**
  - `Queued` - Initial status when command is added to queue
  - `Waiting` - When start conditions are not met (with human-readable reason)
  - `Starting` - When command is being started
  - `Started` - Terminal status with session info (message tracking is released)

  **Caching:**
  - API calls (Claude, GitHub): 3-minute cache
  - System metrics (RAM, CPU, disk): 2-minute cache
  - Shared cache between /solve queue and /limits command

  **Files Changed:**
  - `limits.lib.mjs` - Merged from `claude-limits.lib.mjs` with added caching layer (replaces both `claude-limits.lib.mjs` and `telegram-limits.lib.mjs`)
  - `telegram-solve-queue.lib.mjs` - Queue implementation with status tracking

  **User Experience:**
  - Messages are updated in-place as status changes
  - Clear waiting reasons displayed (e.g., "Disk usage is 96% (threshold: 95%)")
  - Queue status added to /limits command output

## 0.53.2

### Patch Changes

- 5030fe1: Fix --auto-continue-on-limit-reset flag not working

  When Claude hit its usage limit with --auto-continue-on-limit-reset enabled, the code would exit early
  via the failure branch before reaching showSessionSummary() where autoContinueWhenLimitResets() is called.

  This patch adds a condition to skip the failure exit when limit is reached with auto-continue enabled,
  allowing the code to properly wait for the limit to reset and resume the session.

## 0.53.1

### Patch Changes

- 6d7fb43: Add --auto-continue-on-limit-reset option to hive command

  The hive command was missing the --auto-continue-on-limit-reset option that is available
  in the solve command. This caused yargs strict mode to reject the option with an
  "Unknown arguments" error. The option is now properly defined in hive.config.lib.mjs
  and passed to the solve command when spawning workers.

## 0.53.0

### Minor Changes

- b750286: Add `--prompt-check-sibling-pull-requests` flag (default: true) to control whether the AI is prompted to study related/sibling pull requests during issue solving

## 0.52.1

### Patch Changes

- 1a4f1a2: Reduce Telegram messages by updating instead of sending new ones

  The `/solve` and `/hive` commands now update the initial "Starting..." message with the success/error result instead of sending a separate message. This follows the same pattern already used by the `/limits` command.

  **Before:** Two separate messages per command
  **After:** Single message that gets updated with the result

## 0.52.0

### Minor Changes

- b280bcc: Add `--prompt-playwright-mcp` flag to control Playwright MCP hints in system prompt

  Users can now explicitly control whether Playwright MCP browser automation hints appear in the AI's system prompt:
  - Use `--no-prompt-playwright-mcp` to disable hints even when Playwright MCP is installed
  - Use `--prompt-playwright-mcp` to explicitly enable hints
  - Omit the flag to keep the default auto-detection behavior

## 0.51.21

### Patch Changes

- Increase swap space from 2GB to 4GB in installation script for improved stability

  Fix: Show Claude CLI resume command using `(cd ... && claude --resume ...)` pattern

  When using `--tool claude` (or the default tool), the console now displays a copyable Claude CLI resume command at the end of every session (success, failure, or usage limit reached):

  ```
  💡 To continue this session in Claude Code interactive mode:

     (cd "/tmp/gh-issue-solver-..." && claude --resume <session-id>)
  ```

  Changes in this PR:
  - Refactored `claude.command-builder.lib.mjs` to build Claude CLI commands instead of solve.mjs commands
  - Added `buildClaudeResumeCommand()` for generating `(cd ... && claude --resume ...)` pattern
  - Added `buildClaudeInitialCommand()` for generating `(cd ... && claude ...)` pattern
  - Removed solve.mjs resume command display from console output
  - Updated PR comments to use Claude CLI resume command pattern

  This allows users to:
  - Investigate sessions interactively in Claude Code
  - Resume from where they left off after usage limits reset
  - See full context and history
  - Debug issues

  The command uses the `(cd ... && claude --resume ...)` pattern for a fully copyable, executable command that works regardless of the current directory.

  Note: The resume command is only shown for `--tool claude` since other tools (codex, opencode, agent) have different resume mechanisms.

  Fixes #942

## 0.51.20

### Patch Changes

- 9327e83: Fix CI/CD check differences between pull request and push events

  Changes:
  - Make lint job independent of changeset-check (runs based on file changes only)
  - Allow docs-only PRs without changeset requirement
  - Handle changeset-check 'skipped' state in dependent jobs
  - Fix unformatted markdown files in case studies
  - Add case study documentation for issue #1023

## 0.51.19

### Patch Changes

- 0326eb5: Update /help and docs, add CPU/RAM metrics to /limits
  - Remove obsolete options (--fork, --auto-fork, --auto-continue) from /help command
  - Reorder options in /help: --model and --think now listed first
  - Move --model example from /hive to /solve
  - Update /limits to show CPU and RAM usage metrics
  - Fix README.md defaults for --auto-fork and --auto-continue (now true)

## 0.51.18

### Patch Changes

- bf6ac23: Fix Claude Code terms acceptance treated as success
  - Detect Claude CLI terms acceptance messages and treat as error requiring human intervention
  - Hide cost estimation section when all values are unknown
  - Fix code block escaping in log comments using zero-width spaces

## 0.51.17

### Patch Changes

- 91e43bf: Fix: Do not retry on 404 errors, display user-friendly permission suggestions

  This fix addresses issue #808 by improving error handling when attempting to fork inaccessible repositories.

  **Key improvements:**
  1. **No retry on 404 errors** - 404 errors are detected immediately and fail fast, saving ~30 seconds and ~10 API requests per failure
  2. **User-friendly error messages** - Comprehensive error messages explain what happened, list common causes, and provide step-by-step troubleshooting
  3. **Reduced API requests** - Early 404 detection in getRootRepository and immediate exit on 404 during fork creation eliminates unnecessary retries

  **Impact:**
  - Time saved: ~30 seconds per failed fork attempt
  - API requests saved: ~10 requests per failed fork attempt
  - Better UX: Clear guidance on diagnosing and resolving repository access issues

## 0.51.16

### Patch Changes

- 312c600: Fix issue #894: Add final log file reference at end of solve command CLI output

  Following the pattern used by Claude and other agents, the solve command now consistently displays the log file path as the final line of output. This ensures users always know where to find the complete log file, regardless of operations like log uploads, watch mode, or cleanup messages.

## 0.51.15

### Patch Changes

- 93a0af9: Add case study for issue #964: Discussion comments not loaded to AI context

  This case study documents the root cause analysis of why the AI solver failed to see and respond to repository owner feedback on PR #13 in the eg0rmaffin/vapor-rice-i3 repository. The investigation revealed two independent root causes:
  1. The feedback system tells the AI the count of new comments but not their content
  2. The AI used an incomplete API command that only fetches conversation comments, missing review comments

  The case study includes proposed solutions to fix this issue.

## 0.51.14

### Patch Changes

- 4e4fe08: Improve fork divergence error message clarity
  - Remove misleading "Option 3: Work without syncing fork (NOT RECOMMENDED)"
  - Add new Option 1 for deleting and recreating fork (marked as SIMPLEST)
  - Reorder options by simplicity: deletion → auto-resolution → manual resolution
  - Move risk warnings inline with relevant options for better context
  - Add comprehensive case study documentation in docs/case-studies/issue-972/

  This change makes the error message more useful by removing options that were never actually viable and adding the fork deletion option as the cleanest solution for most fork divergence scenarios.

## 0.51.13

### Patch Changes

- 20d6f3a: Fix URL hash fragment parsing - URLs with hash fragments like #issuecomment-123 are now correctly parsed. Previously, solving a PR with a comment URL like /pull/9#issuecomment-123 would fail because the PR number was extracted as "9#issuecomment-123" instead of "9".

## 0.51.12

### Patch Changes

- c5bcaf4: fix: add trailing newlines to generated CLAUDE.md files and prompts

  Ensures all automatically generated CLAUDE.md files and prompt strings comply with POSIX text file standards by adding trailing newlines. This fix prevents linter warnings and eliminates the need for manual fixes in subsequent pull requests.

  Changes:
  - Modified `src/solve.auto-pr.lib.mjs` to add trailing newline to CLAUDE.md template
  - Updated all prompt builder files (`agent.prompts.lib.mjs`, `claude.prompts.lib.mjs`, `codex.prompts.lib.mjs`, `opencode.prompts.lib.mjs`) to append `\n` to return values
  - Added comprehensive case study documentation in `docs/case-studies/issue-971/`

  Fixes #971

## 0.51.11

### Patch Changes

- 001dcdb: Fix missing comment detection when PRs have more than 30 comments by adding --paginate flag to GitHub API calls

## 0.51.10

### Patch Changes

- 0f20e0b: Add missing language runtimes, agents, and tools to /version command output

  This patch adds comprehensive version detection for all components installed by the ubuntu-24-server-install.sh script:

  **New Language Runtimes:**
  - Deno (JavaScript/TypeScript runtime)
  - Go (Golang)
  - Java (via SDKMAN)
  - Lean (theorem prover)
  - Perl (via Perlbrew)
  - OCaml (via Opam)
  - Rocq/Coq (theorem prover)

  **New Development Tools:**
  - SDKMAN (Java version manager)
  - Elan (Lean version manager)
  - Lake (Lean package manager)
  - Perlbrew (Perl version manager)
  - Opam (OCaml package manager)

  **New C/C++ Development Tools Section:**
  - Make
  - CMake
  - GCC
  - G++
  - Clang
  - LLVM
  - LLD (LLVM linker)

  The /version command now displays all installed components that are available in the hive environment.

  Fixes #1007

## 0.51.9

### Patch Changes

- Keep hive user's home directory clean
  - Move Go GOPATH from `~/go` to `~/.go/path` to keep everything under the hidden `.go` directory
  - Move Perlbrew from `~/perl5` to `~/.perl5` (hidden directory)
  - Remove automatic cloning of hive-mind repository to `~/hive-mind`

  This keeps the user's home directory empty by default, giving users freedom to organize their workspace as they prefer.

  Fixes #1004

  fix: ensure log attachment works when PR is merged during session

  Fixes issue where log files would not be attached to pull requests when the PR was merged during the AI solving session. The `gh pr list` command only returns OPEN PRs by default, causing merged PRs to not be found. Added `--state all` flag to find PRs regardless of their state (OPEN, MERGED, or CLOSED), and added handling to skip operations that don't work on merged PRs (like `gh pr edit` and `gh pr ready`) while still allowing log attachment.

## 0.51.7

### Patch Changes

- b7c7a2c: feat: add GitHub API rate limits to /limits command

  Adds GitHub API core rate limit information to the Telegram bot's /limits command output, allowing users to monitor GitHub API usage alongside Claude usage limits and disk space. This helps plan issue execution when GitHub API limits are approaching.

## 0.51.6

### Patch Changes

- 9ee79c8: fix(ci): Add timeout, verbose diagnostics, and pre-fetch caching for Docker ARM64 builds

  Addresses issue #998 where Docker Publish (linux/arm64) was stuck for >1.5 hours due to slow Homebrew bottle downloads on GitHub's ARM64 runners.

  Changes:
  - Added 90-minute timeout to docker-publish jobs to prevent indefinite hangs
  - Switched from ubuntu-24.04-arm to ubuntu-22.04-arm for better network performance
  - Added documentation comments about known ARM64 runner issues
  - Added Homebrew verbose mode (`HOMEBREW_VERBOSE=1`) for detailed diagnostics
  - Added `brew fetch --deps --retry` to pre-download bottles before installation
  - Added timing measurements for fetch and install steps
  - Updated case study with diagnostic approach

  Root cause: GitHub's ubuntu-24.04-arm runners have known network performance issues (actions/runner-images#11790, actions/partner-runner-images#101). The ARM64 build was stuck downloading Homebrew bottles for PHP dependencies at extremely slow speeds.

  See docs/case-studies/issue-998/README.md for detailed analysis.

## 0.51.5

### Patch Changes

- 1a17f74: feat: add disk space information to /limits command

  Adds free disk space percentage and size information to the Telegram bot's /limits command output, allowing users to monitor disk usage alongside Claude API limits and plan issue execution accordingly.

## 0.51.4

### Patch Changes

- Test patch release

## 0.51.3

### Patch Changes

- 2fdb8b8: Fix Docker publish jobs being skipped after successful npm releases by adding always() to job conditions and explicit result checks

## 0.51.2

### Patch Changes

- a605d9d: Fix perlbrew bashrc unbound variable error (issue #989)

  **Problem:** The error `/home/hive/perl5/perlbrew/etc/bashrc: line 71: $1: unbound variable` appeared during Docker builds when running Perl version checks.

  **Root Cause:** Perlbrew's generated bashrc uses positional parameter `$1` and other variables without protection against `set -u` (nounset mode).

  **Solution:**
  - Patch perlbrew bashrc after installation to use `${1:-}`, `${PERLBREW_LIB:-}`, and `${outsep:-}` syntax
  - Add CI check to detect and fail on any unbound variable errors in Docker builds
  - Add case study documentation for future reference

  **Changes:**
  - `scripts/ubuntu-24-server-install.sh`: Patch perlbrew bashrc for set -u compatibility
  - `.github/workflows/release.yml`: Add CI check for unbound variable errors
  - `docs/case-studies/issue-989/`: Add case study documentation

  References:
  - Issue: https://github.com/link-assistant/hive-mind/issues/989
  - Upstream fix: https://github.com/gugod/App-perlbrew/pull/850

## 0.51.1

### Patch Changes

- ec08ef4: Fix Rocq installation verification (issue #952)
  - Installation script: Check binary accessibility instead of just package listing
  - Installation script: Use `opam pin add rocq-prover` per official documentation
  - CI workflow: Require Rocq accessibility in container (not optional)
  - CI workflow: Enhanced diagnostics when Rocq verification fails
  - Dockerfile: Add opam environment variables (OPAM_SWITCH_PREFIX, CAML_LD_LIBRARY_PATH, OCAML_TOPLEVEL_PATH)

  References:
  - Issue: https://github.com/link-assistant/hive-mind/issues/952
  - Rocq docs: https://rocq-prover.org/docs/using-opam

## 0.51.0

### Minor Changes

- 36f23fb: Add fork parent validation to prevent nested fork hierarchy issues (#967)

  This release adds early validation of fork parent relationships to prevent issues where a fork was created from an intermediate fork (fork of a fork) instead of directly from the intended upstream repository.

  **Problem solved:**
  When a user's fork was created from an intermediate fork (e.g., `user/repo` forked from `someone-else/repo` which was itself forked from `upstream/repo`), any pull requests created would include all commits that exist in the intermediate fork but not in the upstream. This could result in PRs with hundreds or thousands of unexpected commits.

  **Case study (Issue #967):**
  A fork `konard/zamtmn-zcad` was created from `veb86/zcadvelecAI` (intermediate fork with 1,678 extra commits) instead of `zamtmn/zcad` (the upstream). This resulted in a PR with 1,681 commits instead of the expected 3 commits.

  **Changes:**
  - **New function `validateForkParent()`**: Validates that a fork's parent matches the expected upstream repository before using it. Checks both the immediate parent and ultimate source (root) of the fork hierarchy.
  - **Early validation**: Fork parent is now validated immediately after an existing fork is found, BEFORE syncing or creating branches. This prevents wasted work and provides clear error messages early.
  - **Detailed error messages**: When a fork parent mismatch is detected, users receive comprehensive information including:
    - The actual fork hierarchy (parent and source repositories)
    - Why this is a problem (unexpected commits in PRs)
    - Three concrete fix options:
      1. Delete the problematic fork and create a fresh one
      2. Use `--prefix-fork-name-with-owner-name` to create a new fork with a different name
      3. Work directly on the repository with `--no-fork` if you have write access
  - **Unit tests**: Added comprehensive test suite (`tests/test-fork-parent-validation.mjs`) with 10 tests covering the validation logic, error handling, and documentation.

  **Technical details:**
  - Uses GitHub API to fetch fork relationship: `gh api repos/{fork} --jq '{fork: .fork, parent: .parent.full_name, source: .source.full_name}'`
  - Validates in two code paths: when finding existing forks (strict error) and when using forkOwner from PR mode (warning only)
  - Reports validation errors to Sentry for monitoring

## 0.50.11

### Patch Changes

- 6f51d29: fix: add screen terminal multiplexer to Docker image

  The screen package is now installed by default in the Docker image, resolving issue #986 where users encountered "command not found" errors when attempting to use screen. Includes comprehensive case study documenting the issue analysis, root cause, and solution evaluation.

## 0.50.10

### Patch Changes

- Test patch release

## 0.50.9

### Patch Changes

- Fix stuck Docker multi-platform builds by using native ARM64 runners

  The Docker publish workflow was getting stuck for hours when building ARM64 images using QEMU emulation on x86_64 runners. QEMU emulation introduces 10-100x slowdown, especially for complex Dockerfiles that compile native packages.

  **Solution**: Refactored docker-publish jobs to use GitHub's native ARM64 runners (`ubuntu-24.04-arm`) with a matrix strategy:
  - Each platform (amd64, arm64) builds natively in parallel on dedicated runners
  - Build artifacts (digests) are uploaded and merged into a multi-platform manifest
  - Eliminates QEMU emulation overhead entirely
  - Build times should now be similar for both platforms (~10-15 minutes each)

  This fix applies to both:
  - `docker-publish` job (triggered by regular releases)
  - `docker-publish-instant` job (triggered by manual instant releases)

  Fixes #982

  Fix Docker Publish jobs being skipped after npm publish

  Added explicit shell-based output passthrough step for `published` output in both `release` and `instant-release` jobs. This ensures reliable output propagation to dependent jobs (`docker-publish` and `docker-publish-instant`).

  Root cause: Node.js `appendFileSync` to `GITHUB_OUTPUT` was not reliably propagating outputs to dependent jobs. The fix uses a dedicated shell step to echo outputs, which is proven to work correctly.

  Also added debug logging to `setOutput` function in `publish-to-npm.mjs` and `version-and-commit.mjs` scripts.

  Add case study for harmful prompts and resource exhaustion attacks

  Documents analysis of LLM resource exhaustion attacks including:
  - Timeline and root cause analysis
  - OWASP LLM Top 10 (2025) attack classification
  - Attack patterns database with detection rules
  - Five proposed solution approaches
  - Raw attack samples for research

## 0.50.8

### Patch Changes

- Test patch release

## 0.50.7

### Patch Changes

- 9eea96a: Fix Docker publish jobs failing with "No space left on device" error

  Added disk space cleanup step to both `docker-publish` and `docker-publish-instant` jobs in the release workflow. This step removes large pre-installed packages (dotnet, android SDK, GHC, CodeQL) and prunes unused Docker images before building multi-platform Docker images.

  This fixes issue #975 where instant releases failed during arm64 build due to insufficient disk space when installing Rust toolchain.

## 0.50.6

### Patch Changes

- 7733b32: Detect OpenCode permission prompts and recommend @link-assistant/agent for autonomous workflows
  - Configure all OpenCode permissions to "allow" (edit, bash, webfetch, skill, doom_loop, external_directory)
  - Detect interactive permission prompts that block automated execution
  - Recommend @link-assistant/agent (100% unrestricted OpenCode fork) when prompts are detected

## 0.50.5

### Patch Changes

- Test patch release

## 0.50.4

### Patch Changes

- d58e5dd: fix: enable Docker and Helm publishing for instant releases

  Previously, when using the "instant release" workflow (triggered via workflow_dispatch),
  Docker images and Helm charts were not published because they only depended on the
  `release` job outputs. This fix adds dedicated `docker-publish-instant` and
  `helm-release-instant` jobs that depend on the `instant-release` job outputs.

  This resolves the issue where Docker Hub images were 14 days behind npm releases.

  Additionally, duplicated CI/CD logic has been moved to reusable scripts:
  - `scripts/wait-for-npm.sh` - Waits for NPM package availability
  - `scripts/helm-release.sh` - Packages and publishes Helm charts to gh-pages

## 0.50.3

### Patch Changes

- ca9f1b2: Fix sentry-cli source maps upload command for v3.0.0+ API

  Updated `scripts/upload-sourcemaps.mjs` to use the new `sentry-cli sourcemaps upload` command syntax instead of the deprecated `sentry-cli releases files upload-sourcemaps` which was removed in sentry-cli 3.0.0.

## 0.50.2

### Patch Changes

- Test patch release

## 0.50.1

### Patch Changes

- 8fdf8dd: Fix Sentry CLI 3.x compatibility to restore Docker image publishing
  - Update `scripts/upload-sourcemaps.mjs` to use `sourcemaps upload` command instead of deprecated `releases files` command
  - Add case study documentation for issue #962 investigation

## 0.50.0

### Minor Changes

- 8934ed6: Improve changeset CI/CD robustness for multiple concurrent PRs
  - Update validate-changeset.mjs to only check changesets ADDED by the current PR (not pre-existing ones)
  - Add merge-changesets.mjs script to combine multiple pending changesets during release
  - Merged changesets use highest version bump type (major > minor > patch) and combine descriptions chronologically
  - Update release workflow to merge multiple changesets before version bump
  - This prevents PR failures when multiple PRs merge before a release cycle completes

## 0.49.0

### Minor Changes

- Add --claude-file and --gitkeep-file CLI options for choosing between CLAUDE.md and .gitkeep files

  This feature allows users to choose which file type to use for PR creation:
  - `--claude-file` (default: true): Use CLAUDE.md file for task details
  - `--gitkeep-file` (default: false): Use .gitkeep file instead

  The flags are mutually exclusive:
  - Using `--gitkeep-file` automatically disables `--claude-file`
  - Using `--no-claude-file` automatically enables `--gitkeep-file`
  - Both flags cannot be disabled simultaneously

  This is a step toward making .gitkeep the default behavior in future releases.

## 0.48.4

### Patch Changes

- b010ce6: Increase minimum disk space requirement from 512 MB to 2 GB to provide more room for commands to gracefully finish before running out of disk space and prevent potential OS issues

## 0.48.3

### Patch Changes

- ba6d6e4: Add comprehensive research on folder naming best practices for documentation

  Added expanded documentation in `docs/case-studies/folder-naming-best-practices.md` covering:
  - Industry standards (Google SRE, ITIL, NIST, Diataxis, Oxide RFD, NASA FRB, FEMA AAR)
  - Terminology mapping for alternative document type names (PIR, AAR, RCA, TDR, etc.)
  - Recommended folder structure for incidents, investigations, problems, case studies, decisions, reviews, retrospectives, and runbooks
  - Extended folder structure for larger organizations
  - File naming conventions for 18+ document types following kebab-case and ISO 8601 date formats
  - Document templates with YAML front matter including RFD, Spike, AAR, Retrospective, and One-Pager templates
  - 30+ verified authoritative sources from industry leaders

## 0.48.2

### Patch Changes

- Test patch release

## 0.48.1

### Patch Changes

- 279642e: Comprehensive release and validation fixes

  This release includes multiple critical fixes that work together to ensure reliable releases and prevent unvalidated code from merging:

  **1. Fix workflow conditions to prevent unvalidated code from merging (#958)**

  Updated lint job conditions in release.yml to check all file types that Prettier formats (.mjs, .md, .json, .js), not just .mjs files. This ensures the lint check runs consistently for both pull requests and main branch, preventing formatting issues from bypassing validation. Previously, PRs changing only .md or .json files would skip lint checks, allowing unformatted code to merge and cause main branch CI failures.

  Documentation added:
  - Case study analysis (docs/case-studies/issue-958/ANALYSIS.md) with root cause analysis and timeline reconstruction
  - Branch protection policy guide (docs/BRANCH_PROTECTION_POLICY.md) with required status checks specification and configuration instructions

  **2. Fix perlbrew bashrc unbound variable error at perl version check (#954)**

  Resolves an issue where running `perl --version` during installation would trigger an "unbound variable" error from perlbrew's bashrc file at line 71. The error occurred because:
  - The version check command triggered .bashrc sourcing in a subshell
  - Perlbrew's bashrc referenced positional parameter $1 without guards
  - With `set -u` enabled, unbound variables cause errors

  Solution:
  - Only load perlbrew in interactive shells (PS1 check in .bashrc)
  - Temporarily disable `set -u` when sourcing perlbrew bashrc in the install script
  - Re-enable strict mode immediately after sourcing
  - Added comprehensive test script (experiments/test-perlbrew-fix.sh)

  **3. Enhance README.md initialization for empty repositories (#706)**

  Enhanced the existing empty repository handling to include repository description in the auto-generated README.md file. When the solve command encounters an empty repository that cannot be forked, it now creates a more descriptive README with both the repository title and description (if available).

  **4. Fix package-lock.json sync in changeset version bump flow**
  - Add `npm install --package-lock-only` after `npm run changeset:version` in version-and-commit.mjs
  - Ensures package-lock.json stays in sync with package.json during changeset-based releases
  - Fixes issue where version bumps only updated package.json

## 0.48.0

### Minor Changes

- 93ea94b: Add solution drafts listing feature to hive command. When processing completes, hive now displays all completed issues with their linked pull requests before showing the "✅ All issues processed!" message.

### Patch Changes

- a44ab88: Add system prompt guidance to prefer using existing code as examples
  - Added guideline to encourage searching for similar existing implementations before implementing from scratch
  - Applied consistently across all three prompt modules (claude, codex, opencode)
  - Helps maintain consistency with existing patterns and reduces redundant work

- 1bdc96d: Fix --base-branch option to properly create branches from the specified base branch instead of from current HEAD

## 0.47.1

### Patch Changes

- 68c0417: Fix Rocq installation verification by sourcing opam environment
  - Source opam environment before verifying Rocq in installation summary
  - Use `rocq -v` for verification as recommended by official documentation
  - Update CI workflow to require Rocq to be accessible (not optional)
  - Add case study documenting the issue and solution

## 0.47.0

### Minor Changes

- 1351ffe: Add Prettier for automatic code formatting with ESLint integration
  - Added Prettier configuration with project code style settings
  - Created format and format:check npm scripts for code formatting
  - Integrated Prettier with ESLint to warn about formatting issues
  - Added eslint-config-prettier and eslint-plugin-prettier dependencies

## 0.46.1

### Patch Changes

- 3707189: Implement fail-fast CI strategy for release.yml workflow
  - Added dependency ordering so long-running checks wait for all fast checks to pass
  - Fast checks (test-compilation, lint, check-file-line-limits) run first (~7-21s each)
  - Long-running checks (test-suites, test-execution, memory-check-linux, docker-pr-check) only run after fast checks pass
  - Added smart conditionals with `!contains(needs.*.result, 'failure')` to skip long checks when fast checks fail
  - Added section markers to clearly document FAST vs LONG-RUNNING checks in the workflow

  Benefits:
  - Time savings: If fast checks fail, ~4+ minutes of long-running tests are skipped
  - Faster feedback: Developers get quick feedback on common issues
  - Resource efficiency: Reduces unnecessary GitHub Actions minutes consumption

## 0.46.0

### Minor Changes

- a436ee4: Add --prompt-case-studies CLI option for comprehensive issue analysis. When enabled, instructs the AI to download logs, create case study documentation in ./docs/case-studies/issue-{id}/, perform deep analysis, reconstruct timeline, identify root causes, and propose solutions. Works only with --tool claude, disabled by default.

### Patch Changes

- 1110e7a: Add comprehensive changeset documentation to CONTRIBUTING.md explaining how contributors should use the changesets workflow for version management and changelog generation

## 0.45.0

### Minor Changes

- 81f8da0: Add `--tokens-budget-stats` option for detailed token usage analysis. This experimental feature shows context window usage and output token usage in absolute values and ratios when using `--tool claude`. Disabled by default.

## 0.44.0

### Minor Changes

- b72136f: Add /version command to hive-telegram-bot

  Implements a new /version command that displays comprehensive version information including:
  - Bot version (package version with git commit SHA in development)
  - solve and hive command versions
  - Node.js runtime version
  - Platform information (OS and architecture)

  This helps users and administrators quickly check version information without accessing logs or the server directly.

### Patch Changes

- 445091b: Fix Perl version detection in ubuntu-24-server-install.sh

  The `perlbrew available` command output was not being parsed correctly, causing the installation script to skip Perl installation with the message "Could not determine latest Perl version."

  **Changes:**
  - Use `grep -oE` to robustly extract Perl version strings regardless of line formatting
  - Capture stderr from `perlbrew available` for better debugging
  - Add debug output showing `perlbrew available` response when version detection fails
  - Works with 'i' markers for already-installed versions and variable indentation

  This ensures the latest Perl version is properly detected and installed via perlbrew.

  Fixes #948

## 0.43.0

### Minor Changes

- fe002f8: Add --prompt-issue-reporting flag for automatic issue creation

  This release introduces a new opt-in feature that enables the AI to automatically create GitHub issues when it spots bugs, errors, or minor issues during working sessions that are not related to the main task.

  **New Features:**
  - Added `--prompt-issue-reporting` CLI flag (disabled by default)
  - Issues include reproducible examples, workarounds, and fix suggestions
  - Supports creating issues in both current and third-party repositories
  - Automatic duplicate checking before creating issues

  **Usage:**

  ```bash
  hive solve <issue-url> --prompt-issue-reporting
  solve <issue-url> --prompt-issue-reporting
  ```

  **Implementation:**
  - New guideline in system prompt (conditional on flag)
  - Flag added to both `hive` and `solve` commands
  - Uses `gh` CLI for authenticated issue creation (works with private repos)

  This feature helps ensure that no bugs slip through the cracks during development while giving users full control over when it's active.

## 0.42.3

### Patch Changes

- 64d6cf8: Add experimental /top command to Telegram bot
  - Added /top command to show live system monitor in Telegram
  - Displays auto-updating `top` output in a single message (updates every 2 seconds)
  - Owner-only access with chat authorization checks
  - Session isolation per chat using GNU screen
  - Clean stop button to terminate monitoring session
  - Marked as EXPERIMENTAL feature with user warnings
  - Not documented in /help as requested
  - Requires GNU screen to be installed on the system

  Fixes #500

## 0.42.2

### Patch Changes

- dca5bed: Make --auto-continue enabled by default
  - Changed default value from false to true for --auto-continue in both hive and solve commands
  - Smart handling of -s (--skip-issues-with-prs) flag interaction:
    - When -s is used, auto-continue is automatically disabled to avoid conflicts
    - Explicit --auto-continue with -s shows proper error message
    - Users can still use --no-auto-continue to explicitly disable
  - This improves user experience as users typically want to continue working on existing PRs

  Fixes #454

## 0.42.1

### Patch Changes

- acd70a9: Add Lean runtime preinstallation support via elan
  - Install elan (Lean version manager) with stable toolchain in all deployment environments
  - Add Lean/elan to PATH in Dockerfile, .gitpod.Dockerfile, coolify/Dockerfile
  - Add installation verification for elan, lean, and lake commands
  - Add CI checks to verify Lean installation in Docker builds

## 0.42.0

### Minor Changes

- d98d9c9: Add Java (OpenJDK) runtime installation support via SDKMAN in Ubuntu 24 server installation script
  - Install SDKMAN as Java version manager (following pattern of pyenv for Python, nvm for Node.js)
  - Install Java 21 LTS (Eclipse Temurin distribution) by default with fallback to OpenJDK
  - Add SDKMAN configuration to .bashrc for persistence
  - Add Java and SDKMAN to installation summary output
  - Add zip package to prerequisites (required by SDKMAN)

  Fixes #737

### Patch Changes

- d42d221: Add Perl runtime installation support via Perlbrew to Ubuntu 24 server installation script and Docker environment with CI verification

## 0.41.10

### Patch Changes

- f77fdf8: Add Golang runtime installation support to Ubuntu 24 server installation script with proper success verification
- ca4d83d: Add preinstalled Rocq (formerly Coq) theorem prover runtime support
  - Install opam (OCaml package manager) as prerequisite
  - Configure Rocq-released repository for package installation
  - Add Rocq prover with fallback to classic Coq package if unavailable
  - Add CI verification checks for Opam and Rocq/Coq installation
  - Include Opam paths in Docker environment variables
  - Support both Rocq and Coq theorem provers across all deployment configurations

## 0.41.9

### Patch Changes

- 1635432: Add C/C++ development tools (CMake, Clang/LLVM, GCC, Make) to Ubuntu 24 server installation script with CI verification

## 0.41.8

### Patch Changes

- 80aff72: Add Deno runtime installation support to Ubuntu 24 server installation script and Docker environment

## 0.41.7

### Patch Changes

- 781a8e4: Fix: Upload logs when usage limit is reached

## 0.41.5

### Patch Changes

- 27bbc44: Add backslash detection and validation in GitHub URLs

  When users provide URLs with backslashes (e.g., `https://github.com/owner/repo/issues/123\`), the system now properly validates them and provides helpful error messages with auto-corrected URL suggestions. According to RFC 3986, backslash is not a valid character in URL paths.

  **Changes:**
  - Enhanced `parseGitHubUrl()` function to detect backslashes in URL paths
  - Updated all validation points (Telegram bot `/solve` and `/hive` commands, CLI `hive` and `solve` commands)
  - Provides user-friendly error messages with corrected URL suggestions
  - Comprehensive test suite for backslash validation scenarios

  Fixes #923

## 0.41.3

### Patch Changes

- db8cef7: Fix CLAUDE.md not being deleted in continue mode

  When a work session completes successfully but the CLAUDE.md commit hash was lost between sessions (e.g., due to session interruption), the system now attempts to detect the CLAUDE.md commit from the branch structure instead of silently skipping cleanup.

  **Safety Checks (Preventing Issue #617 Recurrence):**
  1. CLAUDE.md must exist in current branch
  2. Find merge base to isolate PR-only commits
  3. Must have at least 2 commits (CLAUDE.md + actual work)
  4. First commit message must match expected pattern
  5. First commit must ONLY change CLAUDE.md file

  Fixes #940

## 0.41.2

### Patch Changes

- 43d5e01: Add image format validation warning to system prompts to prevent "Could not process image" errors. AI solvers are now instructed to verify image files with the 'file' command before reading them, avoiding crashes from corrupted downloads or HTML 404 pages. Includes reference to case study documenting the root cause of GitHub image processing failures.

## 0.41.0

### Minor Changes

- 5d193ef: Add `--prompt-general-purpose-sub-agent` flag for Claude tool to enable general-purpose sub-agent usage prompting when processing large tasks with multiple files or folders

## 0.40.3

### Patch Changes

- f8ebd99: Make Playwright MCP usage guidelines conditional based on MCP availability
  - Add `checkPlaywrightMcpAvailability()` function to detect if Playwright MCP is installed
  - Conditionally include Playwright MCP section in Claude system prompt only when MCP is detected
  - Integration in both main execution (solve.mjs) and watch mode (solve.watch.lib.mjs)
  - Resolves merge conflicts from main branch

## 0.40.1

### Patch Changes

- 1ee78c9: fix: prefer Anthropic provider for public price calculation

  When calculating public pricing for Claude models, fetchModelInfo now checks the Anthropic provider first instead of using the first match from the models.dev API (which was Helicone). This ensures pricing calculations show "Provider: Anthropic" as expected.

## 0.40.0

### Minor Changes

- 9115337: Add --prompt-plan-sub-agent option to encourage Plan sub-agent usage. When enabled, the AI receives suggestive instructions to consider using the Plan sub-agent for initial research and planning, improving solution quality through better upfront analysis.

## 0.39.0

### Minor Changes

- 5751dbf: Add --prompt-explore-sub-agent option to encourage Claude to use Explore sub-agent for codebase exploration

## 0.38.9

### Patch Changes

- 40545f6: Consolidate CI/CD workflows to single release.yml following js-ai-driven-development-pipeline-template best practices
  - Removed verify-version-bump job (replaced by changeset-check)
  - Consolidated main.yml, ci.yml, and helm-pr-check.yml into release.yml
  - Added template scripts for release automation (validate-changeset, version-and-commit, publish-to-npm, etc.)
  - Tests now run before release on main branch
  - Added manual release support (instant and changeset-pr modes)
  - Maintained all existing hive-mind CI checks (docker-pr-check, helm-pr-check, memory-check, etc.)
