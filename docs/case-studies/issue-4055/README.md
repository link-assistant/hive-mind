# Case study: false positives, false negatives, warnings and errors in CI/CD (issue #4055)

Issue: [#4055](https://github.com/link-assistant/hive-mind/issues/4055).
Implementation: [PR #4056](https://github.com/link-assistant/hive-mind/pull/4056).
Research date: 2026-11-13 UTC. Evidence: [`dev/log/issues/4055/pulls/4056`](../../../dev/log/issues/4055/pulls/4056/README.md).
Previous round: [issue #4050](../issue-4050/README.md) (PR #4051, merged 2026-11-13 00:10 as `f9ad62d`).

## Requirements

| #   | Requirement (issue text)                                                                 | Where it is addressed                                                    |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| R1  | Find and fix every false positive, false negative, warning and error in CI/CD            | Findings F1–F9, B1–B3 below                                              |
| R2  | Checks and release: failure (`f9ad62d`, run 43334992149)                                 | F1                                                                       |
| R3  | Every other run on `f9ad62d` and after it, including the green ones                      | F2–F6, B1–B3                                                             |
| R4  | Compare CI/CD with the js, python, rust and cpp templates; report the same defects there | [Template comparison](#template-comparison)                              |
| R5  | Follow `docs/CI-CD-BEST-PRACTICES.md`                                                    | Tests for every fix; principle 17 extended in 4 languages                |
| R6  | Collect logs into `dev/log/issues/4055/pulls/4056`; timeline; root causes; online facts  | This file and the evidence folder                                        |
| R7  | Debug output where data is missing (off by default); upstream reports with repro and fix | F1 `HIVE_CODEX_SQLITE_TRACE=1`; F7; F8; F9; [Upstream](#upstream)        |
| R8  | Apply each fix everywhere it applies; do everything in one pull request                  | F4 (four Dockerfiles), F5, F7 (5 probes), F8 (6 checks), F9 (both waits) |

## Timeline (UTC)

| When             | Event                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-22 14:37 | Dependabot opens group pull request #2285 (`@sentry/*` to 10.75.2). It stays open; every later daily Dependabot job logs `Deferring creation of a new pull request` and passes (F6).                              |
| 2026-11-09 05:58 | First failing Checks and release on `main` in this series (42570340658). From then on, no release succeeds, so no `konard/hive-mind:2.40.x` image is published.                                                   |
| 2026-11-11 19:39 | Six Formal AI drafts fail in one minute with `[DRAFT_IMAGE_UNAVAILABLE] Could not pull konard/hive-mind:2.40.0`. The 2.40.0 streak later reaches 9 runs.                                                          |
| 2026-11-12 17:54 | The first draft fails on `…:2.40.1`. The health check keys failures by exact text, so the 2.40.1 streak starts over at 1 and stays below the threshold of 5 (F2).                                                 |
| 2026-11-13 00:10 | PR #4051 merges as `f9ad62d`; Checks and release 43334992149 starts. `detect-changes` warns `library/rust 1.99 -> 1.100.0` for `Dockerfile.dind` and `Dockerfile.formal-ai` (F4).                                 |
| 2026-11-13 02:03 | Job `Verified native Codex package / Build and exercise linux-arm64` fails in the selected recovery scenario: `Canonical SQLite recovery requires closed database handles and no live native peers` (F1).         |
| 2026-11-13 02:03 | Pipeline Status fails; Release, Docker, DinD and Helm jobs are skipped. 2.40.1 is still unpublished.                                                                                                              |
| 2026-11-13 12:17 | Scheduled cleanup 43418490693 warns `1380 fixture branch(es) retained by a repository rule that prohibits deletion` (B1).                                                                                         |
| 2026-11-13 14:34 | Dependabot 43443919872 warns `Please check your configuration as there are groups where no dependencies match: - all-dependencies` for `docker_compose` (F5). All ten Dependabot jobs pass.                       |
| 2026-11-13 19:20 | Issue #4055 is opened.                                                                                                                                                                                            |
| 2026-11-13 19:23 | Formal AI draft 43491294883 for #4055 fails on `konard/hive-mind:2.40.1` (F3).                                                                                                                                    |
| 2026-11-13 19:44 | #2285 is closed with an explanation; a reproduction is added to dependabot-core#16791 (F6).                                                                                                                       |
| 2026-11-13 20:24 | This pull request's native experiment 43496638282 fails: the configuration lock probe's `rustc` exceeds its 30 s limit, and the job log says only `exit code 1` (F7). Attempt 2 passes the step in 14 s.          |
| 2026-11-13 21:33 | ESLint 10.15.0 is published. 11 minutes later this pull request's `detect-changes` (43513268777) fails the no-cooldown freshness gate, as designed; this pull request updates ESLint.                             |
| 2026-11-13 21:52 | Checks and release 43513684161, `test-suites`: `Router Agent live input stops the real native group on security refusal` fails in its cleanup hook with `reap all live fixture processes` (F8).                   |
| 2026-11-13 22:08 | `main` run 43493862530 (PR #4054) publishes the x64 and arm64 native Codex variants of 2.40.2 at 22:08:40 and 22:09:06. npm answers `Your package is being processed`. The main package follows at 22:09:13 (F9). |
| 2026-11-13 22:16 | npm finishes the main package (22:14:22) and the x64 variant (22:16:15). Docker jobs wait for the main package only and start building at 22:16:37.                                                               |
| 2026-11-13 22:24 | Docker Publish (linux/arm64) and DinD (linux/arm64) install 2.40.2 at 22:24:07 without the arm64 variant, and `install-native-codex.mjs` refuses. npm finishes that variant at 22:24:48 (F9).                     |

## Findings, root causes and fixes

### F1. Error: native SQLite recovery races a closing SQLx connection (linux-arm64)

- **Evidence.** Main run 43334992149, job 131589125538, log
  `native-release-sqlite-recovery-selected.log`:
  `failed to move damaged sqlite state database files into a backup folder: Canonical SQLite recovery requires closed database handles and no live native peers.`
  The linux-x64 job ran the same scenario and passed.
- **Root cause.** Codex recovery (`codex-rs/state/src/runtime/recovery.rs`, pinned at
  `6aaac694`) drops its pool and then starts the backup. SQLx closes a dropped
  connection asynchronously on its worker thread, so on a slower runner the
  close can land after `canonical_sqlite_vfs::backup` starts. The C adapter still
  saw this process's own `live_files` entry and refused immediately. It
  returned the same refusal for "our own handle is still closing" and "another
  process holds it", so the Rust side could not tell a transient state from a
  real conflict.
- **Fix** (`experiments/issue-3785/native-codex/canonical_sqlite_vfs.{c,rs}`):
  - The adapter reports the holder through `errno`: `EBUSY` for a handle in
    this process and `EWOULDBLOCK` for a live native peer.
  - The backup retries `SQLITE_BUSY` with exponential backoff (5 ms up to
    100 ms) for at most 5 s, then refuses with the holder and the time waited.
  - A peer still refuses at once, so the safety guarantee does not change.
  - `HIVE_CODEX_SQLITE_TRACE=1` prints each attempt. It is off by default.
  - `src/native-codex/recipe.json` and `source-files.json` carry the new digests.
- **Reproduction and test.** A new SQLx control, `rebuild-closing`, drops its
  connection 300 ms after recovery starts.
  - Before the fix it fails with exactly the CI error (`probe-sqlx-before.log.gz`).
  - After the fix all 50 SQLx controls and 1,034 VFS component controls pass.
  - The CI job `Native Codex auth adapter experiment` runs both suites.

### F2. False negative: draft health split one repeated failure by version

- **Evidence.** Draft runs from 2026-11-11 to 2026-11-13 failed in a row: 9 on
  `…:2.40.0`, then 3 on `…:2.40.1`. The scheduled health job 43463503145 passed.
  Replay: `experiment-draft-health-outcomes-1631.txt` ends with `streak: null`.
- **Root cause.** `normalizeErrorKey` in
  `scripts/formal-ai-draft-health.lib.mjs` masked ids and long numbers, but not
  release versions. `2.40.0` and `2.40.1` gave two keys, and neither streak
  reached the threshold of 5.
- **Fix.** Versions (`v?N.N[.N[.N]][-pre]`) are masked as `…`. The tracking-issue
  search uses the `[ERROR_CODE]` prefix when the error has one.
  `tests/formal-ai-draft-health-4055.test.mjs` replays the real sequence and
  finds a 12-run streak; it fails without the fix.

### F3. True positive: `DRAFT_IMAGE_UNAVAILABLE`

Each draft pulls the image of the version on `main`. 2.40.0 and 2.40.1 were
never published because every release since 2026-11-09 failed (issue #4050's
E413, then F1). The draft failures report a real problem. They stop once this
pull request's release publishes an image. No change.

### F4. Warning: stale Rust base image

`detect-changes` warned `library/rust 1.99 -> 1.100.0 (minor)` for
`Dockerfile.dind:34` and `Dockerfile.formal-ai:10`. The same pin also existed in
`Dockerfile` and `coolify/Dockerfile`. All four now use
`rust:1.100-slim-bookworm`. PR #4054 (`3b45f173c`) made the same change on
`main` while this pull request was open. After merging `main`, this pull
request has no Dockerfile diff left; F4 is fixed on `main`.

### F5. Warning: Dependabot `docker-compose` entry matched nothing

- **Evidence.** Dependabot run 43443919872 logged
  `Please check your configuration as there are groups where no dependencies match: - all-dependencies`.
- **Root cause.** The `docker-compose` entry covered `/` and `/coolify`, but every
  compose service there uses `build:`. With no registry image there is nothing
  to update, so the group is empty on every run.
- **Fix.** The entry is removed from `.github/dependabot.yml`.
  `tests/dependency-freshness-2264.test.mjs` parses both compose files: it
  requires `docker-compose` to be configured exactly when a service pulls a
  registry image, and requires one cooldown per ecosystem.

### F6. False negative: a stuck Dependabot pull request passed every day

- **Evidence.** #2285 was opened 2026-09-22 and was 52 days old. It bumped
  `@sentry/*` to 10.75.2 while `main` already had `^11.12.0`, was 1,471 commits
  behind, and its body held 37 unfinished "Dependabot is rebasing this PR"
  banners (26,808 characters, `pr-2285-body.md`).
  Every daily version job and `recreate` job logged
  `Detected existing pull request #… Deferring creation of a new pull request`
  and succeeded (`ci-logs/dependabot/`).
- **Root cause.** A Dependabot defect: with multi-ecosystem groups, an open group
  pull request blocks newer group updates, even when they supersede it
  (dependabot/dependabot-core#16791, related #12957). The run reports success,
  so nothing in CI noticed. #2285 could not have merged as it was either: its
  only CI run (35741671039, 2026-09-22) failed the dependency-freshness gate on
  unrelated stale packages (`ci-logs/pr2285-checks-35741671039.log.gz`).
- **Fix.**
  - `scripts/dependabot-health.mjs` runs daily from `.github/workflows/dependabot-health.yml`.
  - It fails with `::error title=Stuck Dependabot pull request::` when a Dependabot
    pull request is open more than 14 days or has more than 2 rebase banners.
  - `tests/dependabot-health-4055.test.mjs` uses #2285's real values.
  - The live check before the fix printed #2285 and exited 1 (`dependabot-health-before.txt`).
  - #2285 was closed with a comment so the next daily run can open a current one.

### F7. False negative: a 30 s compile limit failed a slow runner, with no message

- **Evidence.** This pull request's Native Codex auth adapter experiment,
  run 43496638282 attempt 1, job `native-file-authority`, step
  `Apply canonical request and SQLite operation admission`. The job log ends in
  `Process completed with exit code 1` and nothing else. The uploaded
  `native-sqlite-config-lock.log` holds
  `TimeoutExpired: Command '['rustc', … 'probe.rs' …]' timed out after 30 seconds`
  (`ci-logs/native-experiment-43496638282-*.log.gz`). Attempt 2 of the same
  commit passed the whole step in 14 s; on #4029's run the same tail took 9.5 s.
  Both runner images (20261101.360 and 20261111.370) ship Rust 1.99.1; only
  Rustup changed (1.29.2 to 1.29.3).
- **Root cause.** Five probe scripts limit compiles that normally take 7–10 s
  (a `rustc` probe; the 9 MB SQLite amalgamation at `-O0`, 7.0 s locally) to
  30 s, a 3× margin on shared runners. The limit exists to stop a hung compiler,
  not to measure speed. The probe captured the compiler's output and dropped it
  on timeout, and the workflow sends every probe's output to artifact files, so
  the failure had no message in the job log. The step also used the image's
  default `rustc` instead of the pinned toolchain the other steps use.
- **Fix.**
  - One `COMPILE_TIMEOUT = 120` in `probe-sqlite-config-lock.py`,
    `probe-sqlite-selected-vfs.py`, `benchmark-sqlite-selected-vfs.py`,
    `probe-sqlite-native-handles.py` and `probe-sqlite-vfs-close.py`.
    Run-time limits are unchanged; the 90-minute job limit still applies.
  - `probe-sqlite-config-lock.py` prints the elapsed time, `RUSTUP_TOOLCHAIN`
    and the compiler output when a build fails or times out.
  - The step sets `RUSTUP_TOOLCHAIN: '1.99.1'`.
  - Each of the experiment's three jobs prints the newest log, with an `::error`
    annotation naming it, when a step fails.

### F8. False positive: a stopped fixture process read as alive again

- **Evidence.** Checks and release 43513684161, job `test-suites`, test file
  233 (`tests/issue-3785-router-native-lifetime.test.mjs`):
  `✖ Router Agent live input stops the real native group on security refusal`,
  `AssertionError: reap all live fixture processes before deleting their state`,
  raised by the test's `after` hook (`ci-logs/release-43513684161-test-suites.log.gz`).
  The test body passed: its own check that both processes had stopped during
  logging succeeded. The whole file took 1.66 s, of which the other test took
  1.06 s, so the hook's 1 s wait loop ended at once: both PIDs read as stopped,
  and the very next synchronous read found one alive. The commit only changed
  ESLint, and the same test passed on this pull request's previous runs; 60
  local runs, half with every CPU busy, passed.
- **Root cause.** `isFixtureProcessAlive` treats every `/proc/<pid>/stat`
  state except `Z` as alive. The fixture's child is orphaned when the guard
  stops the group, so init reaps it asynchronously. While a reaper releases a
  zombie, the kernel shows it as `X (dead)` (`wait_task_zombie` sets
  `EXIT_DEAD` before `release_task` removes the `/proc` entry). The sequence
  `Z` then `X` reads as "stopped" then "alive". `experiments/issue-4055/proc-dead-state-window.py`
  reproduces the window with a subreaper thread that reaps like init:
  `X` appeared in 234 of 2,000 trials, 112 of them right after `Z`
  (`proc-dead-state-window.txt`). Commit `af61bf239` fixed a sibling race in
  the same helper (the entry vanishing during the read); production code
  already treats both states as exited (`src/queue-work.lib.mjs`: `/^[ZX]/`).
- **Fix.** `Z` and `X` both mean exited, in every `/proc/<pid>/stat` check
  that had only `Z`:
  - `experiments/issue-3785/process-liveness.mjs` (the failing helper, used by
    both Router native-lifetime probes);
  - `src/verify-agent-runtime.mjs` (`hasLiveProbeMembers`, which would wait
    on a released task);
  - `tests/issue-3785-runtime-process-cleanup.test.mjs`,
    `tests/issue-3785-runtime-version-cleanup.test.mjs`,
    `tests/issue-2613-regressions.test.mjs`;
  - `experiments/issue-3785/test_native_process_group.py`, which also no
    longer fails when the entry disappears between its existence check and read.
- **Test.** `tests/issue-3785-process-liveness.test.mjs` now covers `D` and
  `X`; with the old helper it fails with `actual: true, expected: false` for `X`.

### F9. Error: the release pinned a native Codex variant npm had not finished processing

- **Evidence.** `main` run 43493862530 (PR #4054) published 2.40.2, but
  `Docker Publish (linux/arm64)` and `Docker Publish DinD (linux/arm64)`
  failed at `install-native-codex.mjs` with `Native Codex installation failed.
Install the matching optional dependency
@link-assistant/hive-mind-native-codex-linux-arm64`. No 2.40.2 image exists
  for any platform, because the manifest job needs both. The arm64 build ran
  `bun install -g @link-assistant/hive-mind@2.40.2` at 22:24:07 and reported
  `190 packages installed`; the amd64 build reported 191 at 22:27:19.
  `npm view @link-assistant/hive-mind time` (`npm-time-2.40.2.txt`) shows when
  npm finished each version:

  | Version                           | Uploaded (Release job log) | Installable (npm `time`) |
  | --------------------------------- | -------------------------- | ------------------------ |
  | `2.40.2-native-codex-linux-x64`   | 22:08:40                   | 22:16:15                 |
  | `2.40.2-native-codex-linux-arm64` | 22:09:06                   | 22:24:48                 |
  | `2.40.2`                          | 22:09:13                   | 22:14:22                 |

- **Root cause.** npm processes a large tarball asynchronously: each 120 MB
  variant upload ended with `npm notice Your package is being processed and may
take a few minutes to become available`, and the arm64 one took 15m42s. The
  publish command pinned both variants and published the main package at once.
  `wait-for-npm.mjs` then checked only the main package, which was installable
  at 22:16:37, so the Docker jobs started. Bun, like npm, skips an optional
  dependency it cannot resolve without an error, so the arm64 image had no
  variant. The amd64 image built later, after both variants had landed. A
  cross-install of the same version after 22:24:48 (`bun install -g --cpu arm64
--os linux`) installs the arm64 alias. This is a race, so the earlier
  releases that published variants did not hit it.
- **Fix.** The wait now happens at both layers:
  - `scripts/native-codex-packages.mjs publish` publishes the variants, then
    waits until each one answers `npm view <spec> dist.tarball` and the tarball
    answers HEAD (`scripts/npm-installable.lib.mjs`). Only then does it pin the
    variants and let `changeset publish` publish the main package. The budget is
    66 checks with backoff from 5 s to 30 s, about 32 minutes, twice the slowest
    variant seen. On timeout it prints `::error title=native Codex variant not
installable::` and the main package is not published. The failure is
    non-retryable in `publishWithRetry`, because three 32-minute waits do not
    fit the job; a rerun skips the variants that landed.
  - `scripts/wait-for-npm.mjs`, which the Docker and DinD publish jobs run, also reads
    the optional dependencies of the published version and waits for every
    variant it pins through an `npm:@link-assistant/hive-mind@…` alias.
  - The release and instant-release timeouts rise from 45 to 75 minutes:
    32 minutes of variant wait, 25 minutes of post-publish verification
    (#2923), and about 6 minutes of setup and uploads.
  - Both Dockerfiles run `install-native-codex.mjs` with
    `HIVE_MIND_NATIVE_CODEX_DEBUG=1`. It prints nothing extra on success; on a
    refusal it names the admission phase and the error code (`MODULE_NOT_FOUND`
    here), which the failed builds lacked.
- **Test.** `tests/native-codex-variant-installable-4055.test.mjs` replays the
  2.40.2 registry timings: the publish command returns only after the arm64
  variant is installable. Other cases cover a variant that never lands (one
  annotated, non-retryable failure), the publish order, the timeout budgets,
  a visible version whose tarball still returns 404, and the variants
  `wait-for-npm.mjs` derives from the real 2.40.2 `optionalDependencies`. It
  fails before the fix, which has no `awaitInstallableVariants`.
- **2.40.2 images.** The fix applies from the next release. Rerunning the two
  failed jobs of run 43493862530 would publish the 2.40.2 images now that
  both variants are installable. That is a publication, so it is left to a
  maintainer.

### Blocked or external, not changed

| #   | Item                                                                               | Why                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Cleanup warns that 1,380 fixture branches are retained                             | **Blocked: needs a repository admin.** Ruleset 21204104 forbids deleting them. The warning already names the fix: a ruleset exclusion or a bypass for the cleanup token. Issue #2625 made this a warning on purpose, because failing daily on a rule no commit can change is a false negative. |
| B2  | `The ubuntu-latest label will migrate to Ubuntu 26` notice on every Dependabot job | GitHub-managed dynamic workflow; this repository cannot choose its runner.                                                                                                                                                                                                                     |
| B3  | E2E Hello World Matrix: `prepare` and the matrix skipped                           | By design: it runs only when `vars.ENABLE_REAL_GITHUB_E2E` is set.                                                                                                                                                                                                                             |

The other `WARN` and `deprecated` lines in the test logs were checked one by
one. They are test names or assertions about warnings, such as
`[WARN] /merge-queue: …` from the merge-queue tests, and need no change
(`warnings-summary.txt`).

## Template comparison

Checks a–d compare this issue's findings with each template's `main`
(tarballs and logs from 2026-11-13).

| Template | Same defect?                                                                                                                                                                                                                                                   | Action                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| python   | F6: yes. Dependabot pull request #135 (open since 2026-11-02) cannot pass, because tests hard-code `actions/cache/restore@v5` and `zizmor-action@v0.6.4`. No job reports a stuck bot pull request.                                                             | [python-template#149](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/149) |
| cpp      | F6: yes. Every Dependabot pull request fails `Changelog Fragment Check`, and #26 also fails `Unaudited workflow tool: zizmor==1.31.1`, because the workflow pins zizmor a second time where Dependabot does not look. No job reports a stuck bot pull request. | [cpp-template#28](https://github.com/link-foundation/cpp-ai-driven-development-pipeline-template/issues/28)         |
| rust     | F4: yes. `examples/javascript-first/Dockerfile` pins `rust:1.96.0-slim` while 1.100.0 is current. There is no `dependabot.yml` and no freshness check to report it.                                                                                            | [rust-template#239](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/239)     |
| js       | No. It has no `dependabot.yml`, and its only Dockerfile is `FROM scratch`.                                                                                                                                                                                     | None                                                                                                                |

- F5: no template configures `docker-compose`, and none has a compose file.
- F2: no template builds a repeated-failure key from error text. The nearest
  code, `js/scripts/publish-failure-classifier.mjs`, only classifies.
- F1: hive-mind only.
- F9: no template publishes platform variants as optional dependencies. The js
  template's `wait-for-npm` pattern waits for the one package it publishes.
- F7: no template bounds a compile with a tight time limit. cpp's test preset
  allows 120 s, and python's `scripts/run-with-budget-warning.sh` warns before a
  command reaches its limit.

Each template's own failing `main` run is a missing setting that needs the
owner. Each already fails with a message that says what to do, so they are not
false negatives and were not reported again:

- js 43336120258: `NPM_TOKEN` for the first publish of the placeholder package.
- python 43399178991: a PyPI trusted publisher for `release.yml`.
- rust 43401886267: GitHub Pages is not enabled (`Get Pages site failed`).
- cpp 42646929941: `CONAN_AUDIT_PROVIDER_TOKEN_CONANCENTER`. The only warning
  is CodeQL's overlay-base notice for `build-mode: manual`.

## Upstream

- Dependabot: reproduction, workaround and fix suggestion added to
  [dependabot/dependabot-core#16791](https://github.com/dependabot/dependabot-core/issues/16791#issuecomment-6863150915).
  The body is in `dev/log/issues/4055/pulls/4056/upstream/`.
- SQLx and Codex: nothing to report. SQLx documents asynchronous close, and
  upstream Codex recovery renames files and tolerates open handles. The race
  only exists with this repository's selected VFS, which is fixed here.

## Sources

- Dependabot multi-ecosystem groups: <https://docs.github.com/en/code-security/dependabot/working-with-dependabot/configuring-multi-ecosystem-updates>
- Dependabot defect: <https://github.com/dependabot/dependabot-core/issues/16791>, <https://github.com/dependabot/dependabot-core/issues/12957>
- SQLx SQLite connections run on a worker thread that closes the handle when it handles `Command::Shutdown`, after the caller has moved on: <https://github.com/launchbadge/sqlx/blob/main/sqlx-sqlite/src/connection/worker.rs>; `PoolConnection`: <https://docs.rs/sqlx-core/latest/sqlx_core/pool/struct.PoolConnection.html>
- Linux task states in `/proc/<pid>/stat` (`X (dead)`, `Z (zombie)`): <https://github.com/torvalds/linux/blob/master/fs/proc/array.c>; `wait_task_zombie` moves `EXIT_ZOMBIE` to `EXIT_DEAD` before `release_task`: <https://github.com/torvalds/linux/blob/master/kernel/exit.c>; `proc_pid_stat(5)`: <https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html>
- npm processes large packages asynchronously (`Your package is being processed and may take a few minutes to become available`, printed by `libnpmpublish`); npm and Bun skip optional dependencies that fail to install: <https://docs.npmjs.com/cli/v11/configuring-npm/package-json#optionaldependencies>, <https://bun.sh/docs/cli/install>
- SQLite VFS and `SQLITE_BUSY`: <https://www.sqlite.org/c3ref/vfs.html>, <https://www.sqlite.org/rescode.html#busy>

## Verification

- `node tests/formal-ai-draft-health-4055.test.mjs`, `node tests/dependabot-health-4055.test.mjs` and `node tests/dependency-freshness-2264.test.mjs` pass.
- `python3 experiments/issue-3785/probe-sqlx-selected-vfs.py`: 50 cases pass after the fix; `rebuild-closing` fails before it.
- `probe-sqlite-selected-vfs`: 1,034 cases pass.
- PR #4056 CI on `ace5632`: Checks and release 43496638615 passed, including
  `Build and exercise linux-arm64`, where the selected recovery scenario now
  reports `actualNativeRecovery: true` (F1). Security, Workflows and Broken Link
  Checker passed. The Native Codex auth adapter experiment failed on attempt 1
  (F7) and passed on attempt 2.
- `probe-sqlite-selected-vfs.py` with the 120 s compile limit: 1,034 cases pass
  locally; actionlint 1.7.12 (with shellcheck) passes on the experiment workflow.
- F8: `tests/issue-3785-process-liveness.test.mjs` fails before the fix and
  passes after it; the Router native-lifetime, runtime process and version
  cleanup and #2613 regression tests and `test_native_process_group.py` pass.
- ESLint 10.15.0: `node scripts/check-dependency-freshness.mjs` reports all
  declarations current; `tests/test-issue-2187-current-dependency-pins.mjs`
  passes with the updated pin.
- F9: `tests/native-codex-variant-installable-4055.test.mjs`,
  `tests/native-codex-packages-4050.test.mjs`,
  `tests/publish-verification-window-2923.test.mjs`,
  `tests/test-publish-failure-classifier-2028.mjs` and
  `tests/test-docker-release-order.mjs` pass.
  `node scripts/wait-for-npm.mjs --release-version 2.40.2 --max-attempts 2 --sleep-time 1`
  against the live registry finds the main package and both pinned variants
  installable and exits 0.
