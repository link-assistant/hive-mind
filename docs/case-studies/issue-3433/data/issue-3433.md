# #3433 Kill and critical-error recovery ignore git submodules: 644 uncommitted files and 5 local-only commits left in a stopped container; 'preserved' branch and PR point to commits on no remote

labels: []

## Summary

Hive Mind has no submodule handling at all (`grep -rl submodule src/` finds only `ci-pre-existing-failure.lib.mjs` and `fix.update-dependencies.lib.mjs`). In a repository whose code lives in git submodules, the AI's work is in the submodules, and every Hive Mind safety net looks only at the top-level repository:

1. **Critical-error preservation** (`src/critical-error-commit.lib.mjs`) commits only top-level paths. It saved a submodule _pointer_ to a commit that exists on no remote, and none of the 644 uncommitted submodule files.
2. **Uncommitted / unpushed detection** (`claude.uncommitted-changes.lib.mjs`, `session-changes.lib.mjs`, kill recovery) counts ` M modules/x` as one changed path and never looks inside, so a kill reports "6 uncommitted files, 1 unpushed commit" while 644 files and 5 commits are at risk.
3. **Fork mode**: the AI pushed submodule commits to forks of the submodule repositories, and the parent PR points at commits that do not exist in the submodule repositories named in `.gitmodules`. No pull request was opened in any submodule repository, so the parent PR can never be merged as is.

## Reproduction (real run, Hive Mind 2.35.8)

- Pull request: https://github.com/Godmy/stylist-svelte/pull/6 (issue Godmy/stylist-svelte#5), fork mode, head `konard/Godmy-stylist-svelte:issue-5-56eee094418d`.
- `.gitmodules` has 13 submodules (`modules/architecture`, `modules/design-system` with 4 nested ones, `modules/information`, `modules/interaction`, `modules/sandbox`, …), all `https://github.com/Godmy/stylist-svelte-*.git`.
- The Claude CLI was killed by the cgroup OOM killer (exit 137, 2026-10-13 21:44:49 UTC, #3125). Failure log: https://gist.githubusercontent.com/konard/2ba301cb6b93846b71c592d35512bf73/raw/3d3ddca347bb3b35ac9e81ae0024e227e13f5345/tmp-hive-mind-log-upload-aJp9Ce-sanitized.log.txt

What solve saw at the end (failure log, 21:44:52):

```
 M modules/architecture
 M modules/design-system
 M modules/information
 M modules/interaction
 M modules/sandbox
?? experiments/update-manifest-presets.mjs
💾 Critical error (CLAUDE execution failed with Claude command failed with exit code 137) — preserving uncommitted changes on recovery/issue-5-56eee094418d (the PR branch is not changed)...
✅ Uncommitted changes preserved as 2c6e378c on recovery/issue-5-56eee094418d.
✅ Preserved work pushed to recovery/issue-5-56eee094418d.
```

What the preserved commit actually contains ([2c6e378c](https://github.com/konard/Godmy-stylist-svelte/commit/2c6e378ca6b15f4f882804989d1ebc814401c4bc)):

```
added    experiments/update-manifest-presets.mjs
modified modules/sandbox   -Subproject commit cd02ed4…  +Subproject commit 07734a8…
```

`07734a8b68eed29a700433532dddba9105ab41c2` does not exist in `Godmy/stylist-svelte-sandbox` or `konard/stylist-svelte-sandbox` ("No commit found for SHA"). So the "preserved" branch points at a commit that only exists inside the stopped container.

What is still only in the stopped container `d5173fa1-9c62-4b9b-979f-5748624f3860` (read-only overlay mount, 2026-10-17):

| Repository                                                                           | Uncommitted files                   | Commits on no remote                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------- |
| top level                                                                            | 1 untracked + 5 modified submodules | 1 (`d0bf68e35`, 2 files, +257)                                   |
| `modules/architecture`                                                               | 112                                 | 0                                                                |
| `modules/design-system` (nested: `layout` 54, `svg` 22, `theme` 20, `typography` 14) | 110                                 | 0                                                                |
| `modules/information`                                                                | 59                                  | 0                                                                |
| `modules/interaction`                                                                | 202                                 | 0                                                                |
| `modules/sandbox`                                                                    | 161                                 | 4 (`07734a8`, `0b38ffd`, `b9bacc1`, `1d87358`; 5 files, +174/−2) |
| **total in submodules**                                                              | **644**                             | **4**                                                            |

The kill recovery that followed (#2887, exit 127) never ran, so none of this reached GitHub. A resumed session in the same container would still have it; a fresh run would lose it.

### Fork-only submodule commits in the parent PR

PR #6 changes 9 files: `.gitkeep`, 6 screenshots, and two submodule pointers:

- `modules/design-system` → `bdc60b1bb`, which exists only in `konard/stylist-svelte-design-system` (branch `issue-5-56eee094418d`);
- `modules/sandbox` → `cd02ed447`, which exists only in `konard/stylist-svelte-sandbox`.

`Godmy/stylist-svelte-design-system` and `Godmy/stylist-svelte-sandbox` have no such branch and no pull request from the fork. Merging PR #6 would leave `git submodule update` broken for everyone who clones `Godmy/stylist-svelte`.

## Expected

- Every check that asks "is there unsaved work?" recurses into submodules (`git submodule foreach --recursive git status --porcelain`, plus `git log --branches --not --remotes` per submodule) and reports the real counts.
- Critical-error preservation and kill recovery save submodule work first: commit inside each dirty submodule (innermost first) on a `recovery/<branch>` branch, push it to that submodule's push remote, then commit the parent pointer. Never push a parent pointer to a commit that was not pushed.
- In fork mode, a parent PR that bumps a submodule pointer gets a matching PR in each submodule's upstream repository (or the run fails loudly and says which submodule PRs are missing). The parent PR description links them.
- The final "ready" check refuses a parent PR whose submodule pointers are not reachable from the URLs in `.gitmodules`.

## Workaround

Until fixed, a human has to recover the work from the stopped container, for example `docker start` it (or `$ --resume d5173fa1-9c62-4b9b-979f-5748624f3860 -- bash`), then in each submodule `git add -A && git commit && git push <fork> HEAD`, and open the submodule PRs by hand. Do not remove the container before that.

## Suggested fix in code

- `src/critical-error-commit.lib.mjs`: before building the recovery index, run `git submodule foreach --recursive` (deepest first) to commit and push dirty submodules on `recovery/<branch>`; skip the parent pointer for any submodule whose push failed, and say so in the log and the PR comment.
- `src/claude.uncommitted-changes.lib.mjs`, `src/session-changes.lib.mjs`, `src/uncommitted-changes-feedback.lib.mjs`: count files inside submodules; tell the AI in the uncommitted-changes feedback which submodule has what.
- `src/solve.repo-setup.lib.mjs` (fork mode): fork each submodule repository that the PR changes, and open the submodule PRs in `solve.results`.
- Tests: a fixture repository with one submodule and one nested submodule; kill during a session with dirty files in both; assert the recovery branches exist on the remotes and every pointer is reachable.

Related: #3125 (the cgroup OOM that killed this run), #2887 (the recovery that then failed with exit 127), #2263 (critical-error recovery commits).

## comments
