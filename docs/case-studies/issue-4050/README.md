# Case study: false positives, false negatives, warnings and errors in CI/CD (issue #4050)

Issue: [#4050](https://github.com/link-assistant/hive-mind/issues/4050).
Implementation: [PR #4051](https://github.com/link-assistant/hive-mind/pull/4051).
Research date: 2026-11-12 UTC. Evidence: [`dev/log/issues/4050/pulls/4051`](../../../dev/log/issues/4050/pulls/4051/README.md).
Previous round: [issue #4029](../issue-4029/README.md) (PR #4030, merged 2026-11-10 11:11 as `bcb289b`).

## Requirements

| #   | Requirement (issue text)                                                                 | Where it is addressed                                    |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R1  | Find and fix every false positive, false negative, warning and error in CI/CD            | Findings F1–F9 below                                     |
| R2  | Checks and release: failure (`2f20280`, run 43242624306)                                 | F1, F2, F3                                               |
| R3  | Formal AI Draft: failure (`2f20280`, run 43263266558)                                    | F4 (true positive caused by F1), F5                      |
| R4  | E2E Hello World Matrix: skipped (`d225236`, run 43271477613)                             | F7: skipped by design, no change                         |
| R5  | Compare CI/CD with the js, python, rust and cpp templates; report the same defects there | [Template comparison](#template-comparison)              |
| R6  | Follow `docs/CI-CD-BEST-PRACTICES.md`                                                    | Fail-fast gates, annotations, tests; principle 16 update |
| R7  | Collect logs into `dev/log/issues/4050/pulls/4051`; timeline; root causes; online facts  | This file and the evidence folder                        |
| R8  | Debug output where data is missing (off by default); upstream reports with repro and fix | F1, F3, F9 debug switches; [Upstream](#upstream)         |

## Timeline (UTC)

| When             | Event                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-09 11:25 | PR #3786 (issue #3785) merges: the npm package now carries verified native Codex executables for linux-x64 and linux-arm64 in `src/native-codex/runtime`.                                    |
| 2026-11-10 11:11 | PR #4030 merges as `bcb289b`. Release 42805396999 builds and verifies both executables, then `changeset publish` of 2.40.0 (249,847,872-byte tarball) gets `E413` three times.               |
| 2026-11-12 14:57 | PR #3741 merges as `2f20280`. Checks and release 43242624306 passes every build and test job (native Codex builds took 87 and 107 minutes).                                                  |
| 2026-11-12 16:51 | Scheduled Formal AI Draft 43263266558: `health` fails, "The last 9 draft runs failed with the same first error: [DRAFT_IMAGE_UNAVAILABLE] Could not pull konard/hive-mind:2.40.0".           |
| 2026-11-12 17:32 | Release job: "Publish attempt 1 of 3...", about 87 s of upload, `└ E413: 413 Payload Too Large - PUT https://registry.npmjs.org/@link-assistant%2fhive-mind`. Attempts 2 and 3 are the same. |
| 2026-11-12 17:37 | "Failed to publish @link-assistant/hive-mind@2.40.1: exit code 1". Docker, DinD and Helm release jobs are skipped; Pipeline Status fails with only "Process completed with exit code 1".     |
| 2026-11-12 17:37 | E2E Hello World Matrix 43271477613 (`workflow_run`) is skipped: `vars.ENABLE_REAL_GITHUB_E2E` is not set.                                                                                    |
| 2026-11-12 17:54 | Issue #4050 is opened. Formal AI Draft 43274283479 fails to pull `konard/hive-mind:2.40.1` and warns "No files were found with the provided path ... No artifacts will be uploaded".         |
| 2026-11-12 17:56 | The first PR run (43274680732) fails `detect-changes`: "STALE package-lock.json#enhanced-resolve: enhanced-resolve 5.26.2 -> 5.27.0".                                                        |
| 2026-11-12 19:14 | PR run 43285491341: `test-suites` fails `issue-3445-release-notes-not-masked`; the 2.40.1 CHANGELOG line (`b83e3e0`) is masked by the publication sanitizer. The same test fails on main.    |

## Findings, root causes and fixes

### F1. npm refused the release tarball (error, root cause of R2 and R3)

**Evidence.** `ci-logs/checks-and-release-43242624306-release.log.gz` lines 4205–4277 and
`checks-and-release-42805396999-release.log.gz`. The packed `pack.json` inside the
`native-codex-package` artifacts (read by range-fetching only the zip tail) gives:

| Version | Tarball bytes | Unpacked bytes | linux-x64 `codex` | linux-arm64 `codex` |
| ------- | ------------- | -------------- | ----------------- | ------------------- |
| 2.40.0  | 249,847,872   | —              | —                 | —                   |
| 2.40.1  | 249,862,346   | 665,171,647    | 351,203,584       | 304,856,128         |

**Root cause.** Since #3785 the main tarball bundles both platforms' executables. npm documents no
publish size limit, but the registry rejects bodies of this size with HTTP 413. The largest
tarball we have seen it accept is `@openai/codex@0.164.0-linux-x64` at 165,142,849 bytes
(`Content-Range` of the registry tarball). `@openai/codex` itself avoids the problem by publishing
each platform binary as a separate version (`0.164.0-linux-x64`, ...) and pinning them through
`optionalDependencies`.

**Fix.** Each platform is now a variant version of the same package,
`@link-assistant/hive-mind@<v>-native-codex-linux-{x64,arm64}`, under its own dist-tag. The main
package excludes `src/native-codex/runtime` and pins both variants as optional dependency aliases
at publication only. Keeping the same name keeps OIDC trusted publishing working without a manual
first publish. The runtime admits a variant only if its name and version match the main package,
then applies the existing byte, manifest and license checks. Release images install the variant
from the registry; PR images pack it locally and place it at the alias path. Details:
[`src/native-codex/PACKAGES.md`](../../../src/native-codex/PACKAGES.md).
Debug: `HIVE_MIND_NATIVE_CODEX_DEBUG=1` (off by default) names the refused phase and error code.

### F2. Nothing measured the tarball before upload (false negative)

Every build, verification and installed-runtime job passed, so the oversize was first noticed by
the registry, 100+ minutes into the run. `scripts/check-npm-tarball-size.mjs` now refuses any
tarball above 157 MiB (164,626,432 bytes) with an `::error` annotation listing the largest files.
It runs on every variant before upload, on the wired main archive before `changeset publish`, and
on the CI artifacts in `native-codex-build.yml`, so a pull request fails in minutes instead.

### F3. E413 was retried and reported generically (error reporting)

`scripts/publish-to-npm.mjs` retried the identical upload three times (about 87 s each), and the
job ended with "Process completed with exit code 1". An E413 is deterministic. The classifier now
has `PAYLOAD_TOO_LARGE_PATTERNS`, treats them as non-retryable, and prints one annotation that
says what to measure and where to move the payload. `HIVE_MIND_PUBLISH_VERBOSE=true` (off by
default) shows the raw `npm view` probe output used to skip already-published variants.

### F4. Formal AI Draft health alarm (true positive)

`health` failed because the image for the current version did not exist: `konard/hive-mind:2.40.0`
and `2.40.1` were never built, because F1 stopped the release. The alarm is correct and clears
after the next successful release. The draft workflow intentionally has no fallback to an older
image, so no change.

### F5. A draft that fails before `solve` uploaded nothing (warning)

Run 43274283479 failed while pulling the image, then "Upload the session log" warned "No files
were found with the provided path". `fail()` in the draft workflow now writes
`formal-ai-draft-failure.log` (error code and message) into the log directory first, so the
artifact always exists and the warning is gone.

### F6. Dependency freshness gate on the PR (true positive)

`enhanced-resolve` 5.27.0 was published after main's lockfile was written. The lockfile was
refreshed (`fca24dc57`); the gate worked as designed.

### F7. E2E Hello World Matrix skipped (by design)

Both the scheduled (43231216294) and `workflow_run` (43271477613) runs skip `prepare` because real
GitHub E2E is opt-in through `vars.ENABLE_REAL_GITHUB_E2E` (#4017). No change.

### F8. Warnings outside this repository

| Warning                                                                                     | Status                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[DEP0005] DeprecationWarning: Buffer() is deprecated` from `actions/download-artifact@v8`  | Already reported upstream: [actions/download-artifact#484](https://github.com/actions/download-artifact/issues/484), [actions/toolkit#2003](https://github.com/actions/toolkit/issues/2003). Harmless. |
| "The ubuntu-latest label will migrate to Ubuntu 26" on Dependabot and dependency-graph runs | Emitted by GitHub-managed workflows; not configurable here.                                                                                                                                            |
| Cleanup: "1380 fixture branch(es) retained by a repository rule that prohibits deletion"    | **Blocked (B1):** needs a repository administrator to add a bypass or narrow ruleset 21204104, unchanged since issues #4025 and #4029.                                                                 |

### F9. Release-note placeholder masked by the publication sanitizer (false positive)

**Evidence.** `ci/test-suites-131419970048.log.gz` (run 43285491341): the 3445 regression test
reports that `sanitizeForPublication(CHANGELOG.md)` changed one line. The 2.40.1 entry added in
`b83e3e0` reads "the credential in `` `Authorization: token <value>` ``"; the published text was
"`` `Authorization: token [REDACTED] ``", with the closing backtick eaten.
`experiment-authorization-code-span-before.txt` shows the library masking every placeholder that
closes a code span (`<token>`, `$TOKEN`, `${TOKEN}`) while keeping the same value inside quotes.

**Root cause.** In `@link-foundation/sensitive-data-sanitizer` 0.22.3, the `authorization` rule
ends a value at control characters, whitespace, `"`, `'`, `\` and `,`, but not at a backtick. The
value read is ``<value>` ``, which `isPlaceholderToken` does not recognise, so it is masked and the
backtick goes with it. Reported upstream as
[sensitive-data-sanitizer#177](https://github.com/link-foundation/sensitive-data-sanitizer/issues/177)
with a reproduction, a workaround and a suggested one-character fix.

**Fix.** `src/sensitive-data-sanitizer.lib.mjs` passes an `exempt` hook that keeps a value only
when it is exactly one complete template (`<name>`, `$NAME`, `${NAME}`) followed by the backtick
that closes a code span opened earlier on the same line after an `Authorization:` header. The hook also
asks the library whether it keeps the same value when no backtick follows it, so it is never
broader than upstream's own placeholder rule (`experiments/issue-4050/placeholder-parity-probe.mjs`). Known
secrets are never offered to the hook, and real tokens in code spans stay masked
(`tests/authorization-code-span-placeholder-4050.test.mjs`). `HIVE_MIND_SANITIZER_DEBUG=1` (off by
default) traces each exemption as `exempt:code-span-authorization-placeholder`. The workaround is
listed in `UPSTREAM.authorizationCodeSpanPlaceholder` for removal once #177 ships.

## Template comparison

| Template | Same defect?                                                                                         | Action                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| js       | Yes: `NON_RETRYABLE_PATTERNS` lacks E413 (probe below prints `false`), and there is no tarball gate. | [js-template#298](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/298)         |
| python   | No upload size gate; PyPI refuses files above 100 MB with `400 File too large`.                      | [python-template#146](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/146) |
| cpp      | No `.nupkg` size gate; nuget.org refuses packages above 250 MB with 413.                             | [cpp-template#23](https://github.com/link-foundation/cpp-ai-driven-development-pipeline-template/issues/23)         |
| rust     | No: `scripts/check-crate-size.rs` gates crates.io's 10 MiB limit before `cargo publish`.             | None                                                                                                                |

Probe: `node experiments/issue-4050/template-e413-classification.mjs <classifier.mjs>` prints
`{"nonRetryable":{"changesetLine":false,"npmError":false}}` for the js template and `true` for both
with this repository's classifier.

## Upstream

- npm registry: no documented limit; nothing to report. The design follows `@openai/codex`.
- `actions/download-artifact` DEP0005: already tracked (F8).
- `@link-foundation/sensitive-data-sanitizer`: [#177](https://github.com/link-foundation/sensitive-data-sanitizer/issues/177), an Authorization value is not ended at a Markdown backtick (F9). Body: `dev/log/issues/4050/pulls/4051/upstream-issues/`.

## Sources

- npm `optionalDependencies` with `os`/`cpu`: https://docs.npmjs.com/cli/configuring-npm/package-json#optionaldependencies
- npm trusted publishing (OIDC): https://docs.npmjs.com/trusted-publishers
- `@openai/codex` per-platform versions: https://www.npmjs.com/package/@openai/codex?activeTab=versions
- PyPI file size limits: https://docs.pypi.org/project-management/storage-limits
- nuget.org package size limit: https://learn.microsoft.com/en-us/nuget/nuget-org/publish-a-package
- crates.io size limit: https://doc.rust-lang.org/cargo/reference/publishing.html

## Verification

- `node --test tests/native-codex-packages-4050.test.mjs`: size gate, annotation, wiring, publication, packing, variant admission.
- `node tests/cicd-best-practices-tarball-size-4050.test.mjs`: principle 16 in all four languages.
- `python3 -I experiments/issue-3785/test_native_codex_build.py`: `verify-package` / `verify-variant`.
- `experiments/issue-4050/fake-registry-variant-install.mjs`: installs main plus variant from a local fake registry with npm and Bun and checks that the alias resolves from the main package.
- `node --test tests/authorization-code-span-placeholder-4050.test.mjs` and `node tests/issue-3445-release-notes-not-masked.test.mjs`: placeholders kept, real tokens masked, CHANGELOG published unchanged.
- `node experiments/issue-4050/changelog-sanitizer-diff.mjs`: lists CHANGELOG lines the publication sanitizer would change (0 after the fix).
- CI on PR #4051: `native-codex-build` assemble and installed-runtime jobs, `docker-pr-check`.
