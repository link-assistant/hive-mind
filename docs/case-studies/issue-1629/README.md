# Case Study: External PR 1833 Agent Recovery Failure

Issue: <https://github.com/link-assistant/hive-mind/issues/1629>

External repository: <https://github.com/Jhon-Crow/godot-topdown-MVP>

External PR: <https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1833>

External issue: <https://github.com/Jhon-Crow/godot-topdown-MVP/issues/1826>

Related successful PR: <https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1839>

## Summary

PR 1833 was closed unmerged even though its final commit had green GitHub
Actions checks. The failure was not a CI failure. It was a Hive Mind recovery
failure after an agent run left `scripts/autoload/unlock_manager.gd`
uncommitted, then later staged it but failed to emit a valid commit tool call.

The most actionable Hive Mind bug was in agent error classification. The final
agent stream contained an internal usage error event:

```text
TypeError: undefined is not an object (evaluating 'usage.inputTokens.total')
```

Immediately after that, the agent emitted a clean exit event with
`hasError:false` and the process exit code was `0`. Hive Mind still treated the
earlier error event as fatal and marked the solution draft failed. A cleanup
fallback then committed the staged change and removed `.gitkeep`, but the PR had
already entered the failed flow and was closed unmerged.

This PR fixes that false fatal classification by treating a clean agent exit
event (`{"type":"log","message":"Agent exiting","hasError":false}`) the same as
the other recovered-completion markers already handled in `src/agent.lib.mjs`.
It also clears post-hoc JSON error detection for earlier recovered error events
when the process exit code is `0` and a successful-completion marker was seen.

## Captured Evidence

All downloaded data for this case study is stored in this directory.

| Path                                       | Contents                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `data/pr-1833-view.json`                   | `gh pr view` metadata for PR 1833.                                        |
| `data/pr-1833-api.json`                    | REST PR metadata for PR 1833.                                             |
| `data/pr-1833-conversation-comments.json`  | PR conversation comments.                                                 |
| `data/pr-1833-review-comments.json`        | PR inline review comments. Empty array.                                   |
| `data/pr-1833-reviews.json`                | PR reviews. Empty array.                                                  |
| `data/pr-1833-timeline.json`               | PR timeline events.                                                       |
| `data/pr-1833-events.json`                 | PR issue events.                                                          |
| `data/pr-1833-files-api.json`              | Changed-file metadata for PR 1833.                                        |
| `data/pr-1833-file-patches.txt`            | Final PR patch.                                                           |
| `data/pr-1833-actions-runs.json`           | Actions runs for PR 1833's branch.                                        |
| `logs/actions-run-*.log`                   | Sixteen GitHub Actions run logs.                                          |
| `logs/solution-draft-*.log`                | Five solution-draft logs downloaded from gists with `gh gist view --raw`. |
| `data/external-issue-1826-*.json`          | External issue metadata, comments, and timeline.                          |
| `data/related-pr-1839-view.json`           | Metadata for the later successful PR.                                     |
| `data/related-pr-1839.diff`                | Diff for the later successful PR.                                         |
| `data/agent-log-event-summary-compact.txt` | Compact index of key agent-log lines.                                     |
| `data/log-line-counts.txt`                 | Raw log line counts.                                                      |
| `data/data-inventory.tsv`                  | Generated inventory of captured artifacts.                                |
| `research/online-sources.md`               | Online research sources used to validate GitHub data collection.          |

## External Requirement

External issue 1826 requested, in Russian, that the shotgun and offensive grenade
unlock after completing the Building map with any rank, even F. The direct
translation used for analysis:

> The shotgun and offensive grenade should unlock when completing the Building
> map at any rank, even F.

The PR 1833 final patch changed the Building unlock condition from minimum rank
`D` to `F`, kept shotgun unlock, and changed grenade unlocks from `[1]` to
`[1, 3]`. The later successful PR 1839 was titled "Unlock shotgun and frag
grenade after any Building completion" and included unit-test changes.

## Timeline

All times are UTC.

