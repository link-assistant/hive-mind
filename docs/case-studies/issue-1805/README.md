# Case Study: Issue #1805 — Add `--auto-resolve` option for `/merge` command

- Issue: https://github.com/link-assistant/hive-mind/issues/1805
- PR: https://github.com/link-assistant/hive-mind/pull/1806
- Date reported: 2026-05-15
- Reporter: @konard
- Related prior work:
  - #1143 (initial `/merge` command and the merge queue scaffolding)
  - #1190 (`--auto-merge` flag on `solve`)
  - #1269 (`/merge` error reporting + merge method)
  - #1292/#1294/#1339 (MarkdownV2 escaping fixes in merge progress messages)
  - #1407/#1588 (cancellation hardening)
  - #1341/#1307/#1425 (post-merge CI waits)
  - #1618 (solve command aliases)

## Summary

The Telegram `/merge` command currently walks every PR labelled `ready` and
merges them one by one. When a PR conflicts with the target branch, the merge
queue marks it **Skipped** with `PR has merge conflicts` (see screenshot in
[`data/issue-screenshot.png`](data/issue-screenshot.png) — PRs #32, #36, #48
were skipped while the queue happily merged the conflict-free ones). After the
queue finishes, the user has to copy each skipped PR URL by hand and run
`/solve <pr-url> --auto-merge` for the bot to actually resolve the conflict.

This issue asks for a single flag that automates that cleanup step. When
`/merge https://github.com/owner/repo --auto-resolve` is invoked:

1. Run the existing merge queue as today (merging the conflict-free PRs).
2. After the queue is done, iterate the PRs that got **Skipped because of
   merge conflicts** and, for each one, invoke the same flow as
   `/solve <pr-url> --auto-merge` (default model `sonnet`, which resolves
   the conflict and merges the PR).
3. Make every PR reference in the status messages render as a clickable
   MarkdownV2 link to the actual PR — today the `#NNN` text is plain.

## Reported observations (verbatim)

From the issue body:

> When `--auto-resolve` is enabled it should work like this — first it should
> merge everything that is mergable without conflicts. After that it should one
> by one do the same as `/solve <pull request> --auto-merge` does, which will
> actually resolve conflicts with default model (sonnet, and will merge the
> pull request).
>
> Also in the message each separate issue id + title should be clickable as a
> link to actual pull request. Not just text.

The attached screenshot (saved as
[`data/issue-screenshot.png`](data/issue-screenshot.png)) reproduces the
no-auto-resolve flow on `link-assistant/formal-ai`: 6/8 PRs processed, 3
merged, 3 skipped (#32, #36, #48 — all "PR has merge conflicts"), and the
"Queue" list rendering `\#34: …`, `\#32: …` as plain (escaped) text rather
than as links to the actual PRs.

## Requirements (extracted from the issue)

1. **R1** — Add a `--auto-resolve` (and the equivalent `--auto-resolve=true`)
   flag to the `/merge` Telegram command.
2. **R2** — When `--auto-resolve` is set, the queue must first run as today
   (merge every conflict-free PR). Nothing new for that pass.
3. **R3** — After the queue finishes, iterate the PRs that were **skipped
   because of merge conflicts** and, for each one, run the same flow as
   `/solve <pr-url> --auto-merge` (default tool, default model `sonnet`).
4. **R4** — Each PR entry in the status messages ("Queue:", "Issues:",
   "Results:") must be a clickable MarkdownV2 link to the PR. Issue refs
   in the same line (`(Issue #N)`) should link to the issue too.
5. **R5** — Compile a case-study folder at
   `./docs/case-studies/issue-1805/`. Include the source observations, a
   timeline reconstruction, a deep root-cause discussion, an inventory of
   reusable components/libraries, a list of solution candidates, and the
   chosen plan.
6. **R6** — Cross-check known components/libraries that already solve the
   sub-problems (Telegram MarkdownV2 link rendering, conflict resolution,
   queueing) before writing anything new.
7. **R7** — Deliver everything inside the existing pull request #1806 (one
   PR, no branching out).

## Timeline

Reconstructed from the recent commits on `main` and the existing PR #1806:

| Event                                                                           | When       |
| ------------------------------------------------------------------------------- | ---------- |
| #1143 introduces `/merge` + the `MergeQueueProcessor` (sequential PR merging).  | 2026-03    |
| #1190 lands `--auto-merge` for `solve`, including `attemptAutoMerge` reuse.     | 2026-03    |
| #1294 + #1339 make `/merge` surface the skip reason (`PR has merge conflicts`). | 2026-04    |
| #1801/#1802 — last unrelated change before #1805 (Telegram fallback fix).       | 2026-05-14 |
| #1805 filed with screenshot showing `/merge` skipping 3 conflicting PRs.        | 2026-05-15 |
| PR #1806 opened as `[WIP] Add --auto-resolve option for /merge command`.        | 2026-05-15 |
| This PR closes the loop (R1–R7).                                                | 2026-05-15 |

