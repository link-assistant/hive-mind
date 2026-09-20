# Issue 2266 case study: an empty repository is not a failed solve

Issue: <https://github.com/link-assistant/hive-mind/issues/2266>

Pull request: <https://github.com/link-assistant/hive-mind/pull/2269>

Investigation date: 2026-09-20

## Executive summary

On 2026-09-16, a Telegram user asked Hive Mind to solve every open issue in
`link-assistant/router`. The repository-mode scan correctly found zero open
issues, but represented that expected state as an `error`. `solve.mjs` then
exited with status 1, and the Telegram work-session formatter truthfully
rendered the nonzero status as `Work session failed`.

The defect was a classification and communication problem inside Hive Mind,
not a failure in GitHub, Telegram, Docker, or the target repository. The fix
has two layers:

1. Telegram performs a read-only repository-mode preflight after URL/entity
   validation. When the filtered issue selection is empty, it replies directly
   with an informational message and starts no queued or isolated work session.
2. The CLI independently treats an empty selection as `noWork` and exits 0.
   This is authoritative protection for direct CLI use and for the race in
   which issues are closed after Telegram's preflight but before the worker
   scans the repository.

All actual GitHub/API failures retain their existing nonzero failure path.

## Evidence inventory

The captured artifacts are intentionally committed with the analysis so later
investigations do not depend on mutable GitHub pages or an expiring container:

| Artifact                                                                                                                                                                                 | Purpose                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`data/tmp-start-command-logs-isolation-docker-c245f060-3fb0-4596-9957-fc3b887c5673.log.txt`](data/tmp-start-command-logs-isolation-docker-c245f060-3fb0-4596-9957-fc3b887c5673.log.txt) | Complete supplied execution log                                         |
| [`data/issue-screenshot.png`](data/issue-screenshot.png)                                                                                                                                 | Original Telegram failure screenshot                                    |
| [`data/expected-after-message.png`](data/expected-after-message.png)                                                                                                                     | Clearly labeled deterministic preview of the expected post-fix response |
| [`data/github/issue-2266.json`](data/github/issue-2266.json)                                                                                                                             | Initial issue metadata snapshot                                         |
| [`data/github/issue-2266-comments.json`](data/github/issue-2266-comments.json)                                                                                                           | Initial issue conversation snapshot (empty)                             |
| [`data/github/pr-2269.json`](data/github/pr-2269.json)                                                                                                                                   | Initial draft PR metadata snapshot                                      |
| [`data/github/pr-2269-conversation-comments.json`](data/github/pr-2269-conversation-comments.json)                                                                                       | Initial PR conversation snapshot (empty)                                |
| [`data/github/pr-2269-review-comments.json`](data/github/pr-2269-review-comments.json)                                                                                                   | Initial inline-review snapshot (empty)                                  |
| [`data/github/pr-2269-reviews.json`](data/github/pr-2269-reviews.json)                                                                                                                   | Initial review snapshot (empty)                                         |
| [`data/github/gist-206b8bf1905fed1368358f86399a2934.json`](data/github/gist-206b8bf1905fed1368358f86399a2934.json)                                                                       | Authenticated gist metadata and supplied content                        |
| [`logs/test-solve-repository-mode-2212-before.log`](logs/test-solve-repository-mode-2212-before.log)                                                                                     | Regression assertion failing against the old behavior                   |
| [`logs/test-solve-repository-mode-2212-after.log`](logs/test-solve-repository-mode-2212-after.log)                                                                                       | Repository-mode regression suite after the fix                          |
| [`logs/test-issue-2266-repository-no-work.log`](logs/test-issue-2266-repository-no-work.log)                                                                                             | Focused issue regression suite                                          |
| [`logs/test-i18n-after.log`](logs/test-i18n-after.log)                                                                                                                                   | Localization validation                                                 |
| [`data/research/`](data/research/)                                                                                                                                                       | Primary-source external research notes                                  |

`MANIFEST.md` records SHA-256 hashes for the evidence set.

The expected-state image is an automated static render, not a claim that a
production Telegram bot was exercised from this development checkout. The
behavior itself is verified by automated tests.

## Reconstructed timeline

All times are UTC.

