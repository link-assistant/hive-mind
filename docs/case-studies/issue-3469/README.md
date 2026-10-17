# Case study: issue #3469: optional requirements report, PR links in status, and a broken auto-restart

Issue: https://github.com/link-assistant/hive-mind/issues/3469
Pull request: https://github.com/link-assistant/hive-mind/pull/3470

The `data/` folder holds the raw material, kept verbatim. Prettier ignores it.

| File                                       | What it is                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `issue-3469.json`                          | The issue as `gh issue view --json` returned it                                               |
| `screenshot.png`                           | The Telegram reply from the issue: a finished `/fix` that shows the issue but no pull request |
| `telegram-bot.log.txt`                     | The bot log linked in the issue (gist `fd1e2af4…`)                                            |
| `pr-3446-execution.log.txt`                | The solve log of PR #3446, linked in the issue (gist `8f5b8eb8…`)                             |
| `pr-3446.json`, `pr-3446-comments.json`    | PR #3446 and all of its conversation comments                                                 |
| `hive-mind-pr3446-comment-6232524845.json` | The "Automation stopped: two consecutive AI sessions produced identical results" comment      |
| `konard-github-io-pr4*.json`               | konard/konard.github.io#4, its comments, and the "Auto-merge blocked" comment 6232465001      |
| `pr-3470-comments.json`                    | The conversation comments of this pull request when its own guard rejected the fresh report   |

## Timeline (UTC, 2026-10-17)

| Time              | Event                                                                                                                                                                                                                                                         | Source                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 08:36:36          | solve creates PR #3446 for #3445 with the `.gitkeep` placeholder commit `18e953d`                                                                                                                                                                             | execution log, lines 229–341                   |
| 08:41–08:45       | A Formal AI session on #3446 ends as "planned, not executed"                                                                                                                                                                                                  | `pr-3446-comments.json`                        |
| ~09:08            | The Claude session runs the test suite on Node 26.12 and gets `ReferenceError: Cannot access 'ensurePullRequestIsReady' before initialization` in `solve.auto-merge-guards.lib.mjs:22`. It decides the error was already there before its change              | execution log, line 54780                      |
| 09:48:35          | konard.github.io#4 (a `/fix --ci-cd` run): "Auto-merge blocked … The requirements report does not describe the current pull request commit."                                                                                                                  | `konard-github-io-pr4-comment-6232465001.json` |
| 09:48:40          | The primary session on #3446 (`42e9f82e`) finishes on commit `2ba2553`                                                                                                                                                                                        | execution log, line 81817                      |
| 09:49:15          | "🎯 Completion restart 1/3: Issue requirements have not been verified": a whole AI session started only to refresh the report                                                                                                                                 | execution log, line 81890                      |
| 09:52:47          | The completion-restart session (`6be2f76a`) only edits the PR description, so it ends on `2ba2553` too                                                                                                                                                        | `pr-3446-comments.json`                        |
| 09:52:27–09:52:47 | Cleanup reverts `.gitkeep` and pushes `18cf114c0`. HEAD has moved                                                                                                                                                                                             | execution log, lines 88192–88276               |
| 09:54:50          | Watch check #1: CI on `18cf114` shows 2 failed checks, a real restart trigger. Instead: "❌ NO PROGRESS BETWEEN SESSIONS … Budget left unused: 5 restart iterations"                                                                                          | execution log, lines 88303–88345               |
| 09:55:22          | The PR is converted to draft and the "Automation stopped" comment is posted. No new session starts                                                                                                                                                            | `hive-mind-pr3446-comment-6232524845.json`     |
| 10:11:43          | Issue #3469 is opened                                                                                                                                                                                                                                         | `issue-3469.json`                              |
| 13:48–13:49       | The first Claude session on PR #3470 writes a report with the template's digest `309c3b…`. Then the guard of the same solve rejects it: "issue description or review feedback changed after verification". Nothing had changed, and the PR goes back to draft | `pr-3470-comments.json`, PR timeline           |

## Requirements

