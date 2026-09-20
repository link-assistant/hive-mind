# Issue #2123 case study: auto-restart started a working session on a non-draft pull request

## Executive summary

On 2026-07-31 the Hive Mind run on [link-assistant/formal-ai#880](https://github.com/link-assistant/formal-ai/pull/880)
finished its main session, converted the pull request to **ready for review**, and then immediately
started another working session ("Auto-restart 1/5 — Detected uncommitted changes from previous
run") **without converting the pull request back to draft**. Reviewers therefore saw a PR advertised
as ready while an AI was still rewriting it.

The GitHub timeline of PR #880 proves it:

| Time (UTC, 2026-07-31) | Timeline event / comment                              |
| ---------------------- | ----------------------------------------------------- |
| 05:10:15               | `convert_to_draft` (session start)                    |
| 05:10:17               | 🤖 **AI Work Session Started** comment                |
| 12:22:34               | Working session summary comment                       |
| 12:22:37               | `ready_for_review` (end of the main session)          |
| 12:23:08               | 🤖 Solution Draft Log comment                         |
| 12:23:19               | 🔄 **Auto-restart 1/5** — new working session started |
| —                      | **no `convert_to_draft` event follows**               |

The root cause is structural: draft handling existed in exactly one place —
`startWorkSession()` in `src/solve.session.lib.mjs` — and restart/resume iterations never call it.
They call `executeToolIteration()` in `src/solve.restart-shared.lib.mjs`, which had no draft
handling at all. Additionally the one existing conversion was gated behind
`argv.watch || argv.autoContinue`, so a plain continue-mode session (`solve <pr-url>`) also left the
PR marked ready.

The fix introduces `src/pr-draft-state.lib.mjs` as the single source of truth for draft/ready
transitions and calls it from every session-start path.

## Preserved evidence

`source/` contains the data used in this analysis, all fetched with authenticated `gh api`:

- [issue-2123.json](source/issue-2123.json) and [issue-2123-comments.json](source/issue-2123-comments.json) —
  the issue as reported (no comments at analysis time);
- [formal-ai-pr-880.json](source/formal-ai-pr-880.json) — the affected PR
  (`"draft": false`, `"state": "open"` at capture time);
- [formal-ai-pr-880-conversation-comments.json](source/formal-ai-pr-880-conversation-comments.json) —
  the full comment stream, including the referenced
  [auto-restart comment](https://github.com/link-assistant/formal-ai/pull/880#issuecomment-5142816039);
- [formal-ai-pr-880-timeline.json](source/formal-ai-pr-880-timeline.json) — the timeline with the
  three `convert_to_draft` / `ready_for_review` events quoted above;
- [pr-2124-initial.json](source/pr-2124-initial.json) — the state of this fix's PR before the fix.

## Timeline of events (reconstructed)

1. **2026-07-30 17:09** PR #880 is opened by an earlier Hive Mind run.
2. **2026-07-30 19:10** `ready_for_review` — that run ends.
3. **2026-07-31 05:08** A human posts feedback ("We need make the analysis deeper…").
4. **2026-07-31 05:10:15** A new session starts. `startWorkSession()` runs with
   `--auto-continue`/`--watch` in effect, so the gate passes and the PR is converted to draft.
   The **AI Work Session Started** comment is posted two seconds later.
5. **2026-07-31 12:22:34–12:23:08** The session ends: working-session summary, `ready_for_review`
   (from `showSessionSummary()`/`verifyResults()` in `src/solve.results.lib.mjs`), Solution Draft Log.
6. **2026-07-31 12:23:19** `solve.mjs` detects uncommitted changes and enters _temporary watch_
   mode. `startWatchMode()` posts "Auto-restart 1/5" and calls `executeToolIteration()`.
   No draft conversion happens — the PR stays **ready for review** for the whole restart iteration.

## Requirements extracted from the issue

| #   | Requirement                                                                            | Status                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R1  | When a working session **starts**, put the PR into draft if it is not already a draft. | Done — `startWorkSession()` calls `ensurePullRequestIsDraft()` for every continue-mode session.           |
| R2  | Same for **restart** and **resume** sessions.                                          | Done — `executeToolIteration()` drafts the PR before every restart/resume iteration.                      |
| R3  | Apply this **everywhere** in the codebase, not just in the one reported place.         | Done — all restart loops funnel through `executeToolIteration()`; see "Coverage matrix" below.            |
| R4  | Collect the related logs/data into `docs/case-studies/issue-2123`.                     | Done — `source/`, this document.                                                                          |
| R5  | Reconstruct the timeline, list requirements, find root causes, propose solutions.      | Done — this document.                                                                                     |
| R6  | Add debug output / verbose mode if the data is insufficient to find the root cause.    | Done — `getPullRequestDraftState()` logs `isDraft`/`state` under `--verbose`; every transition is logged. |
| R7  | Check existing components/libraries that solve a similar problem.                      | Done — see "Prior art".                                                                                   |
| R8  | Report issues to other affected repositories if the problem originates there.          | Not applicable — see "Third-party repositories".                                                          |

## Root cause analysis

### Root cause 1 — restart/resume iterations had no draft handling (primary)

`startWorkSession()` was the only code that converted a PR to draft. Restart/resume iterations do
not go through it; every one of them goes through `executeToolIteration()`:

| Caller                             | Mode                                               | Went through `startWorkSession()`? |
| ---------------------------------- | -------------------------------------------------- | ---------------------------------- |
| `src/solve.watch.lib.mjs`          | `--watch` and temporary auto-restart               | No                                 |
| `src/solve.auto-merge.lib.mjs`     | `--auto-merge` / `--auto-restart-until-mergeable`  | No                                 |
| `src/solve.escalate.lib.mjs`       | escalation loop (#1885)                            | No                                 |
| `src/solve.keep-working.lib.mjs`   | keep-working-until-done (#1883)                    | No                                 |
| `src/solve.auto-ensure.lib.mjs`    | auto-ensure-requirements                           | No                                 |
| `src/solve.mjs` (placeholder path) | auto-restart on non-updated PR description (#1162) | No                                 |

Because `verifyResults()` converts the PR to ready **before** those loops run, every one of them
worked on a PR presented as ready.

### Root cause 2 — the single conversion was gated behind `--watch`/`--auto-continue`

```js
// before
if (isContinueMode && prNumber && (argv.watch || argv.autoContinue)) {
```

A plain `solve <pr-url>` continue-mode session skipped the conversion entirely.

### Root cause 3 — limit-reset resume lost `--auto-continue`

`autoContinueWhenLimitResets()` re-launches `solve.mjs` with the **issue** URL. It forwarded
`--session-type auto-resume|auto-restart` but not `--auto-continue`, so the new process never
entered continue mode, never resolved the existing PR, and therefore could not draft it — the
`AUTO_RESUME_ON_LIMIT_RESET` / `AUTO_RESTART_ON_LIMIT_RESET` session comments were unreachable for
the same reason.

### Root cause 4 — duplicated, un-testable inline logic

The draft and ready conversions were two nearly identical inline blocks (`gh pr view --json isDraft`
plus `gh pr ready [--undo]`) with no shared abstraction, so there was no place to fix once and no
seam for a unit test. They also did not check whether the PR was merged or closed, where GitHub
rejects the state change.

## Solution implemented

### `src/pr-draft-state.lib.mjs` (new)

Single source of truth exposing:

- `getPullRequestDraftState({owner, repo, prNumber, $, log})` — reads `isDraft` and `state`, logs
  them under `--verbose`, never throws;
- `ensurePullRequestIsDraft(...)` — converts to draft when needed;
- `ensurePullRequestIsReady(...)` — converts back to ready when needed.

Both return `{ok, changed, skipped, reason, error}` and are no-ops when the PR is already in the
target state, or is merged/closed, or when there is no PR context. Failures are logged as warnings
and reported to Sentry through the injected `reportError`, never propagated — a draft-state problem
must not abort a working session.

### Call sites

| File                               | Change                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/solve.session.lib.mjs`        | `startWorkSession()` drafts for **every** continue-mode session with a PR; `endWorkSession()` mirrors it with the ready conversion. Session comments keep their previous `--watch`/`--auto-continue` gate. |
| `src/solve.restart-shared.lib.mjs` | `executeToolIteration()` drafts the PR before the AI tool runs — covering all six restart loops in one place.                                                                                              |
| `src/solve.auto-continue.lib.mjs`  | forwards `--auto-continue` to the resumed/restarted process so it re-attaches to the existing PR.                                                                                                          |

### Coverage matrix after the fix

| Session start path                                | Draft conversion via                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `solve <pr-url>` (continue mode)                  | `startWorkSession()`                                                                         |
| `solve <issue-url> --auto-continue`               | `startWorkSession()`                                                                         |
| `--watch` iteration                               | `executeToolIteration()`                                                                     |
| temporary auto-restart (uncommitted changes)      | `executeToolIteration()`                                                                     |
| `--auto-restart-until-mergeable` / `--auto-merge` | `executeToolIteration()`                                                                     |
| escalate / keep-working / auto-ensure             | `executeToolIteration()`                                                                     |
| auto-restart on placeholder PR description        | `executeToolIteration()`                                                                     |
| auto-resume / auto-restart on limit reset         | new process → `startWorkSession()` (now reachable thanks to the forwarded `--auto-continue`) |
| first session on a freshly created PR             | the PR is created with `gh pr create --draft`                                                |

## Prior art / existing components considered

- **`gh pr ready --undo`** (GitHub CLI) — the only supported way to convert a PR to draft from the
  CLI; the GraphQL alternative is `convertPullRequestToDraft`. `gh` is already a hard dependency, so
  no new dependency was introduced.
- **`src/github-rate-limit.lib.mjs`** — all `gh` traffic is expected to go through a
  rate-limit-retrying `$`; the new module accepts the caller's already-wrapped `$` and declares the
  `wrapDollarWithGhRetry` marker required by the `gh-rate-limit/no-direct-gh-exec` ESLint rule.
- **`src/solve.pr-base-guard.lib.mjs`** (`ensurePullRequestBaseBranch`) — the closest existing
  pattern: an idempotent "ensure the PR is in the expected state" guard. `pr-draft-state.lib.mjs`
  deliberately follows the same naming and shape.
- **`src/solve.results.lib.mjs`** keeps its own end-of-session ready conversion; it is idempotent
  with the new helper because each helper checks the current state first.

## Third-party repositories

No third-party bug is involved. `gh pr ready --undo` behaves as documented; the failure was entirely
in Hive Mind's control flow. Consequently no issue was filed against another repository.

## Reproduction and verification

`tests/pr-draft-on-session-start-2123.test.mjs` covers both layers:

- behavior tests drive `ensurePullRequestIsDraft`/`ensurePullRequestIsReady` with a fake `$`
  and assert the exact `gh` commands, the no-op cases (already draft, merged, closed, no PR) and
  the non-throwing error paths;
- wiring tests assert that `startWorkSession()` no longer carries the `--watch`/`--auto-continue`
  gate or an inline `gh pr ready` call, that `executeToolIteration()` drafts the PR **before** the
  AI tool runs, and that the limit-reset resume forwards `--auto-continue`.

The wiring assertions fail against the pre-fix sources, which is what makes this a regression test
rather than a description of the current code.

## Debug output added

Every transition now logs its decision, and `--verbose` adds the raw state read:

```text
   🔍 PR #880 draft state: isDraft=false, state=OPEN
  📝 Converting PR:  To draft mode (restart iteration)...
  ✅ PR converted:   Now in draft mode
```

If a future report claims a session ran on a non-draft PR, these lines identify whether the check
ran at all, what GitHub reported, and whether the conversion command failed.