| Time                    | Event and evidence                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-05 23:13:35     | PR [#2216](https://github.com/link-assistant/hive-mind/pull/2216) merged repository-wide solve mode. Its resolver deliberately rejected an empty issue selection.                                 |
| 2026-09-15 21:19:11     | PR [#2257](https://github.com/link-assistant/hive-mind/pull/2257) merged a related direct Telegram workflow, establishing the pattern of validating and answering before starting a work session. |
| 2026-09-16 09:29:23.961 | Execution `c245f060-3fb0-4596-9957-fc3b887c5673` started for `https://github.com/link-assistant/router` in Docker image `2.29.0` (evidence lines 4–12).                                           |
| 2026-09-16 09:29:38.514 | `solve` entered its normal run after dependency startup (lines 103–113).                                                                                                                          |
| 2026-09-16 09:29:44.289 | Repository mode reported zero open issues, converted the result to an error, and began an exit-1 path (lines 132–142).                                                                            |
| 2026-09-16 09:29:45.996 | The wrapper retained the failed container and recorded exit code 1 (lines 145–157). Telegram consequently displayed `Work session failed`.                                                        |
| 2026-09-20 05:50:10     | The private evidence gist was created, according to its captured metadata.                                                                                                                        |
| 2026-09-20 05:52:37     | Issue #2266 was opened with the log, screenshot, expected behavior, and case-study requirements.                                                                                                  |
| 2026-09-20 05:56:13     | Draft PR #2269 was opened for the prepared branch.                                                                                                                                                |
| 2026-09-20              | A failing regression was recorded, the two-layer fix was implemented, and focused tests passed.                                                                                                   |

## Requirements traceability

| Requirement reconstructed from issue #2266                                                                | Resolution                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero open issues must not be reported as an error.                                                        | Repository mode returns `noWork` and `solve.mjs` exits 0.                                                                                                            |
| Telegram must provide the information directly.                                                           | A preflight calls the same repository preparation logic, then `safeReply`s before queue reservation.                                                                 |
| Communicate that nothing needs to be done.                                                                | The English message says `Nothing to do` and that no work session was started; equivalent messages exist in Russian, Chinese, and Hindi.                             |
| Do not create needless work.                                                                              | The no-work branch creates no combined issue, reserves no solve capacity, and starts no container/session.                                                           |
| Preserve correct behavior during races and direct CLI use.                                                | The CLI repeats the scan and owns the authoritative exit status.                                                                                                     |
| Download the related logs and data.                                                                       | The supplied log, screenshot, gist/issue/PR metadata, and all three PR comment/review channels are stored under `data/`.                                             |
| Reconstruct events, enumerate requirements, identify root causes, research facts, and evaluate solutions. | This case study and the primary-source notes cover each item.                                                                                                        |
| Apply the fix everywhere the defect appears.                                                              | Both user-facing entry paths—Telegram and direct/worker CLI—are covered. Pull requests returned from GitHub's Issues endpoint are also tested.                       |
| Add diagnostics if the root cause cannot be determined.                                                   | Not needed: the supplied log and code path identified the exact branch and status conversion. Existing verbose fallback logging was retained for preflight failures. |
| File upstream issues for defects in other projects, if applicable.                                        | Not applicable. External systems behaved according to their contracts; Hive Mind generated the false failure locally.                                                |
| Prove the bug and prevent regression.                                                                     | The pre-fix assertion failure is preserved, and focused, repository-mode, and locale tests exercise the fixed behavior.                                              |

## Reproduction

The minimum code-level reproduction is a repository Issues API response with
no actual issues. An empty response and a response containing only pull
requests are equivalent after the required filtering.

Before the fix:

```text
resolveRepositoryModeTarget(...)
=> { handled: true, error: "o/r has no open issues to solve." }

solve.mjs
=> safeExit(1, "Repository mode failed")
```

The modified repository-mode test was run before implementation and failed
because `result.error` still contained the no-open-issues message. That output
is preserved in
[`logs/test-solve-repository-mode-2212-before.log`](logs/test-solve-repository-mode-2212-before.log).

## Causal analysis

### 1. A terminal success state was modeled as an error

`resolveRepositoryModeTarget` already distinguished three broad results:
unhandled non-repository URLs, a repository issue to continue solving, and an
`error`. The empty-selection branch used the third shape even though the scan
had succeeded and there was no work to create. It conflated “requested work is
already complete” with “the request could not be completed.”

### 2. The caller correctly mapped `error` to process failure

`solve.mjs` had no separate no-work state. It logged the returned error and
called `safeExit(1, 'Repository mode failed')`. This followed the resolver's
contract but produced the wrong Unix status for the user outcome. Node's
documented status convention makes nonzero an operational failure signal; see
[`data/research/node-process-exit.md`](data/research/node-process-exit.md).

### 3. Telegram lacked enough structured context after launch

The Telegram work-session layer observes a worker's completion status and
formats nonzero termination as a generic failure. The precise “no open issues”
text lived inside the worker log, so the chat layer could not reliably turn
that exit into a direct informational answer. Parsing log prose would create a
fragile cross-process protocol.

### 4. A naive API-length check would create a second bug

GitHub's repository Issues endpoint also returns pull requests. A nonempty
REST array can therefore still mean zero solvable issues. The new preflight
reuses `prepareRepositoryModeIssue`, including the existing filtering and
selection rules, instead of duplicating or weakening them. See
[`data/research/github-rest-issues.md`](data/research/github-rest-issues.md).

## Solutions considered

| Option                                                          | Benefits                                                                                        | Problems                                                                                                              | Decision           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Change only exit 1 to exit 0                                    | Correct CLI semantics; smallest patch                                                           | Telegram would still start a container and could show only generic completion rather than the requested direct answer | Insufficient alone |
| Parse the worker log in Telegram                                | Could special-case the old message                                                              | Couples UI behavior to mutable prose, downloads logs, and still wastes a session                                      | Rejected           |
| Telegram-only preflight                                         | Fast direct response; no queue/container work                                                   | Direct CLI remains wrong, and an issue-closing race can occur between preflight and worker start                      | Insufficient alone |
| Shared read-only preflight plus authoritative CLI no-work state | Direct response, no unnecessary session, consistent filtering, correct direct CLI/race behavior | Performs a second read only if a session is actually needed; preflight errors need fallback                           | Selected           |

No new external library is needed. Existing components already provide the
right boundaries: repository preparation for GitHub classification,
`safeReply` for Telegram messaging (see
[`data/research/telegram-bot-api-messaging.md`](data/research/telegram-bot-api-messaging.md)),
and `safeExit` for process status.

## Implementation

- `telegram-solve-repository-preflight.lib.mjs` translates a validated
  repository target into the shape expected by `prepareRepositoryModeIssue`
  and returns an explicit `noWork` result.
- `telegram-bot.mjs` runs that read-only check after normal input/entity
  validation but before duplicate checks, capacity reservation, queuing, and
  session creation. A preflight transport/authentication failure is logged in
  verbose mode and falls through to the normal worker path, where complete
  diagnostics are retained.
- `solve.repository-mode.run.lib.mjs` returns an explicit successful `noWork`
  state and creates no issue when the filtered selection is empty.
- `solve.mjs` maps that state to exit code 0 before the existing error branch.
- All four shipped locales and both the README and feature guide document the
  behavior.
- A patch changeset records the user-visible correction.

## Expected result

For `/solve https://github.com/link-assistant/router` when no open issues exist,
the English Telegram response is:

```text
ℹ️ Nothing to do

link-assistant/router has no open issues. No work session was started.
```

No combined issue is created, no queue slot is reserved, and no isolated work
session is started. If the same state is discovered inside `solve`, it emits an
informational log line and exits successfully.

## Verification

| Check                     | Result                                  |
| ------------------------- | --------------------------------------- |
| Focused issue #2266 suite | 9 passed, 0 failed                      |
| Repository-mode suite     | 47 passed, 0 failed                     |
| i18n suite                | 26 passed, 0 failed                     |
| Telegram UI i18n suite    | 5 passed, 0 failed                      |
| Full default suite        | 492 test files passed under npm 11.19.0 |

The focused coverage verifies empty responses, pull-request-only responses,
repositories with work, non-repository targets, the localized direct reply,
failure fallback, the before-queue Telegram wiring, exit-0 CLI wiring, and
every supported locale. Full project CI results are reported on PR #2269 and
are not copied into this immutable initial evidence snapshot.

The first full local run used the host's npm 12.0.2 and stopped at the existing
issue #2198 npm-link fixture: npm 12 now blocks the bare fixture's `prepare`
script, while the test intentionally asserts npm 11 behavior. The fixture
passed 11/11 under npm 11.19.0, and the complete default suite then passed all
492 selected files with that npm version on the subprocess path. No product
code or unrelated test expectation was changed to mask the environment drift.

## Residual risks and safeguards

- Repository contents can change at any moment. The duplicate CLI scan is
  deliberate: it prevents the Telegram preflight from becoming authoritative
  after its data is stale.
- If the preflight cannot query GitHub, the bot does not claim the repository
  is empty. It starts the established solve path, which produces the normal
  diagnostic log and failure status if the problem persists.
- The test runner injects deterministic GitHub responses; it does not depend
  on the current state of `link-assistant/router`.
- The expected-state screenshot is a visual review aid only. Assertions target
  the underlying translation and control flow rather than image pixels.
