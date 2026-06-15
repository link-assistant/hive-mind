# Case Study: Issue #1931 - deleted repository leaves solver stuck as executing

## Summary

| Field                          | Value                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue                          | [#1931](https://github.com/link-assistant/hive-mind/issues/1931)                                                                                      |
| Prepared PR                    | [#1933](https://github.com/link-assistant/hive-mind/pull/1933)                                                                                        |
| Affected feature               | `solve --auto-restart-until-mergeable`, watch mode, `/merge` CI polling                                                                               |
| Observed symptom               | A deleted or inaccessible GitHub target kept being treated as unknown CI status                                                                       |
| Stuck duration in captured log | 68 polling checks, from about 14:44:14 UTC to 17:01:26 UTC                                                                                            |
| Trigger repository             | `uselessgoddess/ultimate`                                                                                                                             |
| Trigger PR                     | `uselessgoddess/ultimate#2`                                                                                                                           |
| Root cause                     | Terminal GitHub entity errors were collapsed into retryable CI or mergeability states                                                                 |
| Fix                            | Add an explicit terminal GitHub-state checker and propagate terminal entity errors through CI, mergeability, watch, auto-merge, and merge-queue paths |

## Captured Data

All evidence gathered for the investigation is stored in [`./raw/`](./raw/).

| File                                                                                             | Source                       | Notes                                              |
| ------------------------------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------- |
| [`raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt`](./raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt) | Linked gist from the issue   | 125,848-line failing execution transcript          |
| [`raw/issue-1931.json`](./raw/issue-1931.json)                                                   | `gh issue view 1931`         | Issue title, body, state, timestamps               |
| [`raw/issue-1931-comments.json`](./raw/issue-1931-comments.json)                                 | GitHub issue comments API    | Empty at investigation time                        |
| [`raw/pr-1933.json`](./raw/pr-1933.json)                                                         | `gh pr view 1933`            | Prepared PR metadata before this fix was finalized |
| [`raw/pr-1933-conversation-comments.json`](./raw/pr-1933-conversation-comments.json)             | PR conversation comments API | Empty at investigation time                        |
| [`raw/pr-1933-review-comments.json`](./raw/pr-1933-review-comments.json)                         | PR review comments API       | Empty at investigation time                        |
| [`raw/pr-1933-reviews.json`](./raw/pr-1933-reviews.json)                                         | PR reviews API               | Empty at investigation time                        |

## Requirements From The Issue

1. Fail when the repository is deleted or inaccessible.
2. Fail when the issue is deleted or closed.
3. Fail when the pull request is deleted or closed.
4. Fail when the source branch is deleted.
5. Fail when the target branch is deleted.
6. Download logs and data into `docs/case-studies/issue-1931`.
7. Produce a detailed case-study analysis using the captured data and online facts.
8. Fix every affected path in a single PR.

## Timeline

Times below are from the captured log and the current environment is UTC.

| Time     | Evidence                                                               | Event                                                                                                 |
| -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 12:41:07 | [`raw/...txt`](./raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt#L19)     | Original `solve` session starts and writes `/home/box/solve-2026-06-15T12-41-07-149Z.log`.            |
| 12:41:33 | [`raw/...txt`](./raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt#L124631) | Session start timestamp later used for comment detection.                                             |
| 14:26:41 | [`raw/...txt`](./raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt#L120799) | `gh pr checks 2` fails: GraphQL cannot resolve repository `uselessgoddess/ultimate`.                  |
| 14:31:15 | [`raw/...txt`](./raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt#L121481) | Manual diagnostics show repository, workflow runs, and check-runs all return HTTP 404.                |
| 14:44:14 | [`raw/...txt`](./raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt#L124695) | Auto-restart check #1 sees PR REST 404 and GraphQL repository errors, then continues waiting for CI.  |
| 14:46:17 | [`raw/...txt`](./raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt#L124712) | Check #2 repeats the same terminal errors and again schedules the next 120-second check.              |
| 17:01:26 | [`raw/...txt`](./raw/15ce8dd2-1d65-412f-bc3b-71e77a523abf.txt#L125834) | Check #68 still reports the repository/PR/comment endpoints as missing, then schedules another retry. |

## External Facts

The fix intentionally treats these GitHub API responses as terminal entity states, not transient CI states:

- GitHub documents the REST "Get a repository" endpoint as returning `404 Resource not found` for missing repositories. Source: <https://docs.github.com/en/rest/repos/repos#get-a-repository>
- GitHub documents the REST "Get a pull request" endpoint as returning `404 Resource not found`. Source: <https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request>
- GitHub documents issue deletion/access cases for "Get an issue": deleted or inaccessible issues can return `404 Not Found`, and deleted issues with read access can return `410 Gone`. Source: <https://docs.github.com/en/rest/issues/issues#get-an-issue>
- GitHub documents the REST "Get a branch" endpoint as returning `404 Resource not found`. Source: <https://docs.github.com/en/rest/branches/branches#get-a-branch>
- GitHub's REST troubleshooting guide states that `404 Not Found` may be used instead of `403 Forbidden` to avoid confirming private repository existence, and that path parameters with slashes must be URL encoded. Source: <https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#404-not-found-for-an-existing-resource>

## Root Cause

The failing run had enough information to stop early:

- REST calls for repository, pull request, issue comments, and review comments returned HTTP 404.
- GraphQL calls for PR checks and PR details returned "Could not resolve to a Repository".
- Direct diagnostics showed repository access and check-run endpoints were unavailable.

The solver did not have one shared classification for these states. CI polling and mergeability checks caught errors and returned generic "unknown" or "not mergeable" states. The watch loop then interpreted those states as retryable, logged "CI/CD status could not be determined (will retry)", and slept for another 120 seconds. That repeated for 68 checks in the captured transcript.

## Fix

The implementation adds `src/github-terminal-state.lib.mjs`, which:

- checks repository reachability first;
- checks pull request existence/state and treats merged PRs as successful terminal states;
- checks the pull request head and base branches;
- checks the linked issue when it is separate from the PR;
- classifies GitHub REST 404, REST 410, GraphQL unresolved repository/PR/issue/branch, and `gh: Not Found` responses as terminal entity errors.

The terminal state is wired into:

- `src/solve.auto-merge.lib.mjs` for auto-restart-until-mergeable and auto-merge;
- `src/solve.watch.lib.mjs` for watch mode;
- `src/github-merge.lib.mjs` for CI status, detailed CI status, wait-for-CI, and mergeability checks;
- `src/solve.auto-merge-helpers.lib.mjs` for blocker generation;
- `src/telegram-merge-queue.lib.mjs` so queue processing fails terminal entity errors instead of skipping them.

## Regression Test

[`tests/test-github-terminal-state-1931.mjs`](../../../tests/test-github-terminal-state-1931.mjs) reproduces the important terminal states with a mocked GitHub command runner:

- repository 404 fails immediately with `repository_unavailable`;
- closed issues stop an open PR watch loop with `issue_closed`;
- deleted source branches stop with `source_branch_unavailable`;
- merged PRs remain successful terminal states;
- REST 410 is treated as terminal for deleted issues;
- auto-merge, watch, CI polling, mergeability, and merge queue paths are source-wired to the terminal error handling.

Run:

```bash
node tests/test-github-terminal-state-1931.mjs
```

## Result

Deleted or inaccessible repositories, issues, pull requests, source branches, and target branches now stop the relevant long-running operation as soon as hive-mind detects the terminal GitHub state. Transient API failures such as HTTP 500 remain retryable.
