# Issue 1791 Case Study: Preserve Intentional `.gitkeep` Changes

## Summary

Issue: <https://github.com/link-assistant/hive-mind/issues/1791>

The linked `link-foundation/link-cli` PR intentionally removed `.gitkeep`, but
hive-mind final cleanup later re-added it. That made it impossible for an AI
working session to delete `.gitkeep` when the requested repository cleanup
required that deletion.

The fix is to treat `.gitkeep` differently from `CLAUDE.md`: if any commit
after the initial auto-commit touched `.gitkeep`, final cleanup leaves the file
alone and preserves the PR's current state.

## Collected Evidence

Local evidence was saved under this directory:

- `data/hive-mind-issue-1791.json`: original hive-mind issue.
- `data/hive-mind-issue-1791-comments.json`: issue comments.
- `data/hive-mind-pr-1792*.json`: current fix PR metadata, comments, reviews.
- `data/link-cli-issue-79*.json`: linked upstream issue metadata and comments.
- `data/link-cli-pr-80*.json`: linked upstream PR metadata, comments, reviews,
  files, diff, and CI run metadata.
- `data/link-cli-commit-75b25bca-initial.json`: initial auto-commit evidence.
- `data/link-cli-commit-7c78b6bf-remove-gitkeep.json`: work commit that removed
  `.gitkeep`.
- `data/link-cli-commit-a5beebbb-readd-gitkeep.json`: cleanup commit that
  re-added `.gitkeep`.
- `logs/link-cli-pr-80-solution-draft-log.txt.gz`: compressed solution draft log
  from the linked PR comment. The uncompressed log is 41,474,797 bytes.

The environment did not have the `file` utility, so the compressed log was
validated with `gzip -t` and `gzip -l`.

## Timeline

- 2026-05-12 15:23:20 UTC: `75b25bcaec30ed34fd9e9e78017a8e81ebb7bb22`
  created the initial task-details commit and appended an update line to
  `.gitkeep`.
- 2026-05-12 15:54:08 UTC: `7c78b6bf3b559e9fc11f42eea996d1c91aff8ec1`
  implemented the repository cleanup and removed `.gitkeep`.
- 2026-05-12 15:57:56 UTC: PR 80 working-session summary reported `.gitkeep`
  as removed and listed local verification.
- 2026-05-12 16:00:32 UTC: PR 80 was reported ready to merge.
- 2026-05-12 16:00:33 UTC: `a5beebbbd8efcc436956f041b22bde514090e6c4`
  created `Revert: Remove .gitkeep changes from initial commit`, re-adding
  `.gitkeep`.
- 2026-05-12 16:00:41 UTC: CI ran successfully on the cleanup commit, which
  meant CI did not catch the semantic regression.
- 2026-05-12 16:05:17 UTC: hive-mind issue 1791 was opened to report the
  cleanup bug.

## Requirements

1. Detect whether `.gitkeep` was changed in the PR after the initial
   auto-commit.
2. If later PR work touched `.gitkeep`, do not modify it during final cleanup.
3. Continue removing or restoring the initial auto `.gitkeep` change when no
   later PR commit touched `.gitkeep`.
4. Preserve existing `CLAUDE.md` cleanup behavior.
5. Add a reproducing regression test.
6. Save logs and data under `docs/case-studies/issue-1791` and reconstruct the
   event sequence.

## Root Cause

`cleanupClaudeFile` used `git diff <initial-commit> HEAD -- .gitkeep` to decide
whether the auto-created file needed cleanup. If the diff was non-empty, the
manual cleanup path restored `.gitkeep` from the parent of the initial commit
when that parent had a `.gitkeep`.

That behavior was valid for auto-generated session files, but `.gitkeep` can be
a normal repository file. In PR 80, the work commit deleted `.gitkeep`
intentionally. The cleanup code interpreted the deletion as a conflict with the
initial auto-commit and restored the parent version, erasing the requested
repository cleanup.

The linked PR's final diff did not expose `.gitkeep` as changed because the
cleanup commit cancelled the intentional deletion.

## Solution Options

Option A, selected: before `.gitkeep` cleanup, inspect path history with
`git log --format=%H <initial-commit>..HEAD -- .gitkeep`. If any later commit
touched `.gitkeep`, return without modifying it. This directly matches the issue
requirement and preserves user work whether the final state is deletion,
modification, or an intentional restoration.

Option B: skip cleanup whenever `git diff <initial-commit> HEAD -- .gitkeep`
shows a final-state difference. This fixes the observed deletion but misses the
case where later PR work touched `.gitkeep` and restored it to the initial
auto-commit content.

Option C: apply the same skip behavior to `CLAUDE.md`. This was rejected because
existing cleanup behavior for `CLAUDE.md` is separate and broader than this
issue.

## Implemented Fix

- `src/solve.results.lib.mjs` now checks whether `.gitkeep` was touched after
  the initial auto-commit and skips final `.gitkeep` cleanup when it was.
- `tests/test-issue-1791-gitkeep-cleanup.mjs` reproduces the deletion bug and
  verifies that the old cleanup behavior still runs when only the initial
  auto-commit touched `.gitkeep`.

## Verification

Focused regression command:

```sh
node tests/test-issue-1791-gitkeep-cleanup.mjs
```

Before the fix, the deletion regression failed because cleanup created
`Revert: Remove .gitkeep changes from initial commit` and re-added `.gitkeep`.
After the fix, the deletion is preserved and no cleanup commit is created.

## Online Research

Official Git documentation was used to confirm command behavior:

- `git diff --quiet` implies `--exit-code`, and `--exit-code` returns 1 when
  differences exist and 0 when none exist:
  <https://git-scm.com/docs/git-diff>
- `git revert` records new commits that reverse earlier patches:
  <https://git-scm.com/docs/git-revert>
- `git log` is the existing Git component used for path history inspection:
  <https://git-scm.com/docs/git-log>

No external upstream issue was filed because the root cause is in hive-mind's
cleanup algorithm, not in `link-foundation/link-cli`.
