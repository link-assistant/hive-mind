# Case Study: Recent CI/CD Failures and Docker Manifest False Positive

**Issue:** [#1748](https://github.com/link-assistant/hive-mind/issues/1748)
**PR:** [#1749](https://github.com/link-assistant/hive-mind/pull/1749)
**Date:** 2026-05-04
**Status:** Fix implemented for the reproducible release failure

## Executive Summary

Recent CI/CD runs had two classes of failures:

1. PR policy failures for missing changesets or incomplete documentation sync.
2. Main-branch Docker release failures where the normal image manifest job downloaded Docker-in-Docker digest artifacts and tried to publish them as `konard/hive-mind` digests.

The actionable false positive was the Docker artifact namespace collision. The normal release job used `pattern: digests-*`, which also matched `digests-dind-*`. With `merge-multiple: true`, all matching digest marker files were extracted into one directory. The manifest command then attempted to create `konard/hive-mind` from both normal and DinD image digests, and Docker Hub correctly returned `not found` for the DinD digest under the normal image name.

## Requirements Checklist

- Read issue #1748 and related PR state.
- Download recent failing CI run metadata and logs.
- Verify failing runs against timestamps and SHAs.
- Identify actual errors rather than relying on status summaries.
- Compare CI/CD workflow and scripts with the requested template repositories.
- Search official external documentation for artifact and Docker manifest behavior.
- Reproduce the issue with an automated test.
- Fix the workflow and keep a changeset.
- Preserve case-study evidence under `docs/case-studies/issue-1748/`.

## Preserved Evidence

Downloaded run metadata and logs are in `docs/case-studies/issue-1748/ci-logs/`:

| Run           | Created at           | Branch                    | Head SHA       | Failed job             |
| ------------- | -------------------- | ------------------------- | -------------- | ---------------------- |
| `25260360933` | 2026-05-02T19:48:53Z | `issue-1745-1bc6e8f2cd9c` | `7b1929fc5a4a` | Check for Changesets   |
| `25261371525` | 2026-05-02T20:40:07Z | `issue-1745-1bc6e8f2cd9c` | `ac85fab348da` | test-suites            |
| `25261449965` | 2026-05-02T20:44:07Z | `issue-1745-1bc6e8f2cd9c` | `ce5952777ade` | validate-docs          |
| `25262533464` | 2026-05-02T21:39:31Z | `main`                    | `8b687b48a20f` | Docker Publish (Merge) |
| `25290154570` | 2026-05-03T20:36:33Z | `main`                    | `3fdb15dda687` | Docker Publish (Merge) |
| `25290423383` | 2026-05-03T20:49:05Z | `issue-814-dceead53c719`  | `d32e0228aa35` | Check for Changesets   |
| `25291053689` | 2026-05-03T21:17:07Z | `issue-401-ab8a9e20`      | `0af98ba272b9` | Check for Changesets   |

## Failure Analysis

### Changeset Policy Runs

Runs `25260360933`, `25290423383`, and `25291053689` failed because `scripts/validate-changeset.mjs` found zero changeset files added by those PRs:

```text
Found 0 changeset file(s) added by this PR
No changeset found in this PR. Please add a changeset by running 'npm run changeset' and commit the result.
```

These were policy failures, not CI false positives. This PR adds exactly one patch changeset for the workflow fix.

### PR Iteration Failures

Run `25261371525` failed in `tests/test-docs-options-sync.mjs` because new sanitizer options were added without updating `docs/CONFIGURATION.md`:

```text
Options in code but NOT in docs/CONFIGURATION.md:
  --dangerously-skip-output-sanitization
  --dangerously-skip-code-output-sanitization
  --dangerously-skip-active-tokens-output-sanitization
```

Run `25261449965` then failed `validate-docs` because only the English configuration doc changed:

```text
docs/CONFIGURATION changed only docs/CONFIGURATION.md; also update docs/CONFIGURATION.zh.md, docs/CONFIGURATION.hi.md, docs/CONFIGURATION.ru.md
```

Those were issue #1745 PR iteration failures and were not the root cause of the later main-branch release failures.

### Docker Manifest Runs

Runs `25262533464` and `25290154570` failed after successful package publication and platform image pushes. In run `25262533464`, the normal merge job downloaded four digest artifacts:

```text
pattern: digests-*
Preparing to download the following artifacts:
- digests-dind-amd64
- digests-amd64
- digests-dind-arm64
- digests-arm64
```

The same job then created a `konard/hive-mind` manifest from all four files, including DinD digests:

```text
docker buildx imagetools create ... $(printf '***/hive-mind@sha256:%s ' *)
ERROR: docker.io/***/hive-mind@sha256:cba0095e998d385ca31c30f42e4f37c4b394367faf44db09c56293cbd9bbec05: not found
```

Run `25290154570` reproduced the same failure with version `1.64.4`:

```text
pattern: digests-*
0a67562e4dbdabb87e1fea3d4412e727dc7920d8be3890090e0b20a5f1a2c423
318bb378dcf4e15f9afc5b904878204833ecab9acf1ed5ae15a69a7c510a3a19
774c594e4339469d3a3c76e20e619e5718a83dc248f52647d268e0f4316961e4
a8df9beefdc3af483f16406cfc3ca699dd52158cea3ac57c505829c914ddc816
ERROR: docker.io/***/hive-mind@sha256:318bb378dcf4e15f9afc5b904878204833ecab9acf1ed5ae15a69a7c510a3a19: not found
```

## External Facts

- The official `actions/download-artifact` README says `pattern` is a glob pattern and `merge-multiple: true` extracts multiple matching artifacts into the same destination directory.
- GitHub's Actions artifact documentation says downloading all artifacts creates directories by artifact name, and points to `actions/download-artifact` for syntax details.
- Docker's `docker buildx imagetools create` documentation shows that source inputs are image references or descriptors and that `-t/--tag` sets the resulting image reference. The workflow was passing every downloaded digest file as a source digest for the normal image.

Sources:

- [actions/download-artifact README](https://github.com/actions/download-artifact)
- [GitHub Actions artifact documentation](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [Docker buildx imagetools create reference](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/)

## Template Comparison

Checked active workflows and scripts in the requested template repositories:

- `link-foundation/js-ai-driven-development-pipeline-template`
- `link-foundation/rust-ai-driven-development-pipeline-template`
- `link-foundation/python-ai-driven-development-pipeline-template`
- `link-foundation/csharp-ai-driven-development-pipeline-template`

The active templates do not contain the overlapping Docker digest artifact pattern used by Hive Mind. Code search for `pattern: digests-*` and `digests-dind-*` under `link-foundation` found no active matching template workflow. Broader `actions/download-artifact` matches use named artifacts such as `dist` or `nuget-package`, or archived case-study data, so no upstream template issue was filed.

## Fix

The release workflow now uses disjoint artifact namespaces:

| Job family           | Upload artifact                         | Download pattern                   |
| -------------------- | --------------------------------------- | ---------------------------------- |
| Release normal image | `hive-mind-digests-{arch}`              | `hive-mind-digests-*`              |
| Release DinD image   | `hive-mind-dind-digests-{arch}`         | `hive-mind-dind-digests-*`         |
| Instant normal image | `hive-mind-instant-digests-{arch}`      | `hive-mind-instant-digests-*`      |
| Instant DinD image   | `hive-mind-dind-instant-digests-{arch}` | `hive-mind-dind-instant-digests-*` |

This prevents a normal manifest job from ever matching DinD digest artifacts, while preserving the existing matrix build and manifest merge structure.

## Regression Coverage

`tests/test-docker-release-order.mjs` now asserts that:

- `pattern: digests-*` is absent.
- Normal release and instant manifest jobs download only normal image digest namespaces.
- DinD release and instant manifest jobs download only DinD image digest namespaces.

`tests/test-docker-dind-variant.mjs` was updated to require the new DinD artifact names.

## Validation Plan

The local validation for this PR includes:

- `node tests/test-docker-release-order.mjs`
- `node tests/test-docker-dind-variant.mjs`
- `bash scripts/check-file-line-limits.sh`
- `npm run format:check`
- `npm run lint`
- `npm test`
- `GITHUB_BASE_REF=main node scripts/validate-changeset.mjs`
- `git diff --check`
