# Development log: issue 4050 / PR 4051

Issue: <https://github.com/link-assistant/hive-mind/issues/4050>
Pull request: <https://github.com/link-assistant/hive-mind/pull/4051>
Analysis: [`docs/case-studies/issue-4050/README.md`](../../../../../../docs/case-studies/issue-4050/README.md)

`*.log` is ignored by git, so logs are committed gzipped (`zcat <file>.log.gz`).

## Runs named in the issue

| Run         | Workflow               | Commit    | Evidence                                                                                                                         |
| ----------- | ---------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 43242624306 | Checks and release     | `2f20280` | `ci-logs/checks-and-release-43242624306-release.log.gz` (E413 ×3, lines 4205–4277), `...-pipeline-status.log.gz`, `check-runs-2f20280c6.tsv`, `annotations-2f20280.txt` |
| 43263266558 | Formal AI Draft        | `2f20280` | `ci-logs/formal-ai-draft-43263266558.log.gz` (`DRAFT_IMAGE_UNAVAILABLE` for `konard/hive-mind:2.40.0`)                            |
| 43271477613 | E2E Hello World Matrix | `d225236` | `check-runs-d22523636.tsv`, `annotations-other-runs.txt` (every job skipped)                                                     |

## Other runs

| Run         | What it shows                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 42805396999 | `ci-logs/checks-and-release-42805396999-release.log.gz`: 2.40.0 refused with E413 three times                                          |
| 43274283479 | `ci-logs/formal-ai-draft-43274283479-issue-4050.log.gz`: draft for this issue cannot pull `2.40.1`; "No files were found" upload warning |
| 43274680732 | `ci-logs/checks-and-release-43274680732-pr-detect-changes.log.gz`: stale `enhanced-resolve` lockfile entry on the first PR run          |
| 131402717407 | `ci/lint-131402717407.log.gz`: PR lint job failing on an unformatted experiment (fixed in `a03681cd9`)                                |
| 131419970048 | `ci/test-suites-131419970048.log.gz` (run 43285491341): `issue-3445-release-notes-not-masked` fails on the 2.40.1 CHANGELOG line (F9) |
| 131520166341 | `ci/native-codex-verify-131520166341.log.gz` (run 43296180981): `verify-variant` refused the real linux-x64 binary as "Unexpected native payload" (4 MiB limit for other files applied to `codex`) |

`recent-runs.tsv` and `release-runs-main.tsv` list the surrounding runs (id, event, conclusion,
time, commit); `annotations-other-runs.txt` holds the Dependabot, Cleanup and E2E annotations.

## Tarball sizes

Measured by range-fetching only the end of the `native-codex-package` artifact zips and reading
`pack.json` (`npm pack --json` output): 2.40.0 was 249,847,872 bytes, 2.40.1 was 249,862,346
bytes (665,171,647 unpacked; `codex` linux-x64 351,203,584, linux-arm64 304,856,128). The
largest tarball npm is known to have accepted, `@openai/codex@0.164.0-linux-x64`, is 165,142,849
bytes (`Content-Range` of the registry tarball).

## Template comparison

- `experiment-template-e413-classification.txt`: the js template's classifier treats E413 as
  retryable; ours does not.
- `template-issues/{js,python,cpp}.md`: bodies of the issues filed on the templates.
  `template-issues/filed.txt` records their URLs. The Rust template already has
  `scripts/check-crate-size.rs` and needs no issue.

## Sanitizer false positive (F9)

- `experiment-authorization-code-span-{before,after}.txt`: output of
  `experiments/issue-4050/changelog-sanitizer-diff.mjs` and
  `experiments/issue-4050/authorization-placeholder-probe.mjs` without and with the `exempt` hook.
  Before: one CHANGELOG line changed. After: none. The upstream library still masks the samples;
  the adapter keeps the placeholders and masks the synthetic token.
- `experiment-authorization-placeholder-parity.txt`: the exemption keeps a code-span value only
  when the library keeps the same value with no backtick (no `BROADER` line), and the
  template-shaped values the library masks (synthetic `ghp_` token, AWS key id) stay masked.
- `upstream-issues/sensitive-data-sanitizer-authorization-backtick.md`: body of
  [sensitive-data-sanitizer#177](https://github.com/link-foundation/sensitive-data-sanitizer/issues/177);
  `upstream-issues/filed.txt` records the URL.
