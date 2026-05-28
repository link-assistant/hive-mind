# Case Study: Issue #1827 — False-positive "new comment" auto-restart loop

## Summary

On [`link-foundation/rust-web-box` PR #34](https://github.com/link-foundation/rust-web-box/pull/34)
hive-mind's `--auto-restart-until-mergeable` loop restarted the AI five times in
a row, each time reporting `Reason: New comment(s) from non-bot user(s): konard`,
until it hit the configured restart limit of 5 and gave up — even though **no
human ever commented**.

The "new comments" were hive-mind's _own_ free-form status comments. During a
session the AI agent posted plain status updates (e.g. `## ✅ CI now green on
774f52f`) through the authenticated GitHub account (`konard`). Those comments
are **not** routed through `postTrackedComment()`, so their IDs were never
recorded, and they carry **none** of the tool markers in `tool-comments.lib.mjs`.
The next monitoring iteration therefore saw a same-account, marker-less,
"recent" comment and classified it as fresh human feedback — restarting the
loop. The restart-iteration-2 verification comment that hive-mind itself posted
even states the diagnosis verbatim:

> This iteration was triggered by the prior session's own `CI now green` status
> comment being read as non-bot feedback; there was no new actionable human
> comment.
>
> — [PR #34 comment `4553526838`](https://github.com/link-foundation/rust-web-box/pull/34#issuecomment-4553526838)

Two independent factors combined to cause this:

1. **A rewound check window.** In `watchUntilMergeable` the restart branch set
   `lastCheckTime = new Date()` (after the AI session, _past_ the agent's own
   comments), but the code at the bottom of the loop then unconditionally
   overwrote it with `lastCheckTime = currentTime` — a timestamp captured at the
   _start_ of the iteration, _before_ the AI ran. That rewound the window back
   to before the agent's comments, so they re-qualified as "new".
2. **Same-account comments became trusted.** Issue #1821 made the auto-restart
   loop pass `trustAuthenticatedUserComments: true`, which (correctly) lets a
   human reviewer using the same account as the bot be heard — but it also
   removed the blanket "ignore same-account comments" net that had previously
   masked this loop. With that net gone, the agent's own untracked comments were
   no longer filtered.

The fix has three parts, applied across **both** watch loops
(`auto-restart-until-mergeable` and `--watch`):

- **Fix A — monotonic check window.** `lastCheckTime` is now advanced via
  `nextMonotonicCheckTime(lastCheckTime, currentTime)`, which never moves the
  cutoff backwards.
- **Fix B — track the account's own session comments.** After every AI session,
  `trackAuthenticatedUserCommentsSince()` records the IDs of every comment the
  authenticated account posted during the session window, so
  `checkForNonBotComments` filters them by ID regardless of timestamps (this
  also survives clock skew, which a time-only cutoff cannot).
- **Fix C — feedback counting respects tool comments.** `detectAndCountFeedback`
  (used by `--watch`) now excludes tool-generated comments by marker **and** by
  tracked ID, both for comments from this run and (via markers) from previous
  runs.

## Local Evidence

Downloaded evidence is stored in this folder:

- `data/hive-mind-issue-1827.json` — the original hive-mind issue.
- `data/hive-mind-issue-1827-comments.json` — issue comments (none at time of writing).
- `data/hive-mind-pr-1828.json` — the prepared pull request.
- `data/pr-34.json` — the `rust-web-box` PR where the loop occurred.
- `data/pr-34-issue-comments.json` — PR conversation comments (the full loop, 18 comments).
- `data/pr-34-review-comments.json` — PR inline review comments.
- `research-sources.json` — external references and related issues.

## Timeline

All timestamps are UTC, from `data/pr-34-issue-comments.json`. Every comment was
authored by the same account, `konard`.

| Time     | Comment ID   | Event                                                                                                                          |
| -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 09:44:41 | `4553385200` | Working-session summary posted (tool marker `<!-- hive-mind:working-session-summary -->`).                                     |
| 09:44:52 | `4553386410` | Solution Draft Log posted (tool marker).                                                                                       |
| 09:47:03 | `4553401616` | **Auto-restart iteration 1** — `Reason: CI failures detected` (a legitimate trigger). New AI session starts.                   |
| 09:56:14 | `4553469248` | Agent posts a **free-form** status comment: `## ✅ CI now green on 774f52f` — no tool marker, ID never tracked.                |
| 09:58:02 | `4553481811` | Auto-restart-until-mergeable Log (iteration 1) posted (tool marker).                                                           |
| 10:00:13 | `4553497476` | **Auto-restart iteration 2** — `Reason: New comment(s) from non-bot user(s): konard`. ← first false positive.                  |
| 10:04:25 | `4553526838` | Agent's verification comment explicitly notes it was triggered by its own `CI now green` comment; no real feedback found.      |
| 10:06:54 | `4553544447` | **Auto-restart iteration 3** — same false `non-bot user(s): konard` reason.                                                    |
| 10:11:14 | `4553576297` | Verification pass (iteration 3) — again triggered by the prior iteration's own status comment.                                 |
| 10:14:25 | `4553597610` | **Auto-restart iteration 4** — same false reason.                                                                              |
| 10:19:23 | `4553632335` | Verification pass (iteration 4) — triggered by the iteration-3 verification comment.                                           |
| 10:21:53 | `4553648759` | **Auto-restart iteration 5** — same false reason.                                                                              |
| 10:25:58 | `4553676406` | Final verification (iteration 5, last).                                                                                        |
| 10:29:15 | `4553699345` | **⚠️ Auto-restart limit reached** — stopped after 5 restarts, `Remaining reason: New comment(s) from non-bot user(s): konard`. |

The loop is unmistakable: every "Verification pass" comment becomes the trigger
for the next restart. No human comment exists anywhere in the sequence.

## Requirements (from the issue)

1. Keep track of all comments sent by the system (`solve` command) while the AI
   (claude/codex) was **not** active, and do not react to them as new comments.
   Track the comment IDs created during a single `solve` execution in memory.
2. Also check pattern matching for comments created by **previous** `solve` runs.
3. Download all related logs/data into `docs/case-studies/issue-1827/` and write
   a deep case study: timeline, full requirements list, root causes, and
   solution plans; search online for additional facts; check existing
   components/libraries that solve a similar problem.
4. If there is not enough data to find the root cause, add debug output / verbose
   mode.
5. If the issue relates to another repository where issues can be reported, file
   one with reproducible examples, workarounds, and code suggestions.
6. Apply the fix across the **entire codebase** — fix every place that has the
   problem, not just one.
7. Plan and execute everything in the single PR #1828.

## External Research

GitHub exposes multiple comment surfaces for a pull request. A pull request _is_
an issue with code, so **conversation** comments use the Issues comments endpoint
(`/repos/{owner}/{repo}/issues/{number}/comments`) while **inline** comments use
the pull request review comment endpoint (`/repos/{owner}/{repo}/pulls/{number}/comments`)
([Working with comments](https://docs.github.com/en/rest/guides/working-with-comments),
[issue comments](https://docs.github.com/en/rest/issues/comments),
[review comments](https://docs.github.com/en/rest/pulls/comments)). hive-mind
already fetches both surfaces, so this incident was not caused by the wrong
endpoint — it was a post-fetch classification problem.

The "automation reacts to events it produced itself" loop is a well-known class
of bug in GitHub automation. In GitHub Actions the platform breaks it on the
infrastructure side: the default `GITHUB_TOKEN` is deliberately configured so
that pushes/comments it makes do **not** re-trigger workflows
([community #74772](https://github.com/orgs/community/discussions/74772),
[community #26970](https://github.com/orgs/community/discussions/26970)). The
common application-level mitigations are **identity checks** (skip events whose
actor is the bot) and **skip markers** in the payload. hive-mind has no
platform-level guard for AI-authored comments, so it must apply both mitigations
itself: identity (the account is busy running the AI during the session window,
so its comments are the tool's own) and markers/tracked IDs.

## Root Cause

### Factor 1 — `lastCheckTime` rewound after each restart

`watchUntilMergeable` (`src/solve.auto-merge.lib.mjs`) used one timestamp,
`lastCheckTime`, as the "only consider comments newer than this" cutoff for
`checkForNonBotComments`. The restart branch correctly advanced it past the AI
session:

```js
// after the AI session finishes (restart branch)
lastCheckTime = new Date();
```

…but the very bottom of the loop body then unconditionally overwrote it:

```js
// end of every iteration
lastCheckTime = currentTime; // currentTime was captured at the START of the iteration
```

`currentTime` was taken _before_ the AI ran, so the second assignment rewound the
window to before the agent's own `CI now green` comment, making that comment look
new on the next pass.

### Factor 2 — same-account comments are now trusted (since #1821)

Before #1821, `checkForNonBotComments` treated _every_ comment from the
authenticated account as bot-owned and filtered it. That masked Factor 1: the
agent's own comments were dropped anyway. Issue #1821 (rightly) introduced
`trustAuthenticatedUserComments: true` for the auto-restart loop so a human using
the same account as the bot can be heard. That removed the mask and exposed the
loop: the agent's untracked, marker-less comments now counted as feedback.

### Why markers and tracked IDs didn't already catch it

`tool-comments.lib.mjs` filters comments that either carry a known marker (e.g.
`Auto-restart`, `Solution Draft Log`, `<!-- hive-mind:working-session-summary -->`)
or whose ID was registered via `postTrackedComment()`. The agent's free-form
status comments go through neither path — they are written directly by the AI
during the session — so nothing filtered them.

## Existing Components Checked

- `src/tool-comments.lib.mjs` — central registry of markers, the in-memory
  `trackedToolCommentIds` set, `trackToolCommentId` / `isToolTrackedCommentId`,
  and `postTrackedComment`. This is exactly the right component to reuse; the gap
  was that comments authored directly by the AI never reached it.
- `checkForNonBotComments` (`src/solve.auto-merge-helpers.lib.mjs`) — already
  filters by marker + tracked ID after #1821. It needed the agent's own comment
  IDs to actually be tracked (Fix B) and a stable window (Fix A).
- `detectAndCountFeedback` (`src/solve.feedback.lib.mjs`) — the `--watch`
  counterpart. It filtered some log-shaped comments by regex but did **not**
  exclude tool comments by marker/ID, so it had the same latent bug (Fix C).
- `src/solve.results.lib.mjs` — already uses `isToolGeneratedComment` /
  `isToolTrackedCommentId`; used as the reference pattern.

No new third-party library is required. The fix reuses the existing
`tool-comments.lib.mjs` registry and adds one pure helper for the monotonic
window.

## Fix

### Fix A — monotonic check window (`solve.auto-merge.lib.mjs`)

New pure helper in `solve.auto-merge-helpers.lib.mjs`:

```js
export const nextMonotonicCheckTime = (lastCheckTime, candidate) => {
  if (!(lastCheckTime instanceof Date)) return candidate;
  if (!(candidate instanceof Date)) return lastCheckTime;
  return candidate.getTime() > lastCheckTime.getTime() ? candidate : lastCheckTime;
};
```

The end-of-iteration assignment becomes
`lastCheckTime = nextMonotonicCheckTime(lastCheckTime, currentTime);` so the
cutoff set by the restart branch is never pulled backwards. In the non-restart
branches `lastCheckTime` is still the previous iteration's value (< `currentTime`),
so the cutoff still advances normally.

### Fix B — track the account's own session comments (both loops)

New helper `trackAuthenticatedUserCommentsSince(owner, repo, prNumber, issueNumber, sinceTime, $, options)`:
resolves the authenticated login (`gh api user --jq .login`), fetches PR
conversation, PR review, and (if different) issue comments, and for every comment
authored by that account at or after the session-start time, calls
`trackToolCommentId(comment.id)`. It is invoked **after each AI session** in both
`watchUntilMergeable` (`solve.auto-merge.lib.mjs`) and `watchForFeedback`
(`solve.watch.lib.mjs`), using each loop's `iterationStartTime` as the window
start. Because the account is busy running the AI for the whole window, any
comment it authored in that window is the tool's own, not human feedback.

### Fix C — feedback counting respects tool comments (`solve.feedback.lib.mjs`)

`detectAndCountFeedback` now defines
`isToolComment = c => isToolTrackedCommentId(c.id) || isToolGeneratedComment(c.body)`
and returns `false` early for such comments in both the PR-comment filter and the
issue-comment filter. Marker matching (requirement 2) also covers comments from
**previous** `solve` runs whose in-memory IDs are gone but whose body still
carries a tool marker.

## Verification

- `experiments/issue-1827-reproduce-false-positive-loop.mjs` reproduces the loop
  with the real `checkForNonBotComments` + tracking helpers: the buggy backwards
  window re-detects the AI comment (false positive), Fix A (advanced window) and
  Fix B (tracked ID) each suppress it, and a genuine `reviewer` human comment is
  still detected.
- `tests/test-issue-1827-false-positive-comments.mjs` (`@hive-mind-test-suite
default`) covers all three defenses:
  - **A.** `nextMonotonicCheckTime` never rewinds, advances forward, handles
    degenerate inputs.
  - **B.** `trackAuthenticatedUserCommentsSince` tracks only same-account
    in-window comments; a genuine reviewer comment still triggers detection even
    when the window is (buggily) rewound.
  - **B2.** Documents the gap: an untracked free-form same-account comment would
    falsely trigger; tracking it removes the false positive.
  - **C.** `detectAndCountFeedback` counts exactly one genuine human comment and
    excludes both the marker comment and the tracked-ID comment.
- `tests/test-issue-1821-auto-restart-same-user-feedback.mjs` still passes —
  genuine same-account human feedback is still detected.

## Requirement Coverage

| #   | Requirement                                                         | Where addressed                                                                                              |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Track system comments posted while AI inactive; don't react to them | Fix B (`trackAuthenticatedUserCommentsSince`), in-memory `trackedToolCommentIds`.                            |
| 2   | Pattern matching for comments from previous runs                    | Fix C marker check (`isToolGeneratedComment`) + existing marker filter in `checkForNonBotComments`.          |
| 3   | Download data + deep case study                                     | This folder (`README.md`, `data/`, `research-sources.json`).                                                 |
| 4   | Add debug/verbose output if data insufficient                       | Verbose logging in `trackAuthenticatedUserCommentsSince` and both loops (`🧷 Tracked own session comments`). |
| 5   | Report to other repo if applicable                                  | See "External Issue" below — root cause is entirely within hive-mind; no external bug.                       |
| 6   | Fix everywhere the problem exists                                   | Fixes applied to `auto-merge` loop (A+B), `watch` loop (B+C), and shared `feedback`/`helpers` libs.          |
| 7   | One PR                                                              | PR #1828.                                                                                                    |

## External Issue

No external issue was filed. `link-foundation/rust-web-box` PR #34 is only the
**venue** where the loop was observed; the defective logic lives entirely in
hive-mind (`solve.auto-merge.lib.mjs` / `solve.auto-merge-helpers.lib.mjs` /
`solve.feedback.lib.mjs` / `solve.watch.lib.mjs`). There is no upstream/external
project to report a bug against — the fix belongs in this repository, in PR #1828.

## Follow-up Options

- Route _all_ AI-authored status comments through `postTrackedComment()` so their
  IDs are tracked at the source, making the after-the-fact reconciliation in
  Fix B a redundant safety net rather than the primary defense.
- Consider persisting tracked comment IDs across `solve` restarts (currently the
  in-memory set is per-process; cross-run coverage relies on markers).
- Emit aggregate skip counts in non-verbose mode if comment classification needs
  to be audited in a future incident.
