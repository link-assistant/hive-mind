# Issue 2286 / pull request 2287 evidence archive

This directory preserves the inputs, CI logs, external research and local verification used to investigate [issue #2286](https://github.com/link-assistant/hive-mind/issues/2286) and [pull request #2287](https://github.com/link-assistant/hive-mind/pull/2287). The detailed reconstruction and requirement-by-requirement conclusions are in [`ANALYSIS.md`](ANALYSIS.md).

## Inventory

| Directory | Contents |
| --- | --- |
| `github/` | Issue, comment, timeline, PR, reviews, rulesets, workflow inventory, run metadata, recent run lists and related issue/PR records collected through authenticated GitHub APIs |
| `ci-logs/` | Full or failed-job logs for the last known-good release, every non-passing Checks and release run from the regression period, the omitted run, and the initial PR run |
| `research/online/` | npm registry metadata and headers, relevant npm CLI reports, current jscpd/Prettier release comparisons, and recent template PR metadata |
| `research/template/` | Template commit identity, full and CI-focused file trees, changes since the preceding Hive audit, relevant source snapshots, and the upstream defect report |
| `local/` | Local regression and repository-check output captured while validating the fix |

Large logs and the 1,000-run API response are gzip-compressed before commit. They remain directly searchable with `zgrep` and readable with `zcat`.

## Reproduction commands

The two deterministic regressions are part of the normal test suite:

```bash
node tests/publish-verification-race-2082.test.mjs
node tests/test-fix-ci-cd.mjs
node tests/cleanup-workflow-auth-2286.test.mjs
```

The live collector can be exercised without creating an issue:

```bash
node experiments/issue-2286/live-ci-collector.mjs link-assistant/hive-mind
```

At investigation time this enumerated 11 active workflows and returned seven with default-branch history, including the failed Checks and release run `35644890960` even though the newest merge commit had two successful auxiliary runs. Time-ordered per-workflow queries avoid both the combined endpoint's 1,000-result cap and historical runs from deleted workflows; `head_branch` is checked locally because the archived workflow-specific `branch=main` response was itself stale. The same probe exposed active cleanup-workflow failure `18496075671`, leading to the environment-token repair covered by the third regression test.

## External report

The same too-short npm verification horizon exists in the JavaScript pipeline template. It was reported with the observed timing data, a deterministic reproduction, a workaround and a proposed fix in [template issue #197](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/197). The submitted body and the API response are preserved under `research/template/`.
