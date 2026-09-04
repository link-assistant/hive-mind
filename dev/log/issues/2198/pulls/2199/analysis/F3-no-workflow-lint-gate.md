# F3 — No job ever linted the workflows (root cause of F2)

**Severity:** High · **Class:** False negative (missing gate)
**Status:** Gate added in `e6152f95`, ported from the template.

## Symptom

There is no symptom. That is the finding.

`.github/workflows/` held four workflow files, 25 accumulated defects (F2), and every
run reported green on the workflow layer, because **no job read those files for
correctness**. The only thing that touched them was `scripts/workflow-lint.lib.mjs`,
which asserts structural properties this repository cares about (every job has
`timeout-minutes`, cancellation is configured the way issue #1730 decided) — not syntax,
not shell correctness, not injection.

The template this pipeline derives from
([`link-foundation/js-ai-driven-development-pipeline-template`](https://github.com/link-foundation/js-ai-driven-development-pipeline-template))
gates on both actionlint and zizmor in `.github/workflows/workflows.yml` and consequently
reports zero. hive-mind had no equivalent file.

## Fix

`.github/workflows/workflows.yml`, ported from the template, plus `.github/zizmor.yml`
carrying the trusted-publisher policy: `actions/`, `github/`, `docker/`, `astral-sh/`,
`lycheeverse/`, `zizmorcore/` and `changesets/` may be pinned by tag; anything else needs
a full commit hash.

Two details in that port are worth keeping in mind, because they decide whether a local
reproduction agrees with CI:

- **actionlint runs as the Docker image, not the native binary.** The image bundles
  shellcheck and pyflakes. A bare `actionlint` binary with no shellcheck on `PATH`
  silently skips every `run:` block check and still exits 0 — so 14 of the 25 findings
  in F2 are invisible to the obvious local invocation.
- **zizmor reports annotations rather than SARIF.** SARIF upload needs code scanning
  enabled, which forks do not have; annotations make the job fail loudly everywhere.

`--min-confidence medium` matches the template. Note that this filters by **confidence,
not severity**: a low-severity, high-confidence finding still exits 12.

## The 29 low-confidence findings that were *not* silently ignored

zizmor's `artipacked` audit reports 29 checkouts without `persist-credentials: false`.
They are low confidence and the template has the same set, but "the template does it too"
is not a reason. Each was surveyed —
[`../local/zizmor-low-confidence.txt`](../local/zizmor-low-confidence.txt) — and the
persisted credential is genuinely used by:

- `release`, `instant-release`, `changeset-pr`, and both `helm-release` jobs, which push;
- `scripts/detect-code-changes.mjs` and `scripts/validate-changeset.mjs`, which fetch
  from `origin`.

Turning `persist-credentials: false` on would break those jobs, so the finding stays
below the gate with the survey as its justification rather than being suppressed.

## Actionlint version

The template pinned `rhysd/actionlint:1.7.7` (January 2025). This PR pins **1.7.12**
(the newest release, 2026-03-30) after verifying it reports the same clean result. The
template still pins 1.7.7 — see the upstream reports section of
[`../README.md`](../README.md).
