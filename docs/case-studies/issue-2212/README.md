# Issue 2212: `solve <repository-url>` — one pull request for every open issue

## Executive summary

[Issue #2212](https://github.com/link-assistant/hive-mind/issues/2212) asks for two
things that only make sense together.

The first is a new entry point: `solve https://github.com/owner/repo`. Until now
`solve` accepted an issue URL or a pull request URL and rejected everything else —
`validateGitHubUrl` returns `isValid: false` for a bare repository URL, which is the
reproduction pinned at the top of the new test suite. Repository mode makes that URL
mean something: collect every open issue of the repository, create **one** combined
issue that lists them as GitHub **native sub-issues**, and then hand that issue to
the normal single-issue `solve` flow. One run, one pull request, and on merge every
listed issue closes at once.

The second is the safety net that makes the first one honest:
`--ensure-all-sub-issues-addressed`. After the main solve finishes, it lists the
sub-issues of the issue being solved and checks that the pull request description
closes **each** of them with a reference GitHub actually recognizes. When something
is missing it restarts the AI tool with the concrete list and asks it to double
check that those sub-issues were really addressed in this single pull request. The
option is a first-class flag for any issue with sub-issues; repository mode simply
turns it on for itself, together with `--deep-analysis`.

Two GitHub rules shaped almost every design decision, and both were verified against
GitHub's own documentation sources rather than assumed:

- a parent issue accepts **at most 100 sub-issues** (and 8 nesting levels), so a
  repository with more open issues gets the **oldest 100** and the rest are reported
  as intentionally left out;
- closing keywords need the **full syntax per issue** — `Fixes #1, #2` closes only
  `#1` — so both the generated issue body and the restart feedback emit one keyword
  per line, and the checker uses the repository's existing `prClosesIssue` parser
  instead of a second, subtly different one.

## Scope and evidence

Everything quoted here is committed under [`data/`](data/) and listed with checksums
in [`MANIFEST.md`](MANIFEST.md), so the analysis can be re-checked without network
access.

| Directory        | What it holds                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `data/github/`   | Issue #2212 and PR #2216 with all three comment channels, captured with `--paginate`.                             |
| `data/research/` | The GitHub documentation sources for the sub-issue limit, the closing-keyword syntax and the rate-limit guidance. |
| `data/logs/`     | The test suites, the fake-`gh` experiment, and a real read-only preview run against `link-assistant/hive-mind`.   |

An empty `[]` file is not a capture failure: issue #2212 and pull request #2216 had
no comments at capture time, on any of the three channels.

## Requirements reconstructed

The issue is one paragraph per requirement. Quoted verbatim, then restated as a
checkable requirement.

| #   | Quote from the issue                                                                                                                                                                     | Requirement                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| R1  | "similar to how /fix does, we do ask for deep analysis"                                                                                                                                  | Repository mode enables `--deep-analysis`.                                                        |
| R2  | "create an issue with actual GitHub native sub-issues, that includes all open issues in the repository"                                                                                  | One combined issue; every open issue attached through the native sub-issues API, not just listed. |
| R3  | "produce single pull request draft as /solve command would normally do, but for single issue"                                                                                            | After the issue exists, the normal single-issue flow runs unchanged.                              |
| R4  | "if we hit the limit, we should add 100 (or whatever the limit) oldest only, and ignore others"                                                                                          | Oldest-first selection, capped at GitHub's documented limit, with the remainder reported.         |
| R5  | "After that issue is created we just pass it to /solve instead."                                                                                                                         | Repository mode resolves to an issue URL and then gets out of the way.                            |
| R6  | "as the result of merging all these issues including the combined issue will be closed"                                                                                                  | The pull request must close the sub-issues **and** the combined issue.                            |
| R7  | "we double check that pull request description will have exactly all the issues listed"                                                                                                  | A post-solve verification of the pull request description.                                        |
| R8  | "for any other single issue, we should have `--ensure-all-sub-issues-addressed` (which we also will use here internally) … if not we auto-resume/auto-restart and ask do double check …" | A general-purpose flag, usable on any issue, that auto-restarts when references are missing.      |
| R9  | "collect data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder … search online for additional facts and data"       | This case study, with committed evidence and cited sources.                                       |

## Facts established by research

Each fact below is committed under `data/research/` so the claim can be re-checked
offline.

### A parent issue takes at most 100 sub-issues, nested up to 8 levels

`data/research/github-docs-adding-sub-issues.md` (the source of
<https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues>):

> You can add up to {% data variables.projects.sub-issue_limit %} sub-issues per parent issue and create up to eight levels of nested sub-issues.

The variable is resolved in `data/research/github-docs-variables-projects.yml`:

> `sub-issue_limit: '100'`

This is R4's "whatever the limit": `MAX_SUB_ISSUES_PER_PARENT = 100` in
`src/solve.repository-mode.lib.mjs`, asserted by the test _"GitHub sub-issue limit
per parent is 100"_.

### Closing keywords need the full syntax for each issue

`data/research/github-docs-linking-a-pull-request-to-an-issue.md`:

> Multiple issues | Use full syntax for each issue | `Resolves #10, resolves #123, resolves octo-org/octo-repo#100`

The same page's "up to ten issues" sentence is about **manual** linking in the
sidebar ("You can manually link up to ten issues to each pull request"), not about
closing keywords — which is why a single pull request can legitimately close 88
issues by keyword. This distinction is the reason repository mode does not cap the
list at ten.

Consequences in the code: `buildClosingKeywordBlock` and `buildMissingReferenceBlock`
emit one keyword per line, and `findMissingSubIssueReferences` delegates to the
existing `prClosesIssue` parser — which is what the test _"a comma separated keyword
list only counts for the first issue"_ pins down.

### The sub-issues endpoint is explicitly prone to secondary rate limiting

`data/research/github-docs-rest-sub-issues.excerpt.md`:

> Creating content too quickly using this endpoint may result in secondary rate limiting.

And GitHub's REST best-practice guide,
`data/research/github-docs-best-practices-for-using-the-rest-api.md`:

> If you are making a large number of `POST`, `PATCH`, `PUT`, or `DELETE` requests, wait at least one second between each request. This will help you avoid secondary rate limits.

> Otherwise, wait for at least one minute before retrying. If your request continues to fail due to a secondary rate limit, wait for an exponentially increasing amount of time between retries, and throw an error after a specific number of retries.

Attaching sub-issues is exactly "a large number of POST requests" — up to 100 of
them, back to back. So `attachSubIssues` waits `SUB_ISSUE_ATTACH_DELAY_MS = 1000`
between attachments, and retries a rate-limited attachment with
`SUB_ISSUE_ATTACH_BACKOFF_MS = [60s, 120s]`, bounded by
`SUB_ISSUE_ATTACH_MAX_ATTEMPTS = 3`. Attaching 100 sub-issues therefore costs about
a minute — negligible next to a solve run, and much cheaper than being throttled
half-way through.

Non-rate-limit errors are deliberately **not** retried: the common one is "issue
already has a parent", which would fail identically after any wait. See the test
_"attachSubIssues retries a rate-limited attachment and gives up on other errors"_.

## Existing components reused

The issue asks to "check known existing components/libraries, that solve similar
problem or can help in solutions". Everything needed already existed in this
repository; no new dependency was added.

| Component                                                   | Already did                                                                              | Reused for                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/task.split.lib.mjs` — `buildAddSubIssueApiArgs`        | Builds the `POST …/sub_issues` call with `X-GitHub-Api-Version: 2026-03-10`.             | Attaching each open issue to the combined issue.                               |
| `src/task.issue-creation.lib.mjs` — `createTaskIssue`       | Creates an issue from a body file, sanitizes it, retries without labels/type on failure. | Creating the combined issue.                                                   |
| `src/github-linking.lib.mjs` — `prClosesIssue`              | Knows every closing keyword and every reference form GitHub recognizes.                  | Deciding whether a sub-issue is really closed by the pull request description. |
| `src/solve.keep-working.detect.lib.mjs`                     | `normalizeKeepWorkingLimit` — number / bare flag / "forever" semantics.                  | `--ensure-all-sub-issues-addressed` shares the exact same value semantics.     |
| `src/solve.restart-shared.lib.mjs` — `executeToolIteration` | Runs one more AI iteration with feedback, reports usage limits and API errors.           | The restart loop, so it behaves like `--escalate` and `--keep-working`.        |
| `src/github-url-parser.lib.mjs` — `parseGitHubUrl`          | Already classified repository URLs as `type: 'repo'`.                                    | Detecting a repository URL in `solve` and in the Telegram bot.                 |
| `src/github-rate-limit.lib.mjs` — `isRateLimitError`        | Recognizes primary and secondary rate-limit errors.                                      | Deciding whether an attachment failure is worth retrying.                      |
| `src/fix.ci-cd.lib.mjs`                                     | Turns a repository into a solvable issue and delegates to `solve`.                       | The shape of the whole flow — R1's "similar to how /fix does".                 |

External libraries were considered and rejected: `@octokit/rest` would duplicate the
authentication, retry and pagination behaviour the repository already gets from
`gh`, and `gh sub-issue` is a third-party extension that cannot be assumed present on
a worker. Repository mode therefore issues plain `gh api` calls, like the rest of the
codebase.

## Solution per requirement

### R1, R3, R5 — behave like `/fix`, then get out of the way

`src/solve.mjs` resolves repository mode **before** `validateGitHubUrl(issueUrl)`,
because that validator is what rejects a repository URL today. On success it swaps
`issueUrl` for the URL of the combined issue and applies `argvOverrides`
(`deep-analysis` and `ensure-all-sub-issues-addressed`); on a non-repository URL it
returns `{ handled: false }` and nothing changes. Everything downstream — validation,
fork handling, the prompt, the pull request, the post-solve loops — runs exactly as
it does for a hand-written issue.

The ordering is a regression risk, so it is pinned by a test: _"solve.mjs resolves
repository mode before validating the URL as an issue"_.

### R2 — native sub-issues, not a checklist

`buildOpenIssuesApiArgs` lists open issues with
`repos/{owner}/{repo}/issues?state=open&sort=created&direction=asc&per_page=100`
plus `--paginate`. Two details are easy to get wrong and are both covered by tests:

- the query string must be part of the endpoint. `gh api -f key=value` switches the
  request to **POST**, which makes this endpoint fail with HTTP 422 ("title wasn't
  supplied"). Test: _"open-issues query parameters go into the endpoint, never into
  -f fields"_.
- the REST `/issues` endpoint returns pull requests too. They carry a `pull_request`
  object and are filtered out. Test: _"pull requests are recognized and excluded from
  the selection"_.

Each selected issue is then attached with `buildAddSubIssueApiArgs`, which sends the
REST **database id** (`sub_issue_id`), not the issue number — which is why
`normalizeOpenIssueEntry` keeps `id` and `attachSubIssues` refuses an entry without
one instead of sending a malformed request.

Attachment failures are non-fatal by design: an issue that already has a different
parent is rejected by the API, and losing the whole run over one such issue would be
worse than solving the rest. The issue stays listed in the combined issue body and
in the required closing references either way.

### R4 — oldest 100, and say what was left out

`selectOldestOpenIssues` filters pull requests, normalizes, sorts by `created_at`
with the issue number as a tie-breaker (monotonic per repository) and caps the list.
Sorting happens client-side as well as server-side so the selection is deterministic
even if the caller passes an unsorted list. The remainder is reported in three
places: the run log, the combined issue's "Scope" section, and the preview example.

### R6, R7 — the pull request must close all of them

The combined issue body ends with the exact block the pull request description needs,
one `Fixes #N` per line, and its "Requirements" section states that the pull request
must close the combined issue as well.

The verification is `--ensure-all-sub-issues-addressed`
(`src/solve.ensure-sub-issues.lib.mjs`), which runs **last** among the post-solve
loops — after `--escalate`, `--auto-ensure-requirements` and `--keep-working` — because
those loops may still rewrite the pull request description, and the references have
to be checked against its final state. Pinned by the test _"solve.mjs runs the
sub-issue check after the other post-solve loops"_.

Each iteration re-reads the pull request title and body (a closing keyword in the
title counts too), computes the missing references, and restarts the AI tool with a
feedback block that names every missing sub-issue and spells out the lines to add.
The restart passes `ensureAllSubIssuesAddressed: 0` so a restart cannot recurse into
another restart — also pinned by a test.

### R8 — a general-purpose flag

`--ensure-all-sub-issues-addressed` (aliases `--ensure-all-sub-issues`,
`--ensure-sub-issues`) is a normal, documented `solve` option with the same value
semantics as `--keep-working-until-all-requirements-are-fully-done`: bare flag = 5
restarts, an explicit count, or `forever`/`unlimited`/`infinite`. It works on any
issue that has sub-issues; when the issue has none, it logs that there is nothing to
verify and returns. Repository mode just turns it on for the issue it generated.

### R9 — this case study

Collected under `data/`, cited above, checksummed in `MANIFEST.md`.

## Telegram

The Telegram `/solve` command validated its argument with
`allowedTypes: ['issue', 'pull']`, so a repository URL was rejected before ever
reaching `solve.mjs`. It now allows `'repo'` as well, and the info block labels such
a run as a URL rather than as an issue.

Two pre-existing behaviours were re-read rather than assumed, because a repository
URL has no issue number:

- `validateGitHubEntityExistence` guards its issue/pull lookup with `if (number)`, so
  it checks the user and the repository and skips the entity step;
- `resolvePullRequestUrlForSession` returns `null` unless the context is an issue with
  owner, repo and number.

Both are covered by source guards in `tests/test-telegram-solve-repository-url-2212.mjs`.

## Verification

| Evidence                                                | What it shows                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/logs/test-solve-repository-mode-2212.log`         | 47 assertions: the reproduction, the pure helpers, the fake-`gh` orchestration, the CLI flag, the wiring.                                                                        |
| `data/logs/test-telegram-solve-repository-url-2212.log` | 20 assertions for the Telegram entry point, starting from the rejection it used to produce.                                                                                      |
| `data/logs/experiment-repository-mode.log`              | The whole flow against a fake `gh`: the combined issue body and every `gh` call it would make.                                                                                   |
| `data/logs/example-preview-hive-mind.log`               | A **real**, read-only run of `examples/solve-repository-mode-preview.mjs` against this repository: 88 open issues found, all of them under the sub-issue limit, nothing created. |

The preview log is the closest thing to production evidence that does not create
anything: it uses the same `prepareRepositoryModeIssue` a real run uses, through the
real `gh`, and prints the issue that would have been created.

## Known limits

- **Over 100 open issues.** The newest ones are left out of the run, by the issue's
  own instruction ("ignore others"). They are counted in the log and in the combined
  issue body, so a second run picks them up.
- **Issues that already have a parent.** GitHub allows one parent per issue, so such
  an issue cannot be attached. It is still listed and still gets a closing reference;
  only the native sub-issue link is missing.
- **The check verifies references, not correctness.** `--ensure-all-sub-issues-addressed`
  can prove that the pull request _claims_ to close every sub-issue and can ask the AI
  tool to double check the work; it cannot prove the work is right. That remains the
  reviewer's job.
