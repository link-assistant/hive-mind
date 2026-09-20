# Case study — issue #2170

> "`Stack trace: TypeError: A GitHub pull request URL requires owner, repo, and a positive integer number`"
> — [link-assistant/hive-mind#2170](https://github.com/link-assistant/hive-mind/issues/2170)

A `solve` run against `Payel-git-ol/Octra#179` died 62 seconds after start, one line
after a successful branch checkout, with a `TypeError` thrown by Hive Mind's own URL
builder. Nothing about the repository, the network or the AI tool was involved: the
run resumed a leftover branch that had no pull request yet, and the code that
prepares the "Your prepared Pull Request" URL assumed that continue mode always
implies a known pull request number.

This document reconstructs the run, lists every requirement the issue raises, gives
the root cause of each, and records the fix shipped in
[PR #2171](https://github.com/link-assistant/hive-mind/pull/2171).

## Contents

| Path                              | What it holds                                                              |
| --------------------------------- | -------------------------------------------------------------------------- |
| `README.md`                       | This analysis.                                                             |
| `logs/start-command-2d6c262e.log` | The complete production log linked from the issue, verbatim.               |
| `data/issue-2170.json`            | Issue body/metadata as returned by `gh issue view`.                        |
| `data/issue-2170-comments.json`   | Issue comments (empty — the report is a single body).                      |
| `experiments/reproduce-2170.mjs`  | Offline reproduction of the exact `TypeError`, and of the fixed behaviour. |

Regression coverage lives in `tests/solve-continue-mode-without-pr-2170.test.mjs`.

## 1. Timeline

All timestamps come from `logs/start-command-2d6c262e.log` (execution
`2d6c262e-e52f-410a-b7b3-6ca9bcce3187`, session `37adbfdf-…`, image
`konard/hive-mind-dind:2.12.5`).

| #   | Time (UTC)          | Event                                                                                                                                                                                | Evidence                                                               |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | 2026-08-15 15:28    | Commit `77ed9bc2` (`fix(formal-ai): bound repository requests`, issue #2158) replaces `prUrl = issueUrl` with `buildGitHubPullRequestUrl({ owner, repo, number: prNumber })`.        | `git log -L 545,556:src/solve.mjs`                                     |
| 2   | 2026-08-16 17:59    | PR [#2159](https://github.com/link-assistant/hive-mind/pull/2159) merges that commit.                                                                                                | `gh pr list --search 2158 --state all`                                 |
| 3   | 2026-08-16 18:07    | Tag `v2.12.5` — the first release carrying the regression.                                                                                                                           | `git log -1 --format=%ai v2.12.5`                                      |
| 4   | 2026-08-18 06:23:48 | Detached Docker run starts: `solve https://github.com/Payel-git-ol/Octra/issues/179 --think high --tool claude --attach-logs --verbose …`.                                           | log header                                                             |
| 5   | 06:24:23.865        | `--auto-continue` starts looking for existing work on issue #179.                                                                                                                    | `🔍 Auto-continue enabled: …`                                          |
| 6   | 06:24:24.267        | One matching branch is found in the main repo: `issue-179-a1e31889c902`.                                                                                                             | `📋 Found 1 existing branch(es) …`                                     |
| 7   | 06:24:25.796        | **No** pull request is found for the issue — both `gh pr list` searches return `[]`.                                                                                                 | `📝 No existing PRs found for issue #179`                              |
| 8   | 06:24:26.325        | No pull request exists for the branch either, so auto-continue returns `{ isContinueMode: true, prNumber: null, prBranch: 'issue-179-a1e31889c902' }`.                               | `No existing PR for this branch - will create PR from existing branch` |
| 9   | 06:24:26–06:24:49   | Repository is cloned (450 MB), the branch is checked out and verified.                                                                                                               | `✅ Branch checked out: issue-179-a1e31889c902`                        |
| 10  | 06:24:50.920        | `Error executing command: TypeError: A GitHub pull request URL requires owner, repo, and a positive integer number` at `github-url-parser.lib.mjs:248`, called from `solve.mjs:542`. | log tail                                                               |
| 11  | 06:24:52            | Failure comment posted to `Payel-git-ol/Octra#179`; process exits `1`; the container is kept for investigation.                                                                      | `📎 Failure log posted to original issue #179`                         |

Steps 8 and 10 are the whole bug. Everything before step 10 succeeded, and the very
next thing the run would have done (`handleAutoPrCreation`) is precisely the code
that creates the missing pull request.

## 2. Root cause

### 2.1 Continue mode does not imply an existing pull request

`processAutoContinueForIssue()` in `src/solve.auto-continue.lib.mjs` has two ways to
enter continue mode:

- it finds an **open pull request** for the issue → `{ isContinueMode: true, prNumber: <n>, … }`;
- it finds no pull request but a leftover **`issue-<n>-<hash>` branch** from an earlier
  interrupted run → it reuses that branch:

```js
// src/solve.auto-continue.lib.mjs — branch-reuse path
await log('   No existing PR for this branch - will create PR from existing branch');
return {
  isContinueMode: true,
  prNumber: null, // No PR yet
  prBranch: selectedBranch,
  issueNumber,
};
```

The rest of the pipeline is aware of this second shape. `handleAutoPrCreation()` even
keys off it explicitly:

```js
// src/solve.auto-pr.lib.mjs:21
if (!argv.autoPullRequestCreation && !(isContinueMode && !prNumber)) return null;
```

and `solve.mjs` only treats a missing number as fatal _after_ that call:

```js
if ((isContinueMode || argv.autoPullRequestCreation) && !prNumber) {
  await handleNoPrAvailableError({ … });
}
```

### 2.2 The #2158 fix moved URL construction ahead of PR creation

Issue #2158 fixed a real problem: in continue mode the code used to pass the _issue_
URL as the pull request URL (`prUrl = issueUrl`), which sent the first Formal AI
attempt at the wrong GitHub entity. The fix built the URL from the parts instead:

```js
// src/solve.mjs @ v2.12.5 (line 542 in the published package)
if (isContinueMode) {
  prUrl = githubLib.buildGitHubPullRequestUrl({ owner, repo, number: prNumber });
}
```

`buildGitHubPullRequestUrl` is a strict constructor by design — it refuses to
fabricate a URL for a pull request that GitHub has not identified:

```js
if (!owner || !repo || !Number.isInteger(Number(number)) || Number(number) <= 0) {
  throw new TypeError('A GitHub pull request URL requires owner, repo, and a positive integer number');
}
```

Correct for its contract; wrong for this call site. The call sits _before_
`handleAutoPrCreation()`, i.e. at a point where `prNumber === null` is a legitimate,
handled state. The throw propagates to `main()`'s catch, so the entire run aborts
with a stack trace instead of creating the pull request one step later.

Reproduced offline, with no GitHub access, in `experiments/reproduce-2170.mjs`.

### 2.3 Why the message was unhelpful

The `TypeError` named the three required parts but not the values it received, so the
report in the issue ("that is strange bug") could not be triaged from the stack trace
alone — one had to read the source to learn that `owner` and `repo` were fine and only
`number` was `null`.

### 2.4 Blast radius

`buildGitHubPullRequestUrl` has exactly one production call site
(`grep -rn buildGitHubPullRequestUrl src`): the continue-mode block in `solve.mjs`.
The other references are the re-export in `src/github.lib.mjs` and the #2158 test.
So the defect exists in exactly one place, and the fix below covers all of it.

Trigger conditions (all required):

1. `--auto-continue` (the default) with an **issue** URL;
2. at least one branch matching `issue-<n>-*` exists in the target repository;
3. no open/closed/merged pull request exists for that branch or issue.

That is the ordinary aftermath of a run that was interrupted (OOM, container kill,
usage limit) after branch creation but before pull request creation — so every retry
of such a task failed the same way, permanently, until the branch was deleted.

## 3. Requirements and how each is addressed

| #   | Requirement from the issue                                                          | Status                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Get to the bottom of the bug and fix the exact root cause                           | Done — §2.2; fix in `src/solve.mjs` uses the nullable builder so the run proceeds to pull request creation.                             |
| R2  | Or at least add more logs to understand the situation better                        | Done — the `TypeError` now names the received `owner`/`repo`/`number`, and `solve.mjs` logs when continue mode has no pull request yet. |
| R3  | Download all logs and data related to the issue into this repository                | Done — `logs/`, `data/`.                                                                                                                |
| R4  | Compile it into `./docs/case-studies/issue-2170`                                    | Done — this folder.                                                                                                                     |
| R5  | Deep case study: timeline/sequence of events                                        | Done — §1.                                                                                                                              |
| R6  | List of each and all requirements from the issue                                    | Done — this table.                                                                                                                      |
| R7  | Root cause of each problem                                                          | Done — §2.1–§2.4.                                                                                                                       |
| R8  | Propose possible solutions and solution plans for each requirement                  | Done — §4.                                                                                                                              |
| R9  | Check known existing components/libraries that solve a similar problem              | Done — §5.                                                                                                                              |
| R10 | Search online for additional facts and data                                         | Done — §5 (npm URL-parsing libraries); no external report of this message exists, it is Hive Mind's own string.                         |
| R11 | If not enough data for a root cause, add debug output / verbose mode for next round | Not needed for the root cause (found), but done anyway — see R2.                                                                        |
| R12 | Report issues to other repositories/projects if they are involved                   | Not applicable — the defect is entirely inside `link-assistant/hive-mind`; §2.4 shows no third-party component participates.            |
| R13 | Apply the requirement to the entire codebase, fix every affected place              | Done — §2.4: one call site, verified by grep, and guarded by a test that fails if a throwing builder reappears in that assignment.      |
| R14 | Reproducible example + automated test                                               | Done — `experiments/reproduce-2170.mjs`, `tests/solve-continue-mode-without-pr-2170.test.mjs`.                                          |

## 4. Solutions considered

| Option                                                                                 | Verdict                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Guard the call site with a nullable builder** (`buildGitHubPullRequestUrlOrNull`) | **Chosen.** Keeps the strict builder honest for callers that really do have a pull request, and makes "not identified yet" an explicit, named state. |
| B. `if (isContinueMode && prNumber)` inline                                            | Equivalent behaviour, but leaves the next caller free to repeat the mistake; the named helper documents the legitimate `null` case.                  |
| C. Make `buildGitHubPullRequestUrl` return `null` instead of throwing                  | Rejected — that is exactly the #2158 failure mode: a silently wrong/absent URL reaching the agent prompt. The throw is a useful contract.            |
| D. Stop entering continue mode when no pull request exists                             | Rejected — branch reuse is deliberate behaviour (it preserves interrupted work), and `handleAutoPrCreation` already supports it.                     |
| E. Create the pull request before computing `prUrl`                                    | Rejected as the primary fix — a bigger reordering of `solve.mjs` for no extra safety; `prUrl` is already re-assigned from `autoPrResult`.            |

Fix as shipped:

```js
// src/solve.mjs
prUrl = githubLib.buildGitHubPullRequestUrlOrNull({ owner, repo, number: prNumber });
if (!prUrl) {
  await log(formatAligned('ℹ️', 'Continue mode:', 'Resuming an existing branch that has no pull request yet'));
  await log(formatAligned('', 'Pull request:', 'Will be created before the tool session starts', 2));
}
```

`prUrl` is then filled in by `handleAutoPrCreation()` a few lines later, and the
pre-existing `handleNoPrAvailableError()` check still catches the genuinely broken
case where the pull request could not be created at all.

## 5. Existing components and prior art

The npm ecosystem has several GitHub-URL libraries — [`parse-github-url`](https://www.npmjs.com/package/parse-github-url),
[`git-url-parse`](https://www.npmjs.com/package/git-url-parse),
[`parse-github-repo-url`](https://www.npmjs.com/package/parse-github-repo-url),
[`parse-url`](https://www.npmjs.com/package/parse-url) — but all of them **parse**
URLs; none constructs a pull request URL, and none would have prevented this bug,
which is about _when_ the URL is constructed, not _how_. Hive Mind's own
`src/github-url-parser.lib.mjs` already covers the parsing side.

The general pattern that does apply is the "throwing constructor + nullable variant"
pair found across many APIs (`URL` vs `URL.parse`/`URL.canParse` in modern Node,
`Number.parseInt` vs strict validation, Rust's `T::new` vs `T::try_new`). Adopting
that pair here is what makes the legitimate "no pull request yet" state expressible
without exceptions-as-control-flow.

## 6. Verification

```
node tests/solve-continue-mode-without-pr-2170.test.mjs
node docs/case-studies/issue-2170/experiments/reproduce-2170.mjs
```

The test drives `processAutoContinueForIssue()` against a fake `gh` on `PATH` that
reproduces the failing run's GitHub state (one `issue-179-*` branch, no pull
requests), asserts the `{ isContinueMode: true, prNumber: null }` result, and asserts
that the `solve.mjs` continue-mode block tolerates it. It also pins the improved
`TypeError` message and fails if the throwing builder is reintroduced into that
assignment.