| Time                | Event                                                                                                                       | Evidence                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-13 18:11:49 | External issue 1826 opened.                                                                                                 | `data/external-issue-1826-view.json`                                                                                               |
| 2026-04-15 16:54:10 | Hive created bootstrap `.gitkeep` commit `ea966c531d62c3267848507ad43a2ad90d6c6881`.                                        | `logs/solution-draft-0717628d22607598cd694e9fceffba00.log:1128`                                                                    |
| 2026-04-15 16:54:16 | PR 1833 created from branch `issue-1826-328adfe76998`.                                                                      | `data/pr-1833-view.json`                                                                                                           |
| 2026-04-15 16:54:20 | Hive verified PR 1833 existed.                                                                                              | `logs/solution-draft-0717628d22607598cd694e9fceffba00.log:1232`                                                                    |
| 2026-04-15 16:54:21 | Hive comment-counting emitted `fatal: not a git repository` noise.                                                          | `logs/solution-draft-0717628d22607598cd694e9fceffba00.log:1263`                                                                    |
| 2026-04-15 16:55:25 | Hive detected uncommitted `scripts/autoload/unlock_manager.gd`.                                                             | `logs/solution-draft-0717628d22607598cd694e9fceffba00.log:14786`                                                                   |
| 2026-04-15 16:55:25 | Auto-restart began to handle uncommitted changes.                                                                           | `logs/solution-draft-0717628d22607598cd694e9fceffba00.log:14795`                                                                   |
| 2026-04-15 16:55:46 | First auto-restart comment was posted to PR 1833.                                                                           | `logs/solution-draft-0717628d22607598cd694e9fceffba00.log:14991`                                                                   |
| 2026-04-15 16:56:40 | Second restart cycle still saw the same uncommitted file.                                                                   | `logs/solution-draft-0717628d22607598cd694e9fceffba00.log:23722`                                                                   |
| 2026-04-15 16:57:22 | Third restart cycle still saw the same uncommitted file.                                                                    | `data/agent-log-event-summary-compact.txt`                                                                                         |
| 2026-04-15 16:59:17 | Agent staged `scripts/autoload/unlock_manager.gd`.                                                                          | `logs/solution-draft-a67740672b4eedff7350d8059d673aa1.log:43558`                                                                   |
| 2026-04-15 16:59:26 | Agent text described a `git commit`, but the emitted content was malformed XML-like text instead of a valid tool call.      | `logs/solution-draft-a67740672b4eedff7350d8059d673aa1.log:46680`                                                                   |
| 2026-04-15 17:03:56 | Agent emitted `Agent exiting` with `hasError:false`, then Hive reported the internal usage `TypeError` as an agent failure. | `logs/solution-draft-6aeb182b868a97770a8ed3ff525819f6.log:52706`, `logs/solution-draft-6aeb182b868a97770a8ed3ff525819f6.log:52713` |
| 2026-04-15 17:04:05 | Cleanup fallback committed staged code and removed `.gitkeep` in `dd5c998953f67e83c6cc3ce23f4b390a121bbe7c`.                | `data/pr-1833-view.json`                                                                                                           |
| 2026-04-15 17:04:10 | GitHub Actions runs started for the final commit.                                                                           | `data/pr-1833-actions-runs.json`                                                                                                   |
| 2026-04-15 17:07:45 | The last captured Actions run completed successfully.                                                                       | `data/pr-1833-actions-runs.json`                                                                                                   |
| 2026-04-15 17:08:06 | PR 1833 was closed unmerged.                                                                                                | `data/pr-1833-view.json`                                                                                                           |
| 2026-04-15 18:25:55 | External issue author commented "try again".                                                                                | `data/external-issue-1826-comments.json`                                                                                           |
| 2026-04-15 18:52:36 | PR 1839 opened.                                                                                                             | `data/related-pr-1839-view.json`                                                                                                   |
| 2026-04-15 23:00:26 | PR 1839 merged.                                                                                                             | `data/related-pr-1839-view.json`                                                                                                   |
| 2026-04-15 23:00:27 | External issue 1826 closed.                                                                                                 | `data/external-issue-1826-view.json`                                                                                               |

## CI Findings

PR 1833 had 16 captured Actions runs on branch `issue-1826-328adfe76998`:

- 8 runs for bootstrap commit `ea966c531d62c3267848507ad43a2ad90d6c6881`.
- 8 runs for final commit `dd5c998953f67e83c6cc3ce23f4b390a121bbe7c`.
- All captured runs completed with conclusion `success`.

The workflows included compile, build, lint, architecture, gameplay validation,
interop, and unit-test jobs. Some logs contain build/import warnings from Godot,
but there was no failing workflow conclusion in the downloaded run set.

## Root Causes

1. Agent finalization failure

   The agent modified `scripts/autoload/unlock_manager.gd` but left it
   uncommitted. Auto-restart attempted to recover, and a later run staged the
   file, but the model emitted malformed XML-like text where Hive expected a
   valid command/tool call to create the commit.

2. Recovered agent error was treated as fatal

   The final stream had an internal usage error event and then a clean agent exit
   event with `hasError:false` and process exit code `0`. Hive Mind already had
   recovery logic for `session.idle`, `log` message `exiting loop`, and
   `step_finish` reason `stop`, but it did not recognize `Agent exiting` with
   `hasError:false`. It also did not clear post-hoc JSON detection of the earlier
   recovered `type:error` event.

