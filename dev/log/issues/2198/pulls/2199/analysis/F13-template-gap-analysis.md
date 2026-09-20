# F13 — Gap analysis vs `link-foundation/js-ai-driven-development-pipeline-template`

The issue asks to *"compare all files, so we don't have more CI/CD errors in the future
and reuse all the best practices from these templates"*. This is that comparison, and the
decision recorded for every gap it found — including the ones deliberately not adopted.

Template snapshot: commit `7ae16b0edef2f52ad657a839767f05ef4d4143f2`, tag `0.11.28`,
2026-09-03 ([`../template-head.txt`](../template-head.txt)). Files copied to
[`../template-workflows/`](../template-workflows/) and
[`../template-scripts/`](../template-scripts/).

Note that PR #2083 (issue #2082) already ran this comparison once and back-ported a large
part of it — job timeouts, cancellation polarity, `push-main-with-rebase-retry` semantics
inside `version-and-commit.lib.mjs`, `check-release-needed`, `run-command.lib.mjs`. This
pass looks at what is *still* different.

## Workflow files

| File | Template | hive-mind (before) | Decision |
| --- | --- | --- | --- |
| `workflows.yml` (actionlint + zizmor gate) | present | **absent** | **Adopted** — F3 |
| `links.yml` (lychee + Wayback fallback) | present | **absent** | **Adopted** — F9 |
| `security.yml` → `npm-audit` job | present | **absent** | **Adopted** — F12 |
| `.github/zizmor.yml` | present | absent | **Adopted** with hive-mind's own trusted-publisher list |
| `.github/actions/setup-buildx-resilient` | present | absent, ×8 bare boots | **Adopted** — F10 |
| `security.yml` → CodeQL config file | absent | `codeql-config.yml` | hive-mind is ahead; nothing to do |
| `example-app.yml` | present | n/a | Template-specific (it ships an example app) |

## Scripts present in the template and not here

Twenty-one filenames differ. Most are not gaps — they are the template's internal
plumbing (`js-paths.mjs`, `use-module.mjs`, `debug-print.mjs`, `package-info.mjs`,
`npm-registry.mjs`, `release-naming.mjs`, `format-release-notes-helpers.mjs`), or exist
here under a different name with equivalent or stronger behaviour:

| Template script | hive-mind equivalent | Verdict |
| --- | --- | --- |
| `run-command.mjs` | `scripts/run-command.lib.mjs` | equivalent (back-ported in #2083) |
| `push-main-with-rebase-retry.mjs` | `scripts/version-and-commit.lib.mjs:99,158` | equivalent (back-ported in #2083) |
| `publish-retry.mjs` | `scripts/publish-to-npm.mjs` + `publish-failure-classifier.mjs` | hive-mind is **stronger**: it adds `detectPublishFailure()` / `FAILURE_PATTERNS` for content-based detection of `changeset publish` swallowing npm's exit code (issue #2028) |
| `check-docker-build.mjs`, `check-docker-publish.mjs` | `scripts/docker-pr-build.sh`, `verify-docker-image.sh` | equivalent |
| `lint.mjs`, `lint-changed-lines.mjs` | eslint/prettier npm scripts run directly | equivalent |
| `changeset-version.mjs` | `scripts/version-and-commit.mjs` | equivalent |

Two are real gaps, both **deliberately deferred**:

### `smoke-test-package.mjs` — deferred, with a reason

The template installs the just-published package from the registry into a clean temp
project and runs its CLI. hive-mind has no such script — but it is not uncovered: the
Docker publish jobs run after `scripts/wait-for-npm.mjs`, and `Dockerfile:186` does

```dockerfile
bun install -g "@link-assistant/hive-mind@${HIVE_MIND_VERSION}"
```

i.e. it installs the published artifact from the registry, and
`scripts/verify-docker-image.sh` then executes it. A tarball that cannot be installed or
run already fails the release, one job later. A dedicated smoke test would fail *sooner*
and more legibly; that is an improvement, not a missing gate, and it is a poor fit for a
PR about false signals.

### `check-changesets.mjs` — deferred

The template queries the npm registry to decide whether a release is genuinely needed.
hive-mind has `check-release-needed.mjs`, which does query the registry (issue #2175);
`check-changesets.mjs` covers a narrower validation that `validate-changeset.mjs` largely
already performs here.

## `publish-dockerhub` composite — deferred

The template wraps login + buildx + build-push into one composite action with a
step-level timeout budget. hive-mind has eight image-publishing jobs written out
longhand. Adopting it is an eight-job refactor of the release path, and the part of it
that actually removes a failure mode — resilient BuildKit boot — has already been ported
on its own (F10). Refactoring the publish path further inside a PR about CI *correctness*
would make the diff hard to review for the property it is meant to establish.

## Step-level timeout budgets — noted, not adopted

The template puts `timeout-minutes` on two individual steps and documents the practice in
`docs/CI-TIMEOUT-BUDGETS.md`. hive-mind has **zero** step-level timeouts, but every job
has a job-level one (asserted by `tests/ci-workflow-timeouts-2082.test.mjs`, back-ported
in #2083), so no job can burn GitHub's 6-hour default. The remaining benefit is faster
failure on a hung step, which is worth its own issue.

## Where hive-mind is ahead

Worth recording, because "the template does it" is not by itself an argument:

- `scripts/publish-failure-classifier.mjs` — content-based detection of a swallowed
  publish failure. The template only has `NON_RETRYABLE_PATTERNS`.
- `.github/codeql/codeql-config.yml` — the template runs CodeQL with defaults.
- `scripts/workflow-lint.lib.mjs` — property assertions over the workflow files
  (timeouts, cancellation) that actionlint and zizmor do not make.
- actionlint **1.7.12**; the template still pins 1.7.7 (January 2025).

## Findings that apply to the template too

See "Upstream reports" in [`../README.md`](../README.md). In short: the template's own
zizmor job exits 12 on the `self-repository` audit (F11), and it still pins actionlint
1.7.7.
