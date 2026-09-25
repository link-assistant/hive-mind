# Issue #2293 — auto-restart on description edits that never happened

## Executive summary

Across two repositories, `solve` told the AI (and, in auto-restart mode, the
pull request) that a title or description had been edited after the last
commit. No human had made those edits:

- [relative-meta-logic#184](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5824973158)
  was restarted with "Issue description edited" and later "Issue description and
  title edited". Its issue [#183](https://github.com/link-foundation/relative-meta-logic/issues/183)
  has **0** edits in its history.
- [meta-language#196](https://github.com/link-foundation/meta-language/pull/196)
  started a new run on 2026-09-24T18:30:11Z with the feedback line
  "Pull request description was edited after last commit". The only edit after
  the last commit was made by the previous AI session.

There were three root causes. All three are fixed in this change, and a regression
test replays the real timestamps from both incidents.

## Timeline and evidence

### meta-language#196 (session `ebc8054f-…`)

| Time (UTC)             | Event                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| 2026-09-23 20:34:20    | "🤖 AI Work Session Started" comment — solver session opens        |
| 2026-09-24 02:41:14    | last commit on the branch                                          |
| 2026-09-24 02:56:07    | PR body edited by `konard` (the solver, same account as the human) |
| 2026-09-24 03:12–03:16 | working session summary, Solution Draft Log, "✅ Ready to merge"   |
| 2026-09-24 18:24:36    | human comment "Required correction…" — bumps the PR's `updated_at` |
| 2026-09-24 18:30:11    | new run: `Pull request description was edited after last commit`   |

The comment counter correctly skipped the three solver comments and counted
only the human comment at 18:24:36. The description check did not filter
anything: it compared the REST `updated_at` (18:24:36, bumped by the human
comment) with the last commit time.

The 5 later restarts all gave "CI failures detected". That was true:
`Full Requirements Aggregate` kept failing. But the restart comments did not
name the check or link to its run.

### relative-meta-logic#184

- The PR body had no `Fixes #N`, so `solve` fell back to `issueNumber = prNumber`
  (184) and then wrote `Fixes #184` into PR #184's own body.
- From then on, the "issue" being checked was the PR itself. The AI rewrites
  that title and description in every session. Log lines 156–157 of the first
  run reported both "Pull request description" and "Issue description" edited,
  for the same AI-made edit (15:41:07Z, inside the session that started at
  14:25:14Z).
- The auto-restart loop's issue #2007 snapshot check watched the same PR title
  and body, and restarted when the AI changed them.
- Issue #183 has `updated_at == created_at` (2026-09-20T14:31:31Z) and no
  `userContentEdits`.

The GraphQL edit history and comment timelines used above are saved in
[`experiments/issue-2293/`](../../../experiments/issue-2293/). Replaying them
through the new detector gives:

```
$ node experiments/issue-2293/replay-edit-history.mjs ml-196
ml-196: 16 solver session windows, 45 edits, 45 ignored (solver/bot), 0 external
$ node experiments/issue-2293/replay-edit-history.mjs rml-184
rml-184: 42 solver session windows, 78 edits, 78 ignored (solver/bot), 0 external
```

(`konard` never edited either PR by hand. The rml-184 history also contains
edits by `github-actions`, which are now ignored as bot edits.)

## Root causes

1. **`updated_at` was treated as "content edited".** GitHub bumps `updated_at`
   for comments, labels, cross-references and reviews. That is how #183 looked
   "edited" with 0 edits in its history.
2. **Solver edits were not told apart from human edits.** The solver and the
   maintainer share the `konard` login, so the editor login alone cannot
   separate them. The comment check already used tool-comment markers; the
   edit check had nothing like that.
3. **Self-referencing fallback.** When `issueNumber === prNumber`, the PR was
   checked a second time as its own "issue". Its AI-owned title and body were
   watched as a user-owned feedback surface, and `Fixes #<own number>` was
   written into its body.

## Fix

| Area                                   | Change                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/description-edits.lib.mjs` (new)  | Reads the real edit history: GraphQL `userContentEdits`, where each node's `diff` is the full saved body, and `RenamedTitleEvent`. It builds **solver session windows** from tool comments, and a session opened by PR creation counts too. Edits by bots, or by the same account inside a window, are ignored. |
| `src/solve.feedback.lib.mjs`           | "Title/description edited" feedback comes only from those external edits. Each one is listed with evidence (timestamp, editor, `+A/-R lines` and a diff excerpt, or `"old" → "new"` for titles). The PR is not checked again as its own issue.                                                                  |
| `src/solve.results.lib.mjs`            | `ensurePullRequestIssueLink` no longer writes `Fixes #<own number>` into a PR that has no separate issue.                                                                                                                                                                                                       |
| `src/solve.auto-merge.lib.mjs`         | Skips the #2007 issue-metadata snapshot when the "issue" is the PR itself. Each restart reason is logged and posted with evidence. Restarts caused by the same failing checks are counted, flagged in the comment, and reported to the AI.                                                                      |
| `src/solve.auto-merge-helpers.lib.mjs` | The `ci_failure` blocker lists each failing check together with its run URL.                                                                                                                                                                                                                                    |
| `src/restart-evidence.lib.mjs` (new)   | Formats evidence lines and the `## 🔄 Auto-restart N/M` comment body.                                                                                                                                                                                                                                           |

An auto-restart comment now looks like this:

```
## 🔄 Auto-restart 2/5

**Reason:** CI failures detected

**Evidence:**
- Failing check: Full Requirements Aggregate — https://github.com/…/actions/runs/…/job/…

⚠️ The same checks have been failing for 2 restarts in a row.

Starting new session to address the issues.
```

### Why repeated CI failures are flagged, not hard-stopped

The failure signature is the set of failing check names. In #196,
`Full Requirements Aggregate` failed every time, but the sessions pushed
commits. A name-only signature cannot tell "still failing, but moving from
11/189 towards 189/189" apart from "stuck". Separately, the existing
[#2247](https://github.com/link-assistant/hive-mind/issues/2247) stall guard (`stopWhenSessionRepeated`) already stops the
loop when a session ends exactly like the previous one, with the same commit,
tree and final message. So a repeated signature is now flagged in three places:
the restart comment, the log, and the AI's feedback ("change approach"). It
does not end the run by itself.

## Tests

`tests/test-issue-2293-description-edit-false-positive.mjs` (default suite):

- A. #196 replay: the solver's PR body edit gives **no** feedback. The real
  human comment is still counted, and the verbose log explains why the edit
  was ignored.
- B. A real human description and title edit gives feedback, with timestamp,
  editor and diff excerpt.
- C. An issue whose `updated_at` was bumped but has 0 `userContentEdits` gives
  **no** feedback.
- D. `issueNumber === prNumber`: the PR is queried once, and no self-referencing
  `Fixes #184` is written.
- E. Session windows: PR creation opens a session, and "limit reached" does not.
  Another user's edit inside a window is still feedback; bot edits never are.
- F. The restart comment lists failing checks with run URLs, issue edit diffs,
  and the repeated-failure warning.

On the previous code, test A fails with exactly the false positives from the
incident:
`["New comments on the pull request: 1","Pull request description was edited after last commit","Issue description was edited after last commit"]`.

## Follow-ups (other subsystems, out of scope here)

Items 3–5 of the issue are about container and runtime infrastructure, not the
feedback logic:

- **Finished containers keep large build directories** even though
  `keepContainer false` is set, and `$ --status` still shows removed containers.
  Tracked in [#2294](https://github.com/link-assistant/hive-mind/issues/2294).
- **`gh auth setup-git` fails with `EBUSY`**, because `/home/box/.gitconfig` is
  bind-mounted as a single file and git writes config by rename. The fix
  belongs in the container launcher: mount a directory with
  `GIT_CONFIG_GLOBAL`, or copy the file in.
- **Log noise**: under `--verbose`, `src/codex.lib.mjs` sets `RUST_LOG=debug`
  for Codex, which accounts for 45k of the 135k lines in the #196 log. Repeated
  plugin-manifest warnings are not deduplicated either.