3. Auto-restart recovery delegated too much to the agent

   Once Hive knew there were local changes, it repeatedly asked the agent to
   resolve the situation. That was appropriate for ambiguous changes, but not for
   the narrow final state where the only remaining work was to commit already
   staged changes and remove bootstrap scaffolding.

4. Domain ambiguity was not resolved by tests

   PR 1833 interpreted "offensive grenade" as adding grenade type `3`
   (`AGGRESSION_GAS`) in addition to frag grenade `1`. The later merged PR 1839
   used "frag grenade" in the title and changed tests around unlock behavior.
   PR 1833 did not add or update tests to confirm the intended grenade constant.

5. Diagnostic noise obscured the control flow

   Repeated `fatal: not a git repository` lines appeared while Hive was counting
   comments. They were not the direct failure, but they made the logs harder to
   interpret and indicate at least one Git command was running outside the
   intended repository directory.

## Fix Implemented Here

The code change in this PR updates `src/agent.lib.mjs` so a structured event
with this shape marks the agent run as recovered and completed:

```json
{ "type": "log", "message": "Agent exiting", "hasError": false }
```

The fix also clears post-hoc detection of earlier `type:error` events when:

- the process exit code is `0`;
- a successful-completion marker was seen;
- the earlier output error was already recovered by the final agent state.

The regression test in `tests/test-agent-error-detection.mjs` reproduces the
issue 1629 stream: an internal usage `TypeError`, then clean `Agent exiting` with
`hasError:false`. The test verifies both streaming and post-hoc error states are
cleared before Hive decides whether the agent run failed.

## Recommended Follow-up Work

1. Deterministic staged-change recovery

   When auto-restart finds already staged changes and the user prompt explicitly
   permits commits, Hive should run a deterministic finalization path: collect
   `git diff --cached`, run available focused checks, commit with a generated
   message, push, then continue PR finalization. It should ask for help only when
   the diff is ambiguous or validation fails.

2. Stronger PR finalization gate

   Before closing or marking a PR failed, verify whether the branch actually has
   a non-bootstrap diff, whether the latest commit has passing checks, and
   whether the PR description/test evidence was updated. PR 1833 had a final code
   diff and passing checks, but the failed agent-run state dominated the outcome.

3. Better semantic ambiguity handling

   If an issue term maps to multiple constants or domain concepts, Hive should
   require a code search, tests, or a clarifying issue/PR comment before widening
   behavior. Here, "offensive grenade" was ambiguous enough that PR 1833 and PR
   1839 reached different grenade interpretations.

4. Auto-restart exit criteria

   Auto-restart should distinguish "model needs to continue reasoning" from
   "tooling can finish the mechanical git step". Repeating the same prompt after
   identical uncommitted-change detections consumed time and added PR comments
   without changing the state.

5. Comment-counting working directory fix

   Ensure every Git command used by PR monitoring/comment counting runs with the
   target repository as `cwd`. This should remove the repeated
   `fatal: not a git repository` lines and make future failure logs cleaner.

6. External issue reporting policy

   No new issue was opened in `Jhon-Crow/godot-topdown-MVP` because the project
   issue was later resolved by PR 1839. No upstream agent-tool issue was opened
   because the available evidence is enough for a Hive-side recovery fix but not
   enough for a standalone minimal reproduction of the internal usage-token
   `TypeError`.

## Existing Components Checked

- `src/agent.lib.mjs`: streaming error detection, completion markers, post-hoc
  error detection, usage-limit classification, and token-usage handling.
- `src/agent-token-usage.lib.mjs`: token usage accumulation that is related to
  the internal `usage.inputTokens.total` error text.
- `src/solve.restart-shared.lib.mjs`: auto-restart mechanics and uncommitted
  change handling.
- `src/solve.auto-merge.lib.mjs` and helpers: PR finalization and merge-oriented
  checks.
- `tests/test-agent-error-detection.mjs`: existing regression suite for agent
  error false positives and recovered errors.

## Data Collection Commands

Representative commands used:

```bash
gh pr view 1833 --repo Jhon-Crow/godot-topdown-MVP --json ...
gh api repos/Jhon-Crow/godot-topdown-MVP/issues/1833/comments --paginate
gh api repos/Jhon-Crow/godot-topdown-MVP/pulls/1833/comments --paginate
gh api repos/Jhon-Crow/godot-topdown-MVP/pulls/1833/reviews --paginate
gh api repos/Jhon-Crow/godot-topdown-MVP/issues/1833/timeline --paginate
gh run view <run-id> --repo Jhon-Crow/godot-topdown-MVP --log
gh gist view <gist-id> --raw
```

The online reference notes for these collection paths are in
`research/online-sources.md`.
