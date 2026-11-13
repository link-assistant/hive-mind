# Case study: false positives, false negatives, warnings and errors in CI/CD (issue #4055)

Issue: [#4055](https://github.com/link-assistant/hive-mind/issues/4055).
Implementation: [PR #4056](https://github.com/link-assistant/hive-mind/pull/4056).
Research date: 2026-11-13 UTC. Evidence: [`dev/log/issues/4055/pulls/4056`](../../../dev/log/issues/4055/pulls/4056/README.md).
Previous round: [issue #4050](../issue-4050/README.md) (PR #4051, merged 2026-11-13 00:10 as `f9ad62d`).

## Requirements

| #   | Requirement (issue text)                                                                 | Where it is addressed                                     |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| R1  | Find and fix every false positive, false negative, warning and error in CI/CD            | Findings F1–F6, B1–B3 below                               |
| R2  | Checks and release: failure (`f9ad62d`, run 43334992149)                                 | F1                                                        |
| R3  | Every other run on `f9ad62d` and after it, including the green ones                      | F2–F6, B1–B3                                              |
| R4  | Compare CI/CD with the js, python, rust and cpp templates; report the same defects there | [Template comparison](#template-comparison)               |
| R5  | Follow `docs/CI-CD-BEST-PRACTICES.md`                                                    | Tests for every fix; principle 17 extended in 4 languages |
| R6  | Collect logs into `dev/log/issues/4055/pulls/4056`; timeline; root causes; online facts  | This file and the evidence folder                         |
| R7  | Debug output where data is missing (off by default); upstream reports with repro and fix | F1 `HIVE_CODEX_SQLITE_TRACE=1`; [Upstream](#upstream)     |
| R8  | Apply each fix everywhere it applies; do everything in one pull request                  | F4 (all four Dockerfiles), F5 (both compose directories)  |

## Timeline (UTC)

| When             | Event                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-22 14:37 | Dependabot opens group pull request #2285 (`@sentry/*` to 10.75.2). It stays open; every later daily Dependabot job logs `Deferring creation of a new pull request` and passes (F6).                      |
| 2026-11-09 05:58 | First failing Checks and release on `main` in this series (42570340658). From then on, no release succeeds, so no `konard/hive-mind:2.40.x` image is published.                                           |
| 2026-11-11 19:39 | Six Formal AI drafts fail in one minute with `[DRAFT_IMAGE_UNAVAILABLE] Could not pull konard/hive-mind:2.40.0`. The 2.40.0 streak later reaches 9 runs.                                                  |
| 2026-11-12 17:54 | The first draft fails on `…:2.40.1`. The health check keys failures by exact text, so the 2.40.1 streak starts over at 1 and stays below the threshold of 5 (F2).                                         |
| 2026-11-13 00:10 | PR #4051 merges as `f9ad62d`; Checks and release 43334992149 starts. `detect-changes` warns `library/rust 1.99 -> 1.100.0` for `Dockerfile.dind` and `Dockerfile.formal-ai` (F4).                         |
| 2026-11-13 02:03 | Job `Verified native Codex package / Build and exercise linux-arm64` fails in the selected recovery scenario: `Canonical SQLite recovery requires closed database handles and no live native peers` (F1). |
| 2026-11-13 02:03 | Pipeline Status fails; Release, Docker, DinD and Helm jobs are skipped. 2.40.1 is still unpublished.                                                                                                      |
| 2026-11-13 12:17 | Scheduled cleanup 43418490693 warns `1380 fixture branch(es) retained by a repository rule that prohibits deletion` (B1).                                                                                 |
| 2026-11-13 14:34 | Dependabot 43443919872 warns `Please check your configuration as there are groups where no dependencies match: - all-dependencies` for `docker_compose` (F5). All ten Dependabot jobs pass.               |
| 2026-11-13 19:20 | Issue #4055 is opened.                                                                                                                                                                                    |
| 2026-11-13 19:23 | Formal AI draft 43491294883 for #4055 fails on `konard/hive-mind:2.40.1` (F3).                                                                                                                            |
| 2026-11-13 19:44 | #2285 is closed with an explanation; a reproduction is added to dependabot-core#16791 (F6).                                                                                                               |

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
`rust:1.100-slim-bookworm`.

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
  so nothing in CI noticed.
- **Fix.**
  - `scripts/dependabot-health.mjs` runs daily from `.github/workflows/dependabot-health.yml`.
  - It fails with `::error title=Stuck Dependabot pull request::` when a Dependabot
    pull request is open more than 14 days or has more than 2 rebase banners.
  - `tests/dependabot-health-4055.test.mjs` uses #2285's real values.
  - The live check before the fix printed #2285 and exited 1 (`dependabot-health-before.txt`).
  - #2285 was closed with a comment so the next daily run can open a current one.

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

TEMPLATE_COMPARISON

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
- SQLite VFS and `SQLITE_BUSY`: <https://www.sqlite.org/c3ref/vfs.html>, <https://www.sqlite.org/rescode.html#busy>

## Verification

- `node tests/formal-ai-draft-health-4055.test.mjs`, `node tests/dependabot-health-4055.test.mjs` and `node tests/dependency-freshness-2264.test.mjs` pass.
- `python3 experiments/issue-3785/probe-sqlx-selected-vfs.py`: 50 cases pass after the fix; `rebuild-closing` fails before it.
- `probe-sqlite-selected-vfs`: 1,034 cases pass.
- PR #4056 CI: Checks and release, Native Codex auth adapter experiment, Security, Workflows and Broken Link Checker.