| #   | Requirement (from the issue)                                                                                                       | Status | Where                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| R1  | Make the requirements report optional and experimental, off by default, keep the code, and spend no prompt tokens on it by default | done   | d124747c8, 53d9ac67d, c5dd4de54                                                                   |
| R2  | Show the PR link in task status messages as soon as the PR exists, in every similar case                                           | done   | 46c27fb4b                                                                                         |
| R3  | Check all other false positives, false negatives, warnings and errors in the logs, and fix them                                    | done   | 5a1927d59, 1abbdd656, c808a4945, 5ee824ae3, 0d7905692, 5fb7988a8, a2c95bee3, 53d9ac67d, c5dd4de54 |
| R4  | Fix the auto-restart/resume regression from PR #3446                                                                               | done   | dec76f614                                                                                         |
| R5  | Collect the logs and data here and write this deep case study, with online research and existing components                        | done   | this folder                                                                                       |
| R6  | Add debug output and verbose mode where the data is not enough                                                                     | done   | dec76f614 (verdict in verbose), 5ee824ae3 (df diagnostics), c808a4945                             |
| R7  | Report issues to other projects, with reproductions, workarounds and suggested fixes                                               | done   | see [Upstream reports](#upstream-reports)                                                         |
| R8  | Apply each fix to the whole codebase                                                                                               | done   | 1abbdd656 (all 43 TDZ imports), 5fb7988a8 (all 32 `silent: true` sites)                           |

## R1: the requirements report

**Root cause.** The #2406 requirements report was on for every run. Three things depended on it:

- the issue-completion prompt asked for it, which costs tokens on every session;
- the merge guard blocked a merge when the report did not describe the current commit (konard.github.io#4);
- a completion restart started a whole new AI session just to refresh the report (PR #3446, 09:49:15).

Once a report exists, every new commit makes it stale. So the guard and the restart fed each other: a session that fixes something produces a commit, and the commit outdates the report.

**Solution.** `--requirements-report` (or `HIVE_MIND_REQUIREMENTS_REPORT=true`) now defaults to `false` in `src/solve.config.lib.mjs`. With the flag off:

- `issue-completion.prompts.lib.mjs` leaves the report instructions out of the prompt (no tokens spent);
- `github-merge.lib.mjs` and `solve.auto-merge-attempt.lib.mjs` skip the report check;
- `solve.issue-completion.lib.mjs` never starts a completion restart for a report.

The code is unchanged behind the flag. `docs/ISSUE_COMPLETION*.md` and `docs/CONFIGURATION*.md` describe it as experimental. Tests: `tests/issue-completion-2406.test.mjs` and `tests/issue-completion-prompts-2406.test.mjs`.

### The guard and the template disagreed on the digest

This PR's own run reproduced a false positive. At 13:49 the solve that had just finished rejected the report that the template had produced moments before. The reason was "issue description or review feedback changed after verification". The issue was last edited at 10:25, and no person had commented since.

**Root cause.** `requirementFeedback()` in `src/issue-requirements.lib.mjs` dropped a comment as bookkeeping when `isToolTrackedCommentId(comment.id)` was true. Those IDs live only in the memory of the solve process that posted the comment:

- The template (`issue-requirements-snapshot.mjs`) runs as a fresh process. It kept `🤖 **AI Work Session Started**` (6233039365) as feedback and gave `309c3b…`.
- The guard ran inside the solve that had posted that comment. It dropped the comment and gave `471a76…`.

`isToolStatusComment()` recognized only `## <icon> <marker>` headings, so the bold first line of the session notices did not match. `experiments/requirements-digest-process-dependence-3469.mjs` reproduces the mismatch on `data/pr-3470-comments.json`.

**Solution.** The digest now depends only on what the comments say. `requirementFeedback()` no longer looks at tracked IDs. `isToolStatusComment()` also recognizes an emoji or `:shortcode:` followed by a bold marker, such as `🤖 **AI Work Session Started**`, `⚠️ **Finished without changes**` or `⏳ **Usage Limit Reached - Waiting…**`. It also recognizes the tagged `<!-- hive-mind:… -->` notices. A person who quotes a marker in a sentence is still feedback.

The same fix covers `--interactive-mode`. Its tool comments (`## 💻 Tool: …`, `## 🚀 Session Started` and the others) had no marker and were left out only by tracked ID. `postComment` and `editComment` in `src/interactive-mode.lib.mjs` now put the hidden `<!-- hive-mind:interactive-mode -->` line first, so every process sees them as bookkeeping. Test: `tests/requirements-digest-process-independent-3469.test.mjs`.

**Until this PR is released.** The installed solve still runs the old guard, and it rejected the `309c3b…` report again on f16991e13. Nothing had changed. `experiments/installed-guard-digest-3469.mjs` takes any `src/` tree and compares the digest with nothing tracked (the template) and with chosen comment IDs tracked (the guard). Run on the live PR #3470 comments:

| Code                      | Nothing tracked | 6233039365 tracked |
| ------------------------- | --------------- | ------------------ |
| released 2.37.1           | `309c3b…`       | `471a76…`          |
| this PR (after 53d9ac67d) | `42f2b90f…`     | `42f2b90f…`        |

So the report on this PR uses `471a76…`, the digest the running guard computes from the same comments. With this PR's code, the template and the guard both compute `42f2b90f…`.

## R2: pull request links in status messages

**Root cause.** The screenshot shows `/fix --ci-cd https://github.com/konard/konard.github.io`. That command starts on a repository URL and creates issue #3 itself, so the session record never had an issue URL from which to look up a PR. The completion reply therefore showed the issue but no PR. More generally, a running session of any command showed its PR only after it finished, because the PR was resolved only at completion.

**Solution (46c27fb4b).**

- `src/fix-progress.lib.mjs` reads the issue that `/fix` created from its progress markers.
- `src/session-live-pr-link.lib.mjs` reads the growing session log incrementally: at most 4 MiB per monitor tick, with a 1 KiB overlap, never the whole transcript. It looks for the labelled `PR URL:` line that solve prints when it creates or reuses its PR, and edits the running reply once. A PR the agent merely mentions is not trusted (#2891).
- `session-store`, `session-monitor`, `session-own-pr` and `work-session-formatting` carry the link into the running and completion replies. `insertInfoBlockUrlLine` keeps the `Repository:`, `Issue:` and `Pull request:` lines together.
- `session-recovery-lifecycle` posts recovery notices of a `/fix` on the issue it created.

Test: `tests/test-live-pr-link-3469.mjs`.

## R4: auto-restart stopped instead of restarting

**Root cause.** Two defects combined (see the timeline):

1. The completion restart only edited the PR description, and it was recorded like any other session. Two sessions in a row ending on `2ba2553` looked like "no progress", although the second one was only a bookkeeping run.
2. `stopWhenSessionRepeated` in `src/session-progress.lib.mjs` made its decision from that verdict at 09:54:50. By then the `.gitkeep` revert had moved HEAD to `18cf114` and CI had failed on it. The "identical" verdict was stale. A real restart trigger (2 failed checks on a commit no session had seen) was dropped, and 5 iterations were left unused.

**Solution (dec76f614).**

- `stopWhenSessionRepeated` restarts when HEAD moved after the repeated session.
- Completion restarts are labelled and recorded with `stallEvidence: false`, so they can never count as a repeat.
- Verbose mode logs the verdict that the decision was made from (R6).

Test: `tests/auto-restart-after-completion-restart-3469.test.mjs`.

## R3: log audit

Every warning and error in the two logs, plus the solve logs of this PR, is listed below.

| Log line                                                                                                                                                                             | Verdict                                                    | Root cause                                                                                                                                                                                                                    | Fix                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot access 'ensurePullRequestIsReady' before initialization` (PR #3446 tests on Node 26). The solver wrongly called it pre-existing                                              | **real error**, hidden by CI on Node 24                    | Node 26.12 / V8 14.6 resolves a top-level `await import()` of an evaluating-async module before the module has run. See [below](#node-26-top-level-import-tdz)                                                                | 5a1927d59; then 1abbdd656 for all 43 imports in 20 files (R8)                                                                                                                                                             |
| `⚠️ Could not update claude-profiles: after install the binary reports 0.40.8 (expected 1.2.3)`; the same for gh-setup-git-identity, `0.1.0 (expected 0.8.0)` (bot log, lines 74–76) | **false negative**: the update worked                      | Both CLIs print a wrong `--version`. gh-setup-git-identity 0.8.0 has `0.1.0` hard-coded. claude-profiles uses yargs, which reads the nearest `package.json` of the cwd (nvm's 0.40.8). Each idle update then reinstalled them | c808a4945 reads the version from the `package.json` that owns the binary on `PATH`. Test: `tests/agentic-cli-version-manifest-3469.test.mjs`. Also fixes the install hint (`gh-setup-git-identity` is published unscoped) |
| `[STDOUT] {"message":"Resource not accessible by integration",…,"status":"403"}` followed by `Warning: Could not get current user` (solve log of this PR, lines 443 and 5736)        | **false positive**                                         | An installation token cannot read `GET /user` by design. The probe was meant to be quiet, but `$({ silent: true })` is not a command-stream option, so the raw JSON was mirrored                                              | 5fb7988a8: `silent: true` → `mirror: false` in all 32 sites (R8). The user lookup now says why there is no current user. Test: `tests/command-stream-silent-option-3469.test.mjs`                                         |
| `isolation-runner: could not parse df output for Docker disk space` (bot log, line 6)                                                                                                | **unexplained warning**: not enough data                   | The message did not say what df returned                                                                                                                                                                                      | 5ee824ae3 (R6) logs the Docker data root, df's exit code, its last stdout line and stderr. Test: `tests/docker-disk-space-diagnostics-3469.test.mjs`                                                                      |
| `/queue: Session completion for session cc3dd3ab… matches no launched queue item` (bot log, line 12673)                                                                              | **false alarm in wording**                                 | cc3dd3ab is the `/fix` from the screenshot. It started at once, so it never became a queue item                                                                                                                               | 0d7905692 says it is expected for a session started directly. Test: `tests/queue-direct-session-completion-3469.test.mjs`                                                                                                 |
| "a workaround and a suggested fix: <upstream issue URL>" in the PR #3446 body                                                                                                        | **false positive of the #3358 guard**, and a dangerous one | GitHub treats `fix: URL` as a closing keyword anywhere in a line. The guard treated it as an intended cross-repository close, so merging would have closed the upstream report                                                | a2c95bee3 counts only a declared closing reference. Test: `tests/incidental-foreign-closing-keyword-3469.test.mjs`                                                                                                        |
| `HIVE_MIND_MIN_START_INTERVAL_FLOOR_MS is deprecated` (bot log, line 13)                                                                                                             | correct warning                                            | The operator's environment still sets the old name                                                                                                                                                                            | none: rename the variable in the environment                                                                                                                                                                              |
| `gh auth setup-git could not write the global gitconfig: … Device or resource busy` (execution log, line 208)                                                                        | correct info message                                       | `~/.gitconfig` is a bind mount in the container, so it cannot be replaced by rename. The fallback is used and works                                                                                                           | none                                                                                                                                                                                                                      |
| `gh-upload-log` 403 on the shared log repository                                                                                                                                     | known upstream, already fixed there                        | gh-upload-log without `--repository` calls `GET /user`                                                                                                                                                                        | none needed. hive-mind falls back to the PR branch. Upstream: link-foundation/gh-upload-log#47 (closed, 0.10.1 adds `--repository`)                                                                                       |
| "Automation stopped: two consecutive AI sessions produced identical results"                                                                                                         | **false positive**                                         | see R4                                                                                                                                                                                                                        | dec76f614                                                                                                                                                                                                                 |
| "Auto-merge blocked: the requirements report does not describe the current pull request commit"                                                                                      | **unwanted blocker**                                       | see R1                                                                                                                                                                                                                        | d124747c8                                                                                                                                                                                                                 |

### Node 26 top-level import() TDZ

`experiments/node26-tla-tdz/` is a five-file reproduction; its `README.md` explains the module graph.

| Runtime      | V8               | Result                                                    |
| ------------ | ---------------- | --------------------------------------------------------- |
| Node 24.22.0 | 13.6.233.17      | `ok 2 2`                                                  |
| Node 25.9.0  | 14.1.146.11      | `ok 2 2`                                                  |
| Bun 1.4.3    | (JavaScriptCore) | `ok 2 2`                                                  |
| Node 26.12.0 | 14.6.202.34      | `ReferenceError: Cannot access 'x' before initialization` |
| Deno 2.9.7   | 15.0.245.2       | `ReferenceError: Cannot access 'x' before initialization` |

ECMA-262 (Module Semantics, `Evaluate()` and `AsyncModuleExecutionFulfilled`) does not allow this:

- A module that is _evaluating-async_ gets a pending top-level capability.
- `InnerModuleEvaluation` returns immediately.
- Only `AsyncModuleExecutionFulfilled`, which runs after the module's body has finished (including the `GatherAvailableAncestors` loop), resolves the promise.

V8 14.6 resolves `import()` with the namespace of a module that has not run yet. Node 24 and 25, and JavaScriptCore, wait as the spec requires. A search of nodejs/node, v8 and tc39/ecma262 found no existing report, so one was filed (see below).

How the fix was applied to the whole codebase (R8):

- `experiments/scan-tla-sibling-tdz-3469.mjs` imports every top-level dynamic import in `src/` on Node 26 from a fresh process. The first run found 43 TDZ failures among 299 imports.
- `experiments/static-imports-3469.mjs` rewrote them as static imports.
- After three rounds, the scan found 0 failures among 255 imports.
- A static import is part of the module graph, so it is evaluated before the importer's body on every runtime.
- `experiments/find-import-cycle-3469.mjs` and the two `tdz-guards-*` scripts check that no new static cycle exposes a binding before it is initialised.

## Upstream reports

| Project                               | Report                                             | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js / V8                          | **nodejs/node#66806** (new)                        | The reproduction above, the runtime table, the spec steps, and the static-import workaround                                                                                                                                                                                                                                                                                                                                                                                               |
| link-foundation/gh-setup-git-identity | **link-foundation/gh-setup-git-identity#32** (new) | The fix for `--version` (PR #31, for #30) was merged on 2026-10-08, but it was never published. Release run 37733836425 failed in `scripts/setup-npm.mjs`: `use('command-stream')` installed `command-stream@latest` (2.0.0), whose required `node-pty` install script failed. npm still has 0.8.0, which prints 0.1.0. Suggested: rerun the release, pin `use('command-stream@2.4.0')`, and alert on failed releases. The CI log is `data/gh-setup-git-identity-release-37733836425.log` |
| link-foundation/command-stream        | command-stream#218 (existing)                      | `node-pty` became optional in 2.0.1. Nothing new to report                                                                                                                                                                                                                                                                                                                                                                                                                                |
| link-foundation/claude-profiles       | claude-profiles#57 (existing, open)                | yargs reads nvm's `package.json`, so `--version` prints 0.40.8. hive-mind no longer depends on it (c808a4945)                                                                                                                                                                                                                                                                                                                                                                             |
| link-foundation/gh-upload-log         | gh-upload-log#47 (existing, closed)                | 0.10.1 has `--repository`/`--branch` and skips `GET /user` when given a target                                                                                                                                                                                                                                                                                                                                                                                                            |

Related hive-mind work: issue #2699 and its open PR #2700 also handle CLIs that report a wrong `--version`. c808a4945 handles this case on its own, by reading the version from the owning `package.json`.

## Existing components checked

- **command-stream** `$`: has `mirror`/`capture` options, but no `silent` option. `src/quiet-probe.lib.mjs` (`QUIET_PROBE`, `quietProbe($)`, from #2130) is the existing helper, and the new call sites use it.
- **use-m**: resolves `@latest` at runtime. It caused the gh-setup-git-identity release failure, which is why pinning is suggested upstream.
- **gh-upload-log 0.10.x**: `--repository OWNER/REPO` would avoid the 403 on the shared log repository. hive-mind's existing fallback to the PR branch already preserves the log.
- **Node's module loader**: no flag changes the TDZ behaviour, so the only workaround is static imports.

## Verification

- New tests:
  - `tests/test-live-pr-link-3469.mjs`
  - `tests/auto-restart-after-completion-restart-3469.test.mjs`
  - `tests/agentic-cli-version-manifest-3469.test.mjs`
  - `tests/docker-disk-space-diagnostics-3469.test.mjs`
  - `tests/queue-direct-session-completion-3469.test.mjs`
  - `tests/incidental-foreign-closing-keyword-3469.test.mjs`
  - `tests/command-stream-silent-option-3469.test.mjs`
- Updated tests: the two #2406 issue-completion suites.
- `experiments/scan-tla-sibling-tdz-3469.mjs` on Node 26.12.0: "255 top-level dynamic imports checked …; 0 TDZ failure(s)".
- The default test suite was run on Node 26.12.0 and Node 24.22.0. Results are in the PR description.
