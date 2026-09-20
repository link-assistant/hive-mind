# Issue 1819 Case Study: Dotted Fork Name Parsed Incorrectly

## Summary

The failed run against `pypypy1337/parking.github.io` did create the intended fork:

`konard/pypypy1337-parking.github.io`

Hive Mind then parsed the `gh repo fork` output with a regex that did not allow dots in repository names. The parsed name became:

`konard/pypypy1337-parking`

Repository verification retried that wrong name until it failed with "Fork exists but not accessible after multiple retries".

## Raw Data

Saved data:

- `raw-data/hive-mind-issue-1819.json`
- `raw-data/hive-mind-pr-1820.json`
- `raw-data/upstream-issue-1.json`
- `raw-data/upstream-issue-1-comments.json`
- `raw-data/upstream-repo.json`
- `raw-data/actual-fork-repo.json`
- `raw-data/misparsed-fork-repo.json`
- `raw-data/upstream-failure-log.txt`
- `working-session-logs/test-issue-1819-before-fix.log`
- `working-session-logs/test-issue-1819-after-fix.log`
- `working-session-logs/test-issue-1819-final.log`
- `working-session-logs/test-issue-1803.log`
- `working-session-logs/test-issue-1332.log`

Online documentation checked:

- GitHub CLI `gh repo fork` manual: https://cli.github.com/manual/gh_repo_fork
- GitHub fork documentation: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo
- GitHub repository creation documentation: https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
- GitHub remote URL documentation: https://docs.github.com/en/get-started/git-basics/about-remote-repositories

## Timeline

- 2026-05-20T21:49:42Z: `solve v1.72.3` started for `https://github.com/pypypy1337/parking.github.io/issues/1`.
- 2026-05-20T21:49:49Z: access check found read-only access to a public repository and enabled auto-fork mode.
- 2026-05-20T21:49:53Z: Hive Mind ran `gh repo fork pypypy1337/parking.github.io --fork-name pypypy1337-parking.github.io --clone=false`.
- 2026-05-20T21:49:54Z: GitHub CLI returned `https://github.com/konard/pypypy1337-parking.github.io`.
- 2026-05-20T21:49:54Z: Hive Mind logged `Fork created: konard/pypypy1337-parking`, dropping `.github.io`.
- 2026-05-20T21:49:55Z through 2026-05-20T21:50:56Z: Hive Mind retried verification of the truncated repository name.
- 2026-05-20T21:50:56Z: repository setup failed.
- 2026-05-20T21:50:58Z: Hive Mind posted the failure log to the upstream issue.
- During this investigation: GitHub API confirmed `konard/pypypy1337-parking.github.io` exists, is a fork, and has parent/source `pypypy1337/parking.github.io`; the truncated `konard/pypypy1337-parking` lookup returned 404.

## Requirements Extracted From Issue 1819

- Download issue logs and related data into `docs/case-studies/issue-1819`.
- Reconstruct the event sequence.
- List requirements and root causes.
- Search for relevant external facts and existing components.
- Fix the root cause when enough data exists.
- Add debug or verbose output only if root cause cannot be found.
- Report an external issue only if the root cause belongs to another GitHub-hosted project.
- Complete the work in PR 1820.

## Root Cause

The root cause was local to Hive Mind in `src/solve.repository.lib.mjs`.

The fork creation path parsed `gh repo fork` output with:

```js
/(?:github\.com\/|^|\s)([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/;
```

That expression accepts `owner/repo` names containing letters, digits, `_`, and `-`, but it rejects `.` in the repository segment. For a GitHub Pages repository name like `parking.github.io`, it captures only `parking`.

The `gh repo fork` command itself behaved correctly. It returned the full fork URL, and the GitHub API confirms that the fork exists with the expected parent/source. No upstream GitHub CLI issue is needed for this incident.

## Solution Implemented

Added `src/github-repository-names.lib.mjs` with `parseForkFullNameFromGhOutput`.

The parser:

- handles HTTPS GitHub URLs;
- handles SSH-style GitHub URLs;
- handles plain `owner/repo already exists` style output;
- allows dots in repository names;
- avoids parsing a profile URL like `github.com/user` as `com/user`;
- strips `.git` from clone-style URL output.

`src/solve.repository.lib.mjs` now uses that helper when parsing `gh repo fork` output, so verification checks `konard/pypypy1337-parking.github.io`.

## Alternatives Considered

- Broaden the inline regex only. This would fix the immediate dot case, but it would keep URL parsing embedded in repository setup and make future URL variants harder to test.
- Call GitHub API after fork creation and ignore CLI output. This is more authoritative, but it adds another network request and still needs a correct candidate fork name. It may be useful later as an additional recovery path, not as the smallest fix here.
- Replace `gh repo fork` with a direct GitHub REST API fork call. The existing CLI integration already handles user auth and command behavior across the codebase, so replacing it would increase risk for no benefit in this bug.

## Verification

Regression test:

```bash
node tests/test-issue-1819-dotted-fork-name.mjs
```

Before the implementation, the test failed because the dotted-name parser module did not exist. After the implementation, it passes and verifies both the parser behavior and that repository setup uses the parser.

Related local checks should include the issue-specific test plus fork-name regression tests for issues 1332 and 1803.
