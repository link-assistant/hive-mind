# Case Study: Issue #1428 - Extract Extractable Logic from release.yml to ./scripts Folder

## Summary

The CI/CD pipeline failed on `main` with run [#23087809650](https://github.com/link-assistant/hive-mind/actions/runs/23087809650) because `.github/workflows/release.yml` had **1,501 lines** — exactly one line over the enforced 1,500-line limit. The `check-file-line-limits` job detected the violation using `scripts/check-file-line-limits.sh` and failed the build.

The fix was to extract the largest inline shell script blocks from `run: |` steps inside `release.yml` into dedicated script files under `./scripts/`, reducing the file from 1,501 lines to **1,266 lines**.

## Timeline of Events (2026-03-14)

| Time (UTC) | Event                                                                 |
| ---------- | --------------------------------------------------------------------- |
| ~12:18:56  | CI run #23087809650 triggered on `main` (commit `1a56d426`)           |
| ~12:18:56  | `check-file-line-limits` job runs `scripts/check-file-line-limits.sh` |
| ~12:18:56  | Script counts 1,501 lines in `.github/workflows/release.yml`          |
| ~12:18:56  | Run fails with `::error` annotation on `release.yml`                  |
| 2026-03-14 | Issue #1428 filed: extract inline logic to `./scripts/` folder        |
| 2026-03-14 | PR #1429 opened with the fix                                          |

## Root Cause Analysis

### How release.yml Grew to 1,501 Lines

Over time, CI jobs accumulated large inline `run: |` script blocks for tasks like:

- Simulating a fresh merge with the base branch before running checks (added in issue #1141)
- Verifying that log files contain version and command strings (issue #517)
- Testing npm global commands (`hive`, `solve`, `hive-telegram-bot`)
- Testing the `--auto-fork` flag across all entrypoints
- Verifying Helm `Chart.yaml` structure
- Checking Node.js syntax for all `.mjs` files

Several of these blocks were **duplicated** (e.g., the `simulate-fresh-merge` logic appeared identically in both the `lint` job and the `check-file-line-limits` job). Each copy was 44 lines, totalling 88 lines of duplication.

The file reached exactly 1,501 lines — triggering the enforcement limit.

### The `check-file-line-limits.sh` Enforcement

`scripts/check-file-line-limits.sh` enforces a **1,500-line limit** on:

1. All `.mjs` files in the project
2. `.github/workflows/release.yml`

When the limit is exceeded, it emits a GitHub Actions `::error` annotation and exits with a non-zero code, failing the `check-file-line-limits` job. Because this job is a required predecessor for `test-suites`, `test-execution`, `memory-check-linux`, `docker-pr-check`, and `helm-pr-check`, a single violation blocks the entire pipeline.

### Why the Merge Preview Logic Did Not Catch This

The question in issue #1428 was whether the "merge preview logic" (simulating a merge of the PR branch with the default branch) worked correctly and should have caught this. The answer is: the issue did **not** originate in a PR — it was detected on the `main` branch directly after a merge. The `simulate-fresh-merge` step only runs for pull request events (`if: github.event_name == 'pull_request'`), so it does not apply to push events on `main`. The line limit was crossed exactly at the moment the commit landed on `main`.

## The Fix

Six new script files were created under `./scripts/` to replace the largest inline script blocks:

| Script                                | Lines Removed from release.yml | Purpose                                                                                             |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `scripts/simulate-fresh-merge.sh`     | ~88 (2 copies × 44 lines)      | Merges latest base branch into PR checkout; shared between `lint` and `check-file-line-limits` jobs |
| `scripts/verify-log-file-contents.sh` | ~44                            | Runs `solve.mjs --dry-run` and verifies log file contains version and command (issue #517)          |
| `scripts/test-global-commands.sh`     | ~35                            | Tests that `hive`, `solve`, and `hive-telegram-bot` global CLI commands work after `npm link`       |
| `scripts/test-auto-fork-option.sh`    | ~33                            | Tests that `--auto-fork` flag is accepted by `solve.mjs`, `hive.mjs`, and `start-screen.mjs`        |
| `scripts/verify-chart-yaml.sh`        | ~23                            | Verifies `helm/hive-mind/Chart.yaml` contains required `name`, `version`, and `appVersion` fields   |
| `scripts/check-mjs-syntax.sh`         | ~20                            | Runs `node --check` on all `.mjs` files in root, `src/`, and `tests/`                               |

**Total lines removed from release.yml: ~243 lines.**

The file was reduced from **1,501 → 1,266 lines**, bringing it well under the 1,500-line limit.

### Key Design Decisions

1. **`simulate-fresh-merge.sh` deduplicates two identical blocks**: The 44-line inline script was copy-pasted into two separate jobs. By extracting it to a single script, both jobs now call `bash scripts/simulate-fresh-merge.sh` with `BASE_REF` already exported via the `env:` key — no changes to the step's environment configuration were needed.

2. **All extracted scripts use `set -euo pipefail`**: Consistent with the existing `.sh` scripts in the repo (`check-file-line-limits.sh`, `verify-docker-image.sh`).

3. **Scripts that interpolate GitHub Actions `${{ ... }}` expressions were left inline**: Blocks referencing `${{ steps.X.outputs.Y }}`, `${{ matrix.platform }}`, or secrets cannot be moved to external scripts because those expressions are resolved by the Actions runner before the shell process starts.

## Proposed Prevention

To prevent this from recurring:

1. **Extract by default**: When adding a new `run: |` block longer than ~15 lines, put it in `./scripts/` from the start.
2. **CI line limit warning**: Consider adding a warning (not failure) at 1,400 lines to give early notice before hitting the hard limit.
3. **Pre-commit hook or local check**: Run `bash scripts/check-file-line-limits.sh` locally before pushing workflow changes.

## Files Changed

- `.github/workflows/release.yml` — reduced from 1,501 to 1,266 lines
- `scripts/simulate-fresh-merge.sh` — new (extracted from `lint` and `check-file-line-limits` jobs)
- `scripts/verify-log-file-contents.sh` — new (extracted from `test-execution` job)
- `scripts/test-global-commands.sh` — new (extracted from `test-execution` job)
- `scripts/test-auto-fork-option.sh` — new (extracted from `test-execution` job)
- `scripts/verify-chart-yaml.sh` — new (extracted from `helm-pr-check` job)
- `scripts/check-mjs-syntax.sh` — new (extracted from `test-compilation` job)