## Where the system is today

Reading the live tree:

- `src/telegram-merge-command.lib.mjs` (Telegraf entry point for `/merge`)
  - Parses args with a local `parseCommandArgs` that simply tokenises the
    first line after the command — nothing flag-aware.
  - Builds the `MergeQueueProcessor` and renders `formatProgressMessage()` /
    `formatFinalMessage()` straight into the original status message.
- `src/telegram-merge-queue.lib.mjs` (the queue itself)
  - `processItem()` calls `checkPRMergeable()`. If the result is `mergeable
=== false`, it marks the item as `SKIPPED` with the reason returned by
    `github-merge.lib.mjs` (`PR has merge conflicts` for `mergeStateStatus
=== 'DIRTY'`).
  - `formatProgressMessage()` and `formatFinalMessage()` render PR numbers
    as escaped MarkdownV2 text: `${item.emoji} \\#${item.prNumber}: …`.
    Items already carry `pr.url` (and, when an issue is linked, `issue.url`),
    but those are not used to build links.
- `src/solve.auto-merge.lib.mjs`
  - Exports `startAutoRestartUntilMergeable({ argv, owner, repo, prNumber, … })`
    which is the same entry point the `solve` CLI calls when `--auto-merge`
    is passed. It guards against forks, missing permissions, and then runs
    `watchUntilMergeable()` until the PR is mergeable, which in turn calls
    `attemptAutoMerge()`.
- `src/telegram-command-execution.lib.mjs`
  - Already has `executeStartScreen('solve', args)` which is the way the bot
    spawns isolated `solve` sessions today. This is the natural mechanism
    for invoking the per-PR conflict-resolution pass.

## Root cause / why the gap exists

The merge queue treats _every_ skip the same: the user is expected to fix
conflicts manually and re-trigger `/merge`. There is no awareness of which
PRs were skipped because of conflicts (a fixable state via AI) vs because of
failing CI (a non-fixable state without source changes).

For the link-rendering gap: the items in the queue do hold the GitHub URL
(`pr.url`), but the renderer never emits the MarkdownV2 link syntax — it
escapes the `#` and shows raw text. This is a holdover from the original
#1143 implementation that prioritised simple text formatting.

## Reusable components already in the repo

| Need                                      | Existing helper                                                                                                  | File                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Parse `/<command> args` into a flag array | `parseCommandArgs(text)`                                                                                         | `src/telegram-merge-command.lib.mjs`                                     |
| MarkdownV2 escaping                       | `escapeMarkdownV2(text)` and `MergeQueueProcessor.escapeMarkdown`                                                | `src/telegram-merge-command.lib.mjs`, `src/telegram-merge-queue.lib.mjs` |
| Identify "PR has conflicts" skip          | `checkPRMergeable()` returns `{ mergeable:false, reason:'PR has merge conflicts' }`                              | `src/github-merge.lib.mjs`                                               |
| Run `/solve … --auto-merge` flow          | `startAutoRestartUntilMergeable()` (in-process) or `executeStartScreen('solve', […, '--auto-merge'])` (isolated) | `src/solve.auto-merge.lib.mjs`, `src/telegram-command-execution.lib.mjs` |
| Yargs-style arg parsing for command flags | `parseArgsWithYargs(args, yargsFactory, createYargsConfig)`                                                      | `src/telegram-solve-command.lib.mjs`                                     |
| Linking PRs to issues                     | `getAllReadyPRs()` already populates `issue.url` next to `pr.url`                                                | `src/github-merge.lib.mjs`                                               |

External components surveyed:

- **Telegraf** — handles `inline_keyboard` buttons; not needed here, the
  links sit inside MarkdownV2 body text.
- **Telegram MarkdownV2** — the same syntax (`[label](url)`) used elsewhere
  in `formatFinalMessage()` for "View" links on failed CI runs. We follow
  that style.
- **GitHub CLI (`gh pr view --json mergeStateStatus`)** — already used by
  `checkPRMergeable()` so no new GitHub library is required.
- **No new npm dependency** — every piece is reachable from the in-tree
  helpers above.

## Solution candidates per requirement

### R1 — `--auto-resolve` flag

| Candidate                                    | Notes                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| (A) Plain string-match in `parseCommandArgs` | Cheapest — scan `args` for `--auto-resolve` and strip it. No new dep, mirrors the existing simple parser.                |
| (B) Reuse `parseArgsWithYargs`               | More flexible (`--auto-resolve=false` etc.) but pulls yargs into the merge command which currently has no yargs surface. |

**Decision:** (A). The `/merge` command only has one positional argument
(repo URL); adding yargs is over-engineering. We accept `--auto-resolve`,
`--auto-resolve=true`, `--auto-resolve=false`, and an optional `--no-auto-resolve`.

