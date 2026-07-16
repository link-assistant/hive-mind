# Case Study — Issue #1959: `Branch operation failed` is not descriptive enough

> **Issue:** [link-assistant/hive-mind#1959](https://github.com/link-assistant/hive-mind/issues/1959)
> **Pull request:** [link-assistant/hive-mind#1960](https://github.com/link-assistant/hive-mind/pull/1960)
> **Reported by:** @konard · 2026-06-20 · label: `bug`
> **Origin incident:** [rumaster/tg-games#377 (comment 4758245187)](https://github.com/rumaster/tg-games/issues/377#issuecomment-4758245187)
> **Affected version:** `solve` v2.0.8 (incident log) — fixed for v2.0.13+

This folder contains the raw evidence and the full analysis for issue #1959.

| File                                                           | What it is                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| [`raw/issue-1959.json`](./raw/issue-1959.json)                 | The GitHub issue #1959 as JSON (body, labels, metadata).       |
| [`raw/issue-screenshot.png`](./raw/issue-screenshot.png)       | The Telegram screenshot attached to the issue.                 |
| [`raw/tg-games-issue-377.json`](./raw/tg-games-issue-377.json) | The external issue where the failure was reported.             |
| [`raw/failed-comment.md`](./raw/failed-comment.md)             | The full "Solution Draft Failed" comment posted by the solver. |
| [`raw/solve-failure-log.txt`](./raw/solve-failure-log.txt)     | The complete 15 KB `solve.mjs` failure log from the incident.  |

---

## 1. Executive summary

A user launched the solver from the Telegram bot with a **mistyped** `--base-branch`:

```
/codex https://github.com/rumaster/tg-games/issues/377 --think max --base-branch issue-375-8a4323e580780 --tool codex
```

The requested base branch `issue-375-8a4323e580780` **does not exist**. The real branch is
`issue-375-8a4323e58078` — the typed value has **one extra trailing `0`** (Levenshtein distance 1).
The screenshot in the issue captures GitHub itself offering to _"Create branch
issue-375-8a4323e580780 from main"_, which is the clearest possible confirmation that the branch
was absent.

Three distinct defects compounded into an opaque, misleading experience:

1. **No early validation.** The solver validated the repository, issue, and PR existence up front,
   but **never checked that the requested base branch existed**. It cloned 72 MB, then failed at
   `git checkout -b … origin/issue-375-8a4323e580780`.
2. **Misdiagnosis.** The branch-creation error handler interpreted _any_ "not a commit" git error as
   "**the repository appears to be empty (no commits)**" and advised `--auto-init-repository` — which
   is wrong and actively misleading for a non-empty repo (72 MB had just been cloned).
3. **Opaque top-level message.** The user-facing GitHub comment said only `Branch operation failed`,
   discarding every detail the handler had printed to the terminal.

The fix introduces an **early, descriptive base-branch existence gate** shared by the CLI and the
Telegram bot (fail before cloning, with a "did you mean …" suggestion), and **corrects the
misdiagnosis** so that even if the early gate is bypassed, the branch-creation error reports the real
root cause.

---

## 2. Timeline / sequence of events

All timestamps from [`raw/solve-failure-log.txt`](./raw/solve-failure-log.txt) (UTC, 2026-06-20).

| Time         | Event                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 13:32:31.904 | `solve v2.0.8` starts. Raw command shows `--base-branch issue-375-8a4323e580780`.                                        |
| 13:32:33.8   | `--attach-logs` security warning + 5 s countdown.                                                                        |
| 13:32:44.187 | Creates temp dir `/tmp/gh-issue-solver-1781962364187`.                                                                   |
| 13:32:44.190 | **Clones `rumaster/tg-games`** (no base-branch check happened first).                                                    |
| 13:32:49.056 | Clone complete — **72 MB** on disk (repository is clearly _not_ empty).                                                  |
| 13:32:49.183 | Default branch detected: `main`.                                                                                         |
| 13:32:49.324 | `🌿 Creating branch: issue-377-1fc1b18d1d9d from issue-375-8a4323e580780 (custom)`.                                      |
| 13:32:49.353 | `fatal: 'origin/issue-375-8a4323e580780' is not a commit and a branch … cannot be created from it`.                      |
| 13:32:49.377 | **Misdiagnosis:** `💡 Root cause: The repository appears to be empty (no commits).` + suggests `--auto-init-repository`. |
| 13:32:49.380 | Throws `Error: Branch operation failed` at `solve.branch.lib.mjs:401`.                                                   |
| 13:32:49.5   | Posts the `Branch operation failed` comment to issue #377. The user only ever sees this opaque line.                     |

**Sequence in one sentence:** typo in `--base-branch` → no pre-flight check → full clone → `git`
fails on a missing ref → handler blames an "empty repository" → top level collapses everything to
`Branch operation failed`.

---

## 3. Requirements extracted from the issue

Each requirement, verbatim intent, and where it is addressed.

| #   | Requirement                                                                                                                                    | Addressed by                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Add an explicit check for branch existence so the user gets feedback **as soon as possible**.                                                  | `checkBaseBranchExists()` + Step 2.5 in `validateGitHubEntityExistence()`.                                                        |
| R2  | Provide feedback at **all levels**: the GitHub comment, the `/solve` command and its aliases.                                                  | Validation runs in `solve.mjs` (CLI + comment path) before cloning.                                                               |
| R3  | Mirror the existing repo/issue/PR existence checks so we can **fail immediately** with an exact message — including from the **Telegram bot**. | `telegram-bot.mjs` passes `baseBranch` into the same gate; bot fails before queueing/spawning.                                    |
| R4  | If `--base-branch` is used, verify the branch exists **in Telegram before** the solve command starts.                                          | Same gate; the bot's pre-flight `validateGitHubEntityExistence` now receives `baseBranch`.                                        |
| R5  | "Make everything up to our highest standards."                                                                                                 | Shared/centralized helper, unit + integration tests, "did you mean" suggestion, JSDoc, lint/format clean.                         |
| R6  | Download all logs/data into `./docs/case-studies/issue-1959` and do a deep case study.                                                         | This folder.                                                                                                                      |
| R7  | If there isn't enough data, add debug output / verbose mode.                                                                                   | The fix path honours `verbose`; the corrected handler now prints the real root cause. (Sufficient data already existed — see §4.) |
| R8  | If another repo is involved, report the issue there with repro + workaround + fix suggestion.                                                  | Assessed — **no external report warranted** (see §7).                                                                             |
| R9  | Fix in **all** places the issue exists (entire codebase).                                                                                      | Centralized in the one shared gate; both call sites (CLI, bot) updated; the misdiagnosis fixed in the branch-error handler too.   |
| R10 | Plan and execute everything in the single PR #1960.                                                                                            | All commits land on `issue-1959-0d667c54040b`.                                                                                    |

---

## 4. Root-cause analysis

There were three independent root causes. The incident needed all three to produce the observed
opaque failure; fixing any one improves the experience, but the issue asks for all of them.

### RC1 — Missing base-branch existence validation (the primary gap)

`validateGitHubEntityExistence()` is the shared "fail fast" gate. Before this fix it validated:

- the **user/owner** exists,
- the **repository** exists,
- the **issue or PR** exists,

…but it never validated the **base branch**, even though `--base-branch` is a user-supplied value
just as error-prone as the others. So a bad `--base-branch` slipped past every guard and only
surfaced deep inside `git`, after a full clone.

### RC2 — Branch-creation error misdiagnosis

`handleBranchCreationError()` matched the git phrase `is not a commit` and unconditionally concluded
_"The repository appears to be empty (no commits)"_. That heuristic is only valid when creating from
the **default** branch of a genuinely empty repo. Here the repo was 72 MB and the failing ref was a
**custom** base branch, so the advice (`--auto-init-repository`) was actively harmful. The handler
had no notion of _which_ branch it was told to branch from, so it could not tell the two cases apart.

### RC3 — Lossy top-level error surface

The thrown `Error('Branch operation failed')` is what reaches the GitHub comment. All the richer
diagnostics the handler printed went only to the terminal log. The user on GitHub/Telegram saw a
three-word message with zero actionable content. (RC1 makes RC3 moot for this incident because we now
fail earlier with a full message; the corrected handler in RC2 also feeds a better message into the
same surface for any path that still reaches branch creation.)

### The trigger

A **single-character typo** (`issue-375-8a4323e580780` vs `issue-375-8a4323e58078`). The "did you
mean" suggestion built on Levenshtein distance is specifically aimed at this class of mistake.

---

## 5. Solution design

### 5.1 Centralize in the existing gate

The fix extends the **one** function both entry points already call, so there is a single source of
truth and no drift between CLI and bot:

```
validateGitHubEntityExistence({ owner, repo, number, type, baseBranch, verbose })
  Step 1   owner/user exists
  Step 2   repository exists
  Step 2.5 ── NEW ── if baseBranch: checkBaseBranchExists(); on miss → descriptive error, level:'branch'
  Step 3   issue / PR exists
```

`checkBaseBranchExists()` calls `gh api repos/{owner}/{repo}/branches/{baseBranch}` and is careful to
**fail open** (treats indeterminate errors as "exists") so a transient API hiccup never blocks a
legitimate run — only a definitive 404 / "Branch not found" fails the gate.

`buildMissingBaseBranchErrorMessage()` lists the repo's branches
(`gh api repos/{owner}/{repo}/branches --paginate --jq .[].name`), and uses
`findClosestBranchName()` to add a **"did you mean `issue-375-8a4323e58078`?"** line plus the exact
command to list all branches.

### 5.2 Correct the misdiagnosis

`handleBranchCreationError()` now receives `baseBranch` and `branchSource`. When the source is
`custom` and the git error references that ref, it reports the **real** root cause (the base branch
does not exist on the remote) instead of the empty-repo story. The empty-repo path is preserved for
the genuine case (creating from the **default** branch).

### 5.3 Why not also add a check in `hive.mjs`?

`hive` forwards `--base-branch` verbatim to the `solve` processes it spawns, and `solve` now
validates before cloning — so hive users already get the descriptive failure. A redundant hive-level
check was prototyped but pushed `hive.mjs` over the 1500-line `max-lines` lint budget for no user
benefit, so it was intentionally left out (documented here for future readers).

---

## 6. Prior art / existing components consulted

| Component                                                | Relevance                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `validateGitHubEntityExistence()` (this repo)            | The existing fail-fast pattern for user/repo/issue/PR — extended rather than duplicated.                                                                     |
| `validateBranchName()` / issue #1482 (this repo)         | Existing branch-_name_-format validation; complementary — it checks syntax, this checks existence.                                                           |
| `gh api .../branches/{branch}` (GitHub REST)             | Authoritative existence check, already the project's standard for entity checks.                                                                             |
| Levenshtein edit distance                                | Classic "did you mean" suggestion algorithm; implemented inline (single-row DP) to avoid a new dependency, consistent with the repo's low-dependency stance. |
| `git`'s own `not a commit` / `unknown revision` phrasing | Used as the signal set for the corrected misdiagnosis heuristic.                                                                                             |

A dedicated dependency (e.g. `fastest-levenshtein`, `didyoumean2`) was considered but rejected: the
function is ~15 lines, has no edge cases that warrant a library, and the project deliberately keeps
its dependency surface small.

---

## 7. External reporting assessment (R8)

The incident appeared on `rumaster/tg-games#377`, but **the bug is entirely in hive-mind code**, not
in `tg-games`. The `tg-games` repository was merely the _target_ of a solve run, and the only thing
"wrong" on its side was that the user typed a branch name that did not exist there. There is no
defect, reproducible or otherwise, to report against `tg-games`. **No external issue was filed.**

---

## 8. Verification

- **Unit tests** (`tests/test-base-branch-existence.mjs`, no network): `levenshteinDistance`,
  `findClosestBranchName` (incl. the exact real typo → `issue-375-8a4323e58078`), and the
  misdiagnosis fix (custom base branch ≠ "empty repository"; default branch still is).
- **Integration tests** (`tests/test-base-branch-existence-integration.mjs`, `@hive-mind-integration`,
  opt-in): `checkBaseBranchExists` against real branches and `validateGitHubEntityExistence` failing
  at `level: 'branch'` with a descriptive message before any clone.

Run:

```bash
node tests/test-base-branch-existence.mjs            # unit, offline
HIVE_MIND_RUN_INTEGRATION=1 \
  node tests/test-base-branch-existence-integration.mjs   # integration, needs gh + network
```

---

## 9. Reproduction

```bash
# Any non-existent base branch reproduces it. Before the fix: full clone, then
# "Branch operation failed" + bogus "repository appears to be empty" advice.
solve https://github.com/<owner>/<repo>/issues/<n> \
  --base-branch this-branch-does-not-exist

# After the fix: fails immediately, before cloning, with:
#   Base branch 'this-branch-does-not-exist' does not exist in <owner>/<repo>.
#
#   💡 Did you mean '<closest-existing-branch>'? (closest existing branch)
#
#   💡 Please check:
#   • The branch name is spelled correctly
#   • The branch has not been deleted or renamed
#   • Omit --base-branch to use the repository's default branch
#   • List existing branches: gh api repos/<owner>/<repo>/branches --paginate --jq .[].name
```
