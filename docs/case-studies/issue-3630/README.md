# Case study: real E2E tasks piled up as open issues (issue #3630)

- Issue: https://github.com/link-assistant/hive-mind/issues/3630
- Pull request: https://github.com/link-assistant/hive-mind/pull/3631
- Affected repository: [link-assistant/formal-ai](https://github.com/link-assistant/formal-ai), where 78 open `e2e-task` issues were counted on 2026-10-21. One example is [formal-ai#1391](https://github.com/link-assistant/formal-ai/issues/1391).
- Earlier work: #2324 (stale fixture cleanup) and #3332 (workflow push rejection).
- Related Formal AI work: [issue 1364](https://github.com/link-assistant/formal-ai/issues/1364) and [PR 1329](https://github.com/link-assistant/formal-ai/pull/1329).

## Collected data

| File                                                               | What it is                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`formal-ai-sweep-dry-run.log`](./formal-ai-sweep-dry-run.log)     | A read-only dry run of the new sweep against formal-ai: every issue it would finalize, and the proof it found                          |
| [`tests/fixtures/e2e-replay/`](../../../tests/fixtures/e2e-replay) | Redacted replays derived from the four rows of run [39505806192](https://github.com/link-assistant/hive-mind/actions/runs/39505806192) |

## Timeline

| When                 | Event                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| up to 2026-10-21     | Formal AI's "Actual Hive … original delivery" jobs run the Hello World E2E for claude, codex and agent on many pushes. Each job opens one task issue and usually one PR. |
| 2026-10-21           | 78 open issues carry `e2e-task` and `no-formal-ai-draft`, and they hide the feature issues. Issue #3630 is filed.                                                        |
| 2026-10-21 (this PR) | 58 `e2e-task` issues are still open. The sweep dry run proves custody for 68 open task issues or PRs and preserves none, because each one is owned by a finished run.    |

## Root cause

1. **Formal AI runs an old harness with `--keep`.**
   - [`hive-original-delivery.yml`](https://github.com/link-assistant/formal-ai/blob/main/.github/workflows/hive-original-delivery.yml) checks out hive-mind at a pinned commit. Line 67 has `ref: 8f22b87c515adece0427cb59e429531f35d7760a`.
   - Line 130 then runs `node scripts/e2e-hello-world.mjs --tool "$E2E_TOOL" --model formal-ai --isolation branch --keep`.
   - `--keep` skips cleanup, and nothing else ever closes the task. Each push therefore leaves up to three open issues and PRs.
2. **The task had no custody.**
   - An issue never recorded which workflow, run, attempt and task owned it.
   - Without that record, a later sweep could only guess from the title, age or labels, and the issue forbids that.
   - The old cleanup deleted fixture branches but never closed issues.
3. **The real E2E had no gate, no ledger and no bound.**
   - In Hive Mind, the real matrix ran on its own triggers rather than after the other checks.
   - A rerun repeated rows that had already passed, which created new tasks every time.
   - A main merge could run the same source more than once, or not at all.
4. **The evidence could not be replayed.**
   - result.json recorded the verdicts but not the delivered files, the comments or the exit status of each command.
   - So a failure could not be reproduced offline. For example, the codex row of run 39505806192 failed on two oracle bugs, which were fixed in 320e0a21e.

## Design

### Custody and finalization: `scripts/e2e-task-lifecycle.lib.mjs`

**Custody marker.** Every task issue and fixture PR carries a `<!-- hive-mind:e2e-custody … -->` marker with:

- the task repository, the source repository and the workflow ref;
- the run ID and run attempt;
- the task (`<tool>-<model>`) and its fixture base branch;
- the source SHA.

The custody key is `repository/runId/runAttempt/task`.

**The finalize step** is the matrix step "Finalize the task with its outcome", which has `if: always()`:

- It derives the outcome from the evidence and the job status. The possible outcomes are `passed`, `failed`, `harness-failed`, `cancelled` and `interrupted`.
- It posts one outcome comment per custody key, with a `hive-mind:e2e-finalized` marker, the run link and the artifact name.
- It closes the PR. It closes the issue as `completed` when the row passed and as `not planned` otherwise.
- Running it again finds the marker and only completes whatever is still open. This makes interrupted cleanup recoverable. The test "interrupted cleanup" covers this.

**The sweep** (`scripts/cleanup-task-fixtures.mjs`, from `cleanup-test-repos.yml`) finalizes an issue only when it has proof of custody:

- a custody marker;
- a PR from an owned fixture branch `e2e/hello-world/<run>/<task>`;
- or a log line from the owning job that names the issue.

It also requires that the owning run has finished. The owning job's conclusion gives the outcome. It preserves an issue whose run is still active, and any issue it cannot prove. Title, age and labels are never enough. The repository variable `E2E_CLEANUP_REPOSITORIES` (passed as `CLEANUP_REPOSITORIES`) lets the sweep cover formal-ai. `CLEANUP_DRY_RUN=true` only reports.

**Fixture creation acts as a lock.** The fixture branch ref is created before the issue. A second invocation with the same custody therefore fails to create the ref and adopts the existing task instead of opening a new one. Two tests cover this: "repeated invocation…" and "concurrent fixture creation…".

### Gate, ledger, reuse and bounds: `release.yml`, `e2e-hello-world-matrix.yml` and `scripts/e2e-plan.lib.mjs`

**The gate.** The `real-e2e` job in `release.yml` calls the matrix with `scope: pull-request`.

- It `needs` every other PR check: detect-changes, version-check, changeset-check, test-compilation, lint, check-file-line-limits, test-suites, test-execution, memory-check-linux, validate-docs, docker-pr-check, helm-pr-check and release-preflight.
- It runs only when none of them failed or was cancelled.
- `pipeline-status` needs `real-e2e`.
- `tests/e2e-gate-3630.test.mjs` parses the workflow so that a newly added check cannot slip past the gate.

**The ledger.** After each row, the matrix uploads a ledger record named `e2e-ledger-<scope key>-<tool>-<model>-a<attempt>`. The scope key is `pr<N>`, `main-<sha12>` or `run-<id>`.

**The plan.** The `prepare` job reads the ledger by exact artifact name and plans each row:

- **Pull requests** reuse a recorded pass of the same Formal AI version from any earlier commit of the PR. The reused record keeps the original run, attempt and source SHA, even when a reuse is itself reused.
- **Retries** apply only to failed rows, with at most `E2E_MAX_ATTEMPTS = 3` per source. The ledger looks back `LEDGER_RUN_ATTEMPTS = 6` attempts.
- **Main** runs once per merged source through `workflow_run` of "Checks and release". A repeated event for the same SHA is a no-op.
- **Schedules and dispatches** always run every row.

**Concurrency.** The group is `e2e-hello-world-<scope>-<PR or SHA or run>` with `cancel-in-progress: false`. Repeated events for one source queue up instead of racing or cancelling a running task.

### Evidence: `scripts/e2e-evidence.lib.mjs` and `scripts/e2e-row.lib.mjs`

Every attempt writes the following files:

| File            | What it holds                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands.json` | Every command, with its redacted argv, start and finish times, exit code and signal, and its byte and kept-byte counts. A command that never finished is marked `truncated` or `interrupted`. |
| `identity.json` | The source and binary identities of what was tested.                                                                                                                                          |
| `custody.json`  | The task's custody record.                                                                                                                                                                    |
| `delivery.json` | The PR, its files with their patches (64 KB per file; session logs excluded), the checks and the comments.                                                                                    |
| `manifest.json` | The size and sha256 of every file, plus the expected files that are `missing`.                                                                                                                |

The evidence artifact is uploaded for every attempt, including failed and cancelled ones.

### Replays: `scripts/e2e-replay.lib.mjs`, `scripts/e2e-derive-replay.mjs` and `tests/github-emulator.mjs`

**Deriving a fixture.** Evidence becomes a fixture through these steps:

- The delivered files are rebuilt from their patches. A file that cannot be rebuilt gets a placeholder and is listed under `placeholders`.
- The session log keeps its head, its tail and every line an oracle reads. A truncation marker states how many bytes were omitted.
- The act log is kept.
- The recorded verdicts are kept.
- Missing and truncated evidence is listed.
- Every string passes through `redactForFixture`. It removes:
  - the values of secret-looking environment variables;
  - token shapes and private keys;
  - personal email addresses (bot, no-reply and `git@host` addresses are kept);
  - home directories.

**Running a replay.** The replay test runs the production `runE2eRow` and `finalizeAndRecord` against the GitHub emulator. The emulator plays the recorded session through the production adapters, and the same oracles judge the result.

**Comparing verdicts.**

- The verdicts must equal the recorded ones.
- The only exceptions are oracles fixed after the recording. These are listed with the commit that fixed them in `ORACLE_CHANGES`.
- A round-trip test derives a fixture from a fresh emulated run and requires identical verdicts.

**Tripwire.** `installRealGitHubTripwire` replaces `gh`, `git`, `docker`, `act`, `curl`, `wget` and `fetch` during the tests. Every test asserts that none of them was reached. A positive control proves that the tripwire fires.

To derive the fixtures for a run again:

```bash
mkdir /tmp/e2e-art && gh run download <run id> --repo link-assistant/hive-mind --dir /tmp/e2e-art
# Only for runs recorded before delivery.json existed (read-only GETs):
node experiments/issue-3630/backfill-delivery.mjs /tmp/e2e-art /tmp/e2e-backfill
node scripts/e2e-derive-replay.mjs --run /tmp/e2e-art --delivery-dir /tmp/e2e-backfill --out tests/fixtures/e2e-replay
```

## Verification

| Requirement                                                                                          | Evidence                                                                                           |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| An emulated lifecycle matrix: success, failure, cancel, interrupted cleanup and repeated events      | `tests/e2e-task-lifecycle-3630.test.mjs` (13 tests)                                                |
| No real GitHub tasks are created                                                                     | The tripwire, its positive control, and an `afterEach` assertion in the lifecycle and replay tests |
| Real E2E runs only after the other checks; PR passes are reused; retries are bounded; main runs once | `tests/e2e-gate-3630.test.mjs` and `tests/e2e-plan-3630.test.mjs`                                  |
| Evidence is complete, with missing and truncated markers, and is redacted                            | `tests/e2e-evidence-3630.test.mjs`                                                                 |
| Replays are deterministic and use the same oracles                                                   | `tests/e2e-replay-3630.test.mjs` and `tests/e2e-oracles-3630.test.mjs`                             |
| One live three-client run after all other checks, with its issues closed                             | The `real-e2e` job on PR 3631. The run links and closed issues are listed in the PR description.   |

## Limitations

- **Concurrency is tested only in emulation.** Two truly concurrent invocations with the same custody are serialized by the concurrency group and the ref lock. Both are tested in the emulator but were not provoked live.
- **Some PRs skip the gate:**
  - Docs-only PRs, through `detect-changes`.
  - Fork PRs, which have no token that can create tasks.
- **The backfilled fixtures are incomplete.** Run 39505806192 predates `commands.json` and `delivery.json`, so its fixtures state both as missing.
  - Their deliveries were backfilled read-only from the REST API.
  - Their session files are placeholders, because session logs carry no patch.
- **90 fixture branches in formal-ai remain.** They are retained by a ruleset that forbids deleting branches, and the sweep reports them. Removing them needs a ruleset exclusion or a bypass for the cleanup token.
- **The formal-ai issues are still open.** The formal-ai `e2e-task` issues are finalized only once `cleanup-test-repos.yml` runs with `E2E_CLEANUP_REPOSITORIES=link-assistant/formal-ai` and without `dry_run`. That is an outward-facing action, and it waits for maintainer approval.

## Follow-up outside this repository

Formal AI's `hive-original-delivery.yml` needs three changes:

- bump its pinned hive-mind commit;
- drop `--keep`, or add the finalize step (`node scripts/e2e-finalize.mjs`);
- pass the custody environment.

Until then, its new tasks have no custody marker, and the sweep's job-log proof is what finalizes them. This belongs with the Formal AI work in issue 1364 and PR 1329 linked above.
