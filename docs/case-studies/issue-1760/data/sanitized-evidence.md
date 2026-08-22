# Sanitized Evidence for Issue #1760

This file contains short excerpts and derived facts. The raw execution log is not committed.

## Raw log handling

- Source inspected with `gh gist view ... --raw`.
- Local path during investigation: `/tmp/hive-issue-1760/issue-1760-source-log.raw`.
- Raw size: 102096 lines.
- Repository policy for this case study: no full private logs, source code, command transcripts, uploaded-log gist URLs, or authentication context are committed.

## Key sanitized excerpts from the raw `/hive` log

```text
Timestamp: 2026-05-06 11:16:15.532
Command: hive <private repository> --tool claude --think max --concurrency 1 --all-issues --once --skip-issues-with-prs --attach-logs --verbose --no-tool-check
Session: b59fc6e6-8600-494a-94aa-8558a3080c4a
```

```text
Found 5 open issue(s)
Checking for existing pull requests using batch GraphQL query...
Batch checking PRs for 5 issues using GraphQL...
Batch PR check complete: 0/5 issues have open PRs
Added to queue: <private repo issue #110>
Added to queue: <private repo issue #112>
Added to queue: <private repo issue #113>
Added to queue: <private repo issue #114>
Added to queue: <private repo issue #115>
```

```text
Worker 1 processing: <private repo issue #110>
Rechecking conditions for issue #110...
Issue is still open
Batch checking PRs for 1 issues using GraphQL...
Batch PR check complete: 0/1 issues have open PRs
Issue still has no open PRs
Executing solve for <private repo issue #110>...
```

```text
gh pr create stdout: <private repo pull request #116>
Created pull request for issue #110.
```

```text
Issues with solution drafts:
Batch checking PRs for 5 issues using GraphQL...
Batch PR check complete: 5/5 issues have open PRs
Issue #110 linked PRs:
  PR #111
  PR #116
```

## GitHub API facts used in the reconstruction

| Fact                                                                                 | Evidence source                                            |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Issue #110 had a cross-reference from PR #111 at 2026-05-06T07:37:45Z.               | `gh api repos/<private>/issues/110/timeline --paginate`    |
| PR #111 was converted to draft by an automated work session at 2026-05-06T11:15:55Z. | PR #111 timeline comment and draft transition evidence.    |
| The reported `/hive` command started at 2026-05-06 11:16:15.532 UTC.                 | Raw execution log header.                                  |
| Duplicate PR #116 was created at 2026-05-06T11:17:19Z.                               | `gh pr view 116 --repo <private> --json createdAt`         |
| PR #111 returned to ready-for-review at 2026-05-06T11:18:55Z.                        | PR #111 timeline.                                          |
| PR #111 merged at 2026-05-06T14:27:07Z.                                              | `gh pr view 111 --repo <private> --json mergedAt`          |
| Duplicate PR #116 closed unmerged at 2026-05-06T18:57:29Z.                           | `gh pr view 116 --repo <private> --json closedAt,mergedAt` |

## Code evidence

Before this fix, `src/github.batch.lib.mjs` only counted linked pull requests when the PR source was open and not draft:

```javascript
item.source.state === 'OPEN' && !item.source.isDraft;
```

That condition hid the original linked solution PR during the narrow draft window.
