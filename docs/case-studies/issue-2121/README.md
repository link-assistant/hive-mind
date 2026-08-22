# Issue 2121: `/task --ci-cd` CI/CD issue creation

## Summary

Issue [#2121](https://github.com/link-assistant/hive-mind/issues/2121) asks for:

```text
/task --ci-cd https://github.com/link-assistant/agent
```

to perform only the issue-creation part of:

```text
/fix --ci-cd https://github.com/link-assistant/agent
```

The reported command uses a typographic em dash (`—ci-cd`) in place of two
ASCII hyphens. The bot instead returned “Missing GitHub repository URL.”

The completed behavior creates the same evidence-rich CI/CD remediation issue
as `/fix`, returns its URL, and does not start `/fix` or `/solve`. The user can
reply to the result with:

```text
/solve --development-log --deep-analysis --auto-merge
```

## Evidence collected

- The issue body and comments were read through GitHub CLI on 2026-07-31.
- The issue has no comments.
- The screenshot was downloaded with authenticated GitHub access, verified as
  a decodable PNG, and inspected locally. It shows `/task —ci-cd <repo>`
  followed by the missing-repository error.
- Prepared PR [#2122](https://github.com/link-assistant/hive-mind/pull/2122)
  initially contained only a placeholder commit and had no review,
  conversation, or inline comments.
- Related issue [#1733](https://github.com/link-assistant/hive-mind/issues/1733)
  and merged PR [#1929](https://github.com/link-assistant/hive-mind/pull/1929)
  define `/fix --ci-cd` as issue generation followed by
  `/solve --development-log --deep-analysis --auto-merge`.
- Related issue [#1734](https://github.com/link-assistant/hive-mind/issues/1734)
  and merged PR [#1735](https://github.com/link-assistant/hive-mind/pull/1735)
  define ordinary `/task` as issue creation only, returning a URL that can be
  replied to with `/solve`.
- Issue [#2021](https://github.com/link-assistant/hive-mind/issues/2021) already
  introduced shared normalization of Telegram en/em dashes to ASCII long-option
  markers. `/task --ci-cd` reuses that parser.

The captured issue, prepared-PR, related-work, and root-cause facts are
compiled in [`investigation-data.json`](investigation-data.json). The external
sources used for the API and CLI facts are recorded in
[`research-sources.json`](research-sources.json).

## Timeline

1. `/task` issue creation was introduced by #1734/#1735.
2. `/fix --ci-cd` was introduced by #1733/#1929. Its entry point contained the
   GitHub context collection while its pure title/body builders were shared.
3. Typographic option-dash normalization was added for Telegram in #2021.
4. A user sent `/task —ci-cd <repo>`.
5. `parseCommandArgs()` correctly normalized `—ci-cd` to `--ci-cd`, but
   `handleTaskCommand()` had no CI/CD branch.
6. Because the command was not `--split`, the handler treated it as free-form
   issue creation. `parseTaskIssueCreationInput()` then saw the option and URL
   together on one line rather than a standalone repository line, so it
   reported a missing repository.

## Root cause

The parser was not missing generic “options before URL” support:
`parseCommandArgs()` already tokenized the first command line and normalized
typographic dashes. The missing piece was command semantics.

`telegram-task-command.lib.mjs` recognized only two modes:

1. ordinary issue creation; and
2. issue splitting (`/split` or `--split`).

There was no `--ci-cd` mode. Also, the network-backed context collector lived
inside executable `fix.mjs`, so calling the same issue-generation logic from
the task handler would otherwise require duplication or spawning the full fix
workflow.

## Requirements and coverage

| ID  | Requirement                                                     | Coverage                                                        |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| R1  | Accept `/task --ci-cd <GitHub repository>`                      | Explicit CI/CD mode and repository parser                       |
| R2  | Accept the screenshot’s `—ci-cd` spelling                       | Existing shared dash normalization plus regression test         |
| R3  | Work with the option before the URL                             | Token-based repository discovery                                |
| R4  | Create only the `/fix` issue                                    | Direct shared service call; no command-session execution        |
| R5  | Produce the same issue as `/fix`                                | Both paths use `prepareCiCdIssue()` and `createCiCdIssue()`     |
| R6  | Collect languages, commit, and CI runs                          | Shared GitHub-backed service extracted from `fix.mjs`           |
| R7  | Preserve exact-title/body and template ranking behavior         | Existing `fix.ci-cd.lib.mjs` builders remain authoritative      |
| R8  | Preserve Bug type/label fallback                                | Shared service calls `createTaskIssue()` with the same metadata |
| R9  | Return a usable created-issue URL                               | Telegram status message is edited with the full URL             |
| R10 | Explain how to continue normal execution                        | Response gives the exact `/solve` flags                         |
| R11 | Do not regress `/task`, `/split`, or `/fix`                     | Focused handler, service, and existing fix tests                |
| R12 | Document public behavior in all maintained languages            | Four READMEs and four localized help entries                    |
| R13 | Add release metadata                                            | Minor changeset                                                 |
| R14 | Compile evidence, requirements, research, and solution analysis | This case study                                                 |

## Solution alternatives

### A. Teach the ordinary issue parser to ignore `--ci-cd`

This would remove the screenshot error but create an issue whose body is merely
the remaining command text. It would not collect CI runs, languages, the latest
commit, or template recommendations. It does not satisfy R4–R8.

### B. Spawn `fix <repo> --ci-cd --no-solve`

This reuses behavior, but it turns a short issue-creation interaction into a
managed command session. The task handler would lose its established direct
created-URL reply behavior, and callers would have to scrape CLI output. It
also makes the “issue only” fallback depend on the `/fix` executable path.

### C. Duplicate the collector in the task handler

This is straightforward but allows `/task` and `/fix` to drift in API queries,
fallback behavior, issue metadata, and prompt construction.

### D. Extract one shared issue service (selected)

`fix.ci-cd-issue.lib.mjs` owns GitHub context collection, preparation, and
typed issue creation. The `/fix` CLI keeps orchestration and solve spawning;
the `/task` handler calls only the shared issue service. This gives both entry
points identical output while preserving their intentionally different
lifecycle behavior.

## Existing components and external facts

- `parseCommandArgs()` and `normalizeCliArgs()` already handle ASCII, en-dash,
  and em-dash long options. Reuse avoids command-specific Unicode handling.
- `parseFixRepository()` already accepts GitHub repository URLs and
  `owner/repo` shorthand while rejecting deeper issue/PR URLs.
- `buildCiCdIssueBody()` remains the single prompt builder.
- `createTaskIssue()` sanitizes title/body, uses a temporary body file, applies
  optional type/labels, and retries without unsupported metadata.
- GitHub’s repository-languages endpoint reports bytes of code per language,
  which supports the existing byte-weighted template order.
- GitHub’s workflow-runs endpoint supports both `head_sha` and `branch`
  filters, which supports exact-commit collection plus the existing branch
  fallback.
- GitHub’s commit endpoint accepts a branch name as `ref`, which supports
  resolving the default branch’s latest commit.
- GitHub CLI officially supports `--body-file`, `--label`, and `--type` for
  issue creation, matching the existing safe issue-creation implementation.

## Verification strategy

The minimum reproduction is a handler test using the screenshot form:

```text
/task —ci-cd https://github.com/link-assistant/hive-mind
```

It asserts that:

- the target repository reaches the CI/CD issue generator;
- no `/fix` or task command session starts;
- the response contains the full created issue URL; and
- the response gives the continuation `/solve` flags.

Additional tests pin ASCII parsing and exercise the shared service with mocked
GitHub language, repository, commit, workflow-run, and issue-create calls.
