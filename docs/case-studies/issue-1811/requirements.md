# Requirements Extracted From Issue #1811

Issue #1811 is short but packs several distinct asks. Each requirement
below is keyed so it can be referenced from `solutions.md`, code
comments and the PR description.

## R1 — Find root causes of all false-positive "completed" and silent stalls and fix them

> "Some tasks in /hive command just stuck, and didn't finish without
> clear fail or stop. We need to find root causes of all false positives
> and errors, and fix them."

Acceptance criteria:

- A specific log line range is identified as the stall location
  (see [`root-causes.md`](./root-causes.md) — RC1).
- The hang is reproduced in a minimal unit/integration test
  (see [`solutions.md`](./solutions.md) — test plan).
- A fix prevents the same call site from hanging indefinitely:
  - Either the shell call resolves with an explicit timeout error, or
  - The hive parent's inactivity watchdog logs and (optionally) kills
    a silent worker.
- The fix degrades gracefully when the underlying `gh`/`api` call is
  simply slow but eventually succeeds.

## R2 — Compile the data into `./docs/case-studies/issue-{id}` and do a deep case study

> "We need to download all logs and data related about the issue to
> this repository, make sure we compile that data to
> `./docs/case-studies/issue-{id}` folder, and use it to do deep case
> study analysis (also make sure to search online for additional facts
> and data), in which we will reconstruct timeline/sequence of events,
> list of each and all requirements from the issue, find root causes
> of the each problem, and propose possible solutions and solution
> plans for each requirement (we should also check known existing
> components/libraries, that solve similar problem or can help in
> solutions)."

Acceptance criteria:

- Failing run log committed to
  `docs/case-studies/issue-1811/logs/hive-issue-1811.log`.
- Case study files present and cross-linked:
  - `README.md` (TL;DR + index)
  - `timeline.md` (reconstructed event sequence)
  - `requirements.md` (this file)
  - `root-causes.md` (root cause analysis)
  - `solutions.md` (implementation plan + components considered)
  - `upstream-issue-draft.md` (issue text for upstream repos)
- Solutions section explicitly evaluates existing components/libraries
  that solve the same problem (`p-timeout`, `AbortController`,
  Node 24 `Promise.race(..., signal)`, `cli/cli` request-timeout
  history, etc.).

## R3 — Add debug/verbose output if data is insufficient

> "If there is not enough data to find actual root cause, add debug
> output and verbose mode if not present, that will allow us to find
> root cause on next iteration."

Acceptance criteria:

- Per-shell-call verbose tracing in `verifyResults()` so we know which
  `gh` call is in flight when a hang happens.
- Hive parent emits periodic "worker is silent for N seconds" warnings
  under `--verbose`, configurable via
  `--worker-inactivity-warn-seconds` (default in ballpark of 5 min).
- An optional hard kill via `--worker-inactivity-kill-seconds`
  (default off / very large) so operators can opt-in to automatic
  recovery.
- `wrapDollarWithGhRetry` log a one-line trace on the first retry of
  any kind so a hung-then-retried call leaves evidence in the log.

## R4 — File upstream issues when the bug crosses repositories

> "If issue related to any other repository/project, where we can
> report issues on GitHub, please do so. Each issue must contain
> reproducible examples, workarounds and suggestions for fix the issue
> in code."

Acceptance criteria:

- Draft prepared for `cli/cli` ([gh](https://github.com/cli/cli))
  requesting a configurable default network timeout for
  `gh api`/`gh graphql` (see
  [`upstream-issue-draft.md`](./upstream-issue-draft.md)).
- The draft must include:
  - Minimum reproducible example (`gh api user` against an iptables
    DROP rule, or against `nc -l` that never responds).
  - Workaround as applied in our wrapper (timeoutMs option).
  - Suggested upstream fix (config key `network.timeout` and CLI flag
    `--timeout`).

## R5 — Plan and execute everything in this single pull request

> "Please plan and execute everything in this single pull request, you
> have unlimited time and context, as context auto-compacts and you can
> continue indefinitely, until it is each and every requirement fully
> addressed, and everything is totally done."

Acceptance criteria:

- All work happens on branch `issue-1811-7f33adedb747`.
- All changes land in PR #1812 (already exists, draft → ready when
  done).
- Tests and changeset entry included.
- PR description references this case study and the upstream draft.

## Non-goals

These are intentionally out of scope to keep the PR focused:

- Rewriting the hive worker as a state machine.
- Replacing `child_process.spawn` with `execa`/`tinyspawn`.
- Switching from polling `gh` to a websocket/event-driven GitHub
  client.
- Backporting the fix to a 1.x.x maintenance branch (we ship in the
  next minor — 1.72.0 → 1.73.0).
