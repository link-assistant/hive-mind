# Validation record

## Reproduction

`node --test tests/codex-process-exit-2745.test.mjs` failed all 11 original assertions before the production change. The fake process emitted a started thread/turn and exit 137 without a structured error. Hive Mind returned no exit code, no signal and no failure cause; `isToolProcessKilled` consequently could not recognize the kill. The replay also confirmed missing plain-stderr details and process metadata on structured failures/successes.

The final focused run passes 17 tests across `codex-process-exit-2745.test.mjs` and `codex-process-diagnostics.test.mjs`: incident replay; signal-only exit; fresh/stale/reset/unreadable/unidentified/different-cgroup counters; absent cgroup; split/unterminated stderr; ignored telemetry echoes; structured error priority; completed-turn success; echoed usage-limit guard; finite budget guidance; normal exit/signal mapping; bounded diagnostic text; and the extracted final-message reader's missing-file, normal-file and 1 MiB cap behavior.

The independent signal probe immediately terminates only its own three finite shell processes. Hive Mind's actual command-stream invocation shape reports TERM as 143, KILL as 137 and an ordinary failure as 3. No deliberate stack/memory exhaustion experiment was run.

## Local checks

Logs are retained under `data/validation/` after checks finish. The default suite initially stopped at `tests/extracted-modules-2198.test.mjs`: the adapter grew above the repository's 1,350-line warning boundary. Extracting the unchanged bounded last-message read restored the boundary; the focused boundary test passes.

The next full run completed 579 files and found one fixture mismatch: the existing cancellation probe compared its input verbatim, including host-dependent cgroup guidance added by this change. Its real shell was successfully terminated; the prompt equality alone failed. The probe now injects an absent cgroup so its cancellation/input assertions remain deterministic, while the new adapter replay verifies budget prompt composition separately. A combined recheck passes all 42 tests (25 existing automation checks and 17 new diagnostics checks). The final default run passes all 580 files, including the additional unit-test file, on Node.js 26.11.0; the existing CI suite uses Node.js 24.

Both GitHub integration files pass, including live template inventory and [the feedback fixture](https://github.com/link-assistant/hive-mind/pull/2760). The fixture PR was closed by the existing test cleanup. Two disposable branches were retained by the existing repository deletion rule; the integration log records their names and scheduled-cleanup behavior. No repository rule was bypassed.

ESLint, formatting, duplication, secret scanning, syntax, line limits, documentation/language checks, Changeset status and memory smoke checks pass. Authenticated dependency freshness reports 168/168 declarations current. The first Changeset status attempt occurred before the new file was staged and reported no Changeset; after staging, it correctly reports a patch bump for `@link-assistant/hive-mind`.

The exact PR Changeset validator initially counted the previous release's Changeset as a second addition because main had released 2.34.2 after the first merge. Merging that release removed its consumed Changeset; the same validator now finds exactly one added patch Changeset and passes against `c2089953a2b1977f32768ab357bd9d88507cb799`.

## CI freshness and publication

The initial prepared head was `3b89fdd80cb211b17a8731ce27f16d8ac7ad6bd4`. The newest Checks and release, Security and Broken Link Checker runs for that head passed. An older Security event at the same SHA was `action_required`, followed by a successful Security event; requesting its log returned `log not found`. This is historical event approval, not an observed implementation test failure.

The default branch is merged into the issue branch with forward merge commits, including the automatic 2.34.2 release. Final-head CI is checked against the published commit SHA and run timestamps; outcomes and run links are recorded in [PR #2746](https://github.com/link-assistant/hive-mind/pull/2746). Local archives distinguish the pre-fix regression, intermediate failures and final passing runs rather than replacing the failure evidence.

All four workflows passed on implementation commit `ed3cd5091af3e28a26344ceca518dbcaca1f63db`, committed at 09:05:54 UTC on 2026-10-08. Each run below started afterward and reports that exact head SHA. Workflows was dispatched in its existing checks-only mode to also verify actionlint and zizmor.

| Workflow            | Run                                                                                 | Created (UTC) | Result  |
| ------------------- | ----------------------------------------------------------------------------------- | ------------- | ------- |
| Checks and release  | [37754387105](https://github.com/link-assistant/hive-mind/actions/runs/37754387105) | 09:06:49      | Success |
| Security            | [37754386831](https://github.com/link-assistant/hive-mind/actions/runs/37754386831) | 09:06:49      | Success |
| Broken Link Checker | [37754386800](https://github.com/link-assistant/hive-mind/actions/runs/37754386800) | 09:06:49      | Success |
| Workflows           | [37754600406](https://github.com/link-assistant/hive-mind/actions/runs/37754600406) | 09:08:39      | Success |

The complete workflow logs are archived under `data/validation/`, with run metadata in `data/implementation-ci-runs.json` and individual check outcomes in `data/implementation-ci-checks.json`. Checks and release confirms all 580 default test files and both GitHub integration files pass on Node.js 24; its final status reports no failed or cancelled jobs. These archives cover the implementation; the final documentation commit's checks are verified separately and recorded in the PR.