### R2 — Run the normal queue first

The existing flow already does this. The only change is that we keep the
`SKIPPED` items around (already in `processor.items`) so the new auto-resolve
pass can pick them up.

### R3 — Auto-resolve loop

| Candidate                                                                 | Notes                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (A) Call `startAutoRestartUntilMergeable()` directly in-process           | Tight feedback loop, but blocks the bot's event loop on long Claude calls and bypasses the existing isolation/session tracking. Also requires reproducing the rest of the `solve.mjs` bootstrap.                                                                                                                         |
| (B) Spawn `solve` via the same `executeStartScreen` path as `/solve` uses | Aligns with how the bot already runs work sessions: a screen session is launched and tracked, the user can `/log` and `/watch` it like any other solve session, and we benefit from the existing watch/isolation infrastructure. Each session runs `--auto-merge`, which already does the right thing (resolve + merge). |
| (C) Reimplement conflict resolution inside the merge queue                | Massive duplication — `solve.auto-merge.lib.mjs` is ~1.3 kLOC and full of edge cases (fork detection, billing limits, CI re-runs).                                                                                                                                                                                       |

**Decision:** (B). It is the smallest change, keeps a single source of truth
for "resolve a conflict and auto-merge a PR", and the user sees the same
log/watch experience as any other `/solve`. The merge command runs each PR's
solve session sequentially, gated on the previous session's screen
disappearing, so we don't fan out unbounded Claude usage.

### R4 — Clickable PR/issue links

Build a small `formatPrLink(item)` helper that emits MarkdownV2 link syntax:

```
[\#NNN: title…](https://github.com/owner/repo/pull/NNN)
```

…and use it in three places:

1. Inline current-item ("…escapeMarkdown(update.current)") in
   `formatProgressMessage()`.
2. The "Issues:" list — same items, just escaped link form.
3. The "Queue:" list and the "Results:" list (final message).

The issue suffix (`(Issue #N)`) gets the same treatment using `issue.url`.

URL escaping rules per Telegram MarkdownV2:

- `)` and `\` inside the URL must be backslash-escaped.
- Label text is escaped with the existing `escapeMarkdown()`.

### R5/R6/R7 — Documentation, components, single PR

This case-study folder is the deliverable for R5/R6. PR #1806 hosts the
implementation (R7).

## Solution plan

1. **Case study** (this folder) — done in the first commit.
2. **`/merge` command** — strip `--auto-resolve` from args, parse the
   repo URL, pass the flag through `createMergeQueueProcessor()`. Already
   filters the args before validating the URL so existing usage is
   unchanged.
3. **`MergeQueueProcessor`** —
   - Add `autoResolve` constructor option.
   - Add `getConflictedItems()` helper that returns items with
     `status === SKIPPED && error === 'PR has merge conflicts'`.
   - Add `runAutoResolve(spawnSolveSession)` async method that, for each
     conflicted item, awaits `spawnSolveSession({ url, owner, repo, prNumber })`
     and records the outcome (`resolved`, `failed`, `skipped`).
   - Track new stats (`autoResolved`, `autoResolveFailed`) and surface them
     in both messages.
4. **Renderers** — replace the plain `\#NNN: title` lines with the new
   link-emitting helper. Keep the truncation behaviour. Reuse the same
   helper for the final message.
5. **`telegram-merge-command.lib.mjs`** — inject a `spawnSolveSession`
   that calls `executeStartScreen('solve', [prUrl, '--auto-merge'])` (plus
   the verbose flag we already plumb). Update progress/final messages from
   the existing `onProgress` callback.
6. **Tests** — extend `tests/test-merge-queue.mjs` with:
   - `--auto-resolve` arg parsing (in command lib).
   - `getConflictedItems()` selection.
   - `runAutoResolve()` happy/failure paths (with a stub spawner).
   - Link rendering in progress/final messages.
7. **PR #1806** — switch to "ready", update title/body, run `npm test`
   subset, mention this case study.

## Why this is safe

- The merge queue's existing behaviour is unchanged when `--auto-resolve`
  is absent. The new code path is gated on the flag.
- Spawning `solve` per PR runs sequentially, matching the same back-pressure
  the queue already enforces between merges; no extra fan-out.
- Each spawned `solve` session is the exact same command path users invoke
  today, so all of its safeguards (fork detection, permission checks,
  billing-limit handling) keep applying.
- MarkdownV2 link rendering is additive — items without a URL fall back to
  the plain `\#NNN` text we render today.

## Manual verification plan

1. Local lint (`npm run -s lint:merge` if available, otherwise the relevant
   subset).
2. Targeted unit tests: `node tests/test-merge-queue.mjs`.
3. Targeted parser tests for the new flag.
4. Visual rendering: render a fixture progress/final message in a Node
   script (kept in `experiments/`) and confirm Telegram-style escaping is
   preserved and links round-trip through `escapeMarkdown`.
