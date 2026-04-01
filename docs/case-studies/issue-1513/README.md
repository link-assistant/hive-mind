# Case Study: Issue #1513 - PR Creation Fails with GraphQL Error After Fork + Invitation Acceptance

## Summary

The `solve.mjs` auto-PR creation process fails with a transient GitHub GraphQL error (`Something went wrong while executing your query`) when creating a cross-fork pull request shortly after accepting a repository invitation and creating a new fork. The error is caused by a combination of **GitHub API eventual consistency** (race condition) and the **lack of retry logic** for the `gh pr create` command itself.

## Affected Issue

- **Target Repository**: rumaster/saas-project
- **Target Issue**: [rumaster/saas-project#1](https://github.com/rumaster/saas-project/issues/1)
- **Fork Repository**: konard/rumaster-saas-project
- **Error Code**: `E400:214657:A4EF54:90FAA6:69CBABD3`
- **Error**: `GraphQL: Something went wrong while executing your query`
- **hive-mind version**: 1.40.2

## Timeline of Events

| Timestamp (UTC)              | Event                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| 2026-03-31T11:10:37.117Z     | solve.mjs v1.40.2 started                                                                       |
| 2026-03-31T11:10:42.173Z     | Disk/memory checks passed                                                                       |
| 2026-03-31T11:10:47.973Z     | Auto-fork: No write access detected, **fork mode enabled** (`argv.fork = true`)                 |
| **2026-03-31T11:10:48.741Z** | **Invitation accepted** for rumaster/saas-project (user now has write access)                   |
| 2026-03-31T11:11:00.210Z     | No fork conflict detected                                                                       |
| 2026-03-31T11:11:02.515Z     | Fork created: konard/rumaster-saas-project                                                      |
| 2026-03-31T11:11:05.932Z     | Fork ready, cloning begins                                                                      |
| 2026-03-31T11:11:07.613Z     | Repository cloned to /tmp/gh-issue-solver-1774955458801                                         |
| 2026-03-31T11:11:09.142Z     | Branch created: issue-1-28a455e15c07                                                            |
| 2026-03-31T11:11:10.360Z     | Branch pushed to fork (exit code 0)                                                             |
| 2026-03-31T11:11:12.864Z     | Compare API confirms: 1 commit ahead of main                                                    |
| 2026-03-31T11:11:13.246Z     | Branch verified on GitHub                                                                       |
| 2026-03-31T11:11:14.329Z     | Current user: konard                                                                            |
| 2026-03-31T11:11:14.646Z     | User has collaborator access (confirmed after invitation acceptance)                            |
| 2026-03-31T11:11:15.143Z     | Commits confirmed: 1 ahead of origin/main                                                       |
| 2026-03-31T11:11:15.148Z     | `gh pr create --draft --head konard:issue-1-28a455e15c07 --repo rumaster/saas-project` executed |
| **2026-03-31T11:11:16.345Z** | **FAILURE**: GraphQL error `E400:214657:A4EF54:90FAA6:69CBABD3`                                 |

**Critical timing**: Only ~28 seconds elapsed between invitation acceptance (11:10:48) and PR creation attempt (11:11:16). Only ~14 seconds between fork creation (11:11:02) and PR creation.

## Root Cause Analysis

### Primary Root Cause: GitHub API Eventual Consistency (Transient GraphQL Error)

GitHub's API returns a generic `Something went wrong while executing your query` error when internal services haven't fully propagated state. This is a **transient, retryable error** - it typically resolves within seconds.

In this case, two state changes happened in quick succession:

1. **Repository invitation acceptance** (11:10:48) - changes the user's permission level
2. **Fork creation** (11:11:02) - creates a new repository relationship

When `gh pr create` was called 14 seconds later, GitHub's internal GraphQL service had not fully indexed the fork-to-upstream relationship, causing the generic error.

### Secondary Root Cause: Execution Order Issue

The auto-fork decision (`argv.fork = true`) is made at `src/solve.mjs:274` **before** the invitation is accepted at `src/solve.mjs:310`. After the invitation is accepted, the user now has write access and fork mode is unnecessary, but the flag is never re-evaluated.

```
Line 239-275: argv.fork = true  (no write access detected)
Line 309-311: autoAcceptInviteForRepo()  (invitation accepted, user now HAS write access)
Line 316-317: checkRepositoryWritePermission({ useFork: argv.fork })  (skips re-check because useFork=true)
```

If the fork decision were re-evaluated after invitation acceptance, the code would work directly on the repository without needing a fork, avoiding the cross-fork GraphQL timing issue entirely.

### Tertiary Issue: No Retry Logic for `gh pr create`

The existing code has retry logic for:

- Compare API sync (lines 571-624): 5 retries with exponential backoff
- PR verification after creation (lines 1206-1258): 5 retries with exponential backoff (added in Issue #1468)
- Assignee validation failure (lines 1124-1155): 1 retry without assignee

But the `gh pr create` command itself (line 1121) has **no retry logic** for transient GraphQL errors. When GitHub returns a transient error, the process immediately fails.

## Proposed Solutions

### Solution 1: Add Retry Logic for `gh pr create` (Primary Fix)

Add exponential backoff retry around the `gh pr create` command for transient GraphQL errors, similar to the existing compare API retry pattern. This handles the immediate failure and provides resilience against GitHub's eventual consistency.

**Retryable error patterns**:

- `Something went wrong while executing your query`
- `was submitted too quickly` (rate limiting)
- `internal error` / `Internal Server Error`

### Solution 2: Re-evaluate Fork Mode After Invitation Acceptance (Secondary Fix)

After `autoAcceptInviteForRepo()` succeeds at line 310, re-check write permissions and disable fork mode if the user now has write access. This avoids the cross-fork complexity entirely when the user already has access.

### Solution 3: Add Verbose Debug Output for PR Creation Command

Log the full `gh pr create` stderr output even in non-verbose mode when the error is a GraphQL error, to aid debugging in future occurrences.

## Related Issues

- **Issue #1468**: PR verification fails due to GitHub API eventual consistency (same root pattern, different symptom)
- **Issue #1462**: Triple error output during PR creation failure (consolidated to single error block)

## Data Files

- [`solve-log.txt`](./solve-log.txt) - Full solve session log
- [`gh-pr-create-command.txt`](./gh-pr-create-command.txt) - The exact command that failed

## References

- [GitHub API Eventual Consistency](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#conditional-requests) - GitHub's documentation on API caching
- [GitHub Community: GraphQL Something went wrong](https://github.com/orgs/community/discussions/categories/api-and-webhooks) - Known pattern of transient GraphQL errors
