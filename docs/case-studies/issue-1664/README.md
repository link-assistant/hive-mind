# Issue 1664 Case Study: Auto-Restart Sessions Without Per-Session Logs

## Summary

Issue: <https://github.com/link-assistant/hive-mind/issues/1664>

Observed run: <https://github.com/konard/p-vs-np/pull/548#issuecomment-4311633075> through <https://github.com/konard/p-vs-np/pull/548#issuecomment-4311753351>

Hive Mind posted auto-restart notifications for restart iterations 2 through 9, but did not post matching per-session completion logs. The restart notifications said a new session was starting, but the tool was not actually invoked for those iterations.

## Preserved Evidence

- `logs/hive-mind-solve-2026-04-24T08-07-15-732Z.log`: original Hive Mind harness log from the issue gist.
- `logs/solution-draft-log-initial-1777018089431.txt`: initial Codex session log.
- `logs/solution-draft-log-restart-1-1777018267002.txt`: restart iteration 1 Codex session log.
- `logs/solution-draft-log-failure-1777019337672.txt`: final interrupted harness log.
- `data/p-vs-np-pr-548-comments-window.json`: PR comment timeline for the referenced window.
- `data/issue-1664.json`: issue snapshot.

## Timeline

- 2026-04-24 08:07:29 UTC: Work session started on `konard/p-vs-np` PR 548.
- 2026-04-24 08:08:15 UTC: Initial `Solution Draft Log` posted.
- 2026-04-24 08:10:20 UTC: Auto-restart iteration 1 triggered for merge conflicts.
- 2026-04-24 08:11:13 UTC: `Auto-restart-until-mergeable Log (iteration 1)` posted.
- 2026-04-24 08:13:18 UTC: Auto-restart iteration 2 notification posted for merge conflicts and uncommitted changes.
- 2026-04-24 08:13:19 UTC: `git pull` failed with `MERGE_HEAD exists`; no AI tool session started.
- 2026-04-24 08:15:24 through 08:28:00 UTC: Iterations 3 through 9 repeated the same pattern.
- 2026-04-24 08:28:55 UTC: User interrupted the run.
- 2026-04-24 08:29:03 UTC: Failure log posted.

## Root Cause

Restart iteration 1 left the local repository in an unfinished merge state. The Codex summary said the conflict was resolved but also said the branch still had staged merge changes and that it did not commit them.

The auto-restart-until-mergeable loop then detected both remote merge conflicts and local uncommitted changes. Before invoking the AI tool, the harness unconditionally ran:

```bash
git pull origin <branch>
```

That failed because the repository already had an unfinished merge:

```text
error: You have not concluded your merge (MERGE_HEAD exists).
hint: Please, commit your changes before merging.
fatal: Exiting because of unfinished merge.
```

The catch block treated this as a failed monitoring check and continued polling. Because the restart notification had already been posted before the failing `git pull`, the PR received "starting new session" comments for iterations where no session started and therefore no completion log existed.

## Online Reference Checks

- Git documents `git pull` as fetch followed by merge, so it is not a safe preflight operation over an unfinished local merge state: <https://git-scm.com/docs/git-pull>.
- Git documents that after a merge stops due to conflicts, the merge should be concluded with `git merge --continue`: <https://git-scm.com/docs/git-merge>.
- GitHub documents `MergeStateStatus.DIRTY` as meaning the merge commit cannot be cleanly created: <https://docs.github.com/v4/enum/mergestatestatus>.

## Requirements Extracted

- Preserve all referenced logs and data under `docs/case-studies/issue-1664`.
- Reconstruct the event timeline and root cause.
- Ensure auto-restart sessions produce matching completion or failure logs.
- Avoid indefinite restart/resume loops by default.
- Make restart/resume limits configurable across supported tools.
- Add enough automated coverage to prevent recurrence.

## Fix Plan Implemented

- Skip branch sync before auto-restart when local uncommitted changes or an unfinished merge are present, so the AI tool receives the local state it must resolve.
- Move auto-restart notification posting until after restart preflight succeeds and immediately before the tool is invoked.
- Add a default limit of 5 auto-restart iterations, configurable with `--auto-restart-max-iterations` and disableable with `0`.
- Add a default limit of 5 usage-limit auto-resume/auto-restart continuations, configurable with `--auto-resume-max-iterations` and disableable with `0`.
- Carry usage-limit continuation count across child solve processes with internal `--auto-resume-iteration`.
- Add regression coverage in `tests/test-auto-restart-limits-1664.mjs`.
