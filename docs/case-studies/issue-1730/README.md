# Case study — Issue #1730: `check-file-line-limits` CI failure on main

- Issue: <https://github.com/link-assistant/hive-mind/issues/1730>
- Failed run: <https://github.com/link-assistant/hive-mind/actions/runs/25124605561/job/73634164393>
- Trigger commit: `e3063fff` (PR #1726, merged into `main` 2026-04-29 17:15 UTC)
- Failure detected at: 2026-04-29 17:45 UTC, ~30 minutes after the merge
- Fix PR: <https://github.com/link-assistant/hive-mind/pull/1731>

## Summary

After PR #1726 (rate-limit safeguards) merged into `main`, the `check-file-line-limits` CI job started failing because three `.mjs` files crossed the 1500-line hard limit. ESLint's `max-lines` rule had been silently letting these files through because it was configured with `skipBlankLines: true, skipComments: true`, while the CI script counts raw `wc -l`. The two checks were drifting apart: ESLint reported "ok" locally, CI reported failure on `main`.

## Timeline

| Time (UTC, 2026-04-29) | Event                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17:15:30               | `82fcd726` — `feat(rate-limit): wrap $ at every entry point with wrapDollarWithGhRetry (#1726)` merged. Adds a 3-line `__rawDollar$` wrap pattern at the top of each gh-API caller file. `solve.repository.lib.mjs` goes from 1500 → 1501 lines.            |
| 17:15:46               | `e3063fff` — `chore(rate-limit): add marker imports to gh-API callee files (#1726)` merged. Adds a 4-line marker block (2 comment lines + import + `void` line) to 17 more files. `hive.mjs` goes from 1500 → 1504, `limits.lib.mjs` goes from 1497 → 1501. |
| 17:44:49               | `main`-branch CI run #25124605561 starts.                                                                                                                                                                                                                   |
| 17:45:24               | `check-file-line-limits` job reports `ERROR: ./src/hive.mjs has 1504 lines (limit: 1500)` and two more identical errors.                                                                                                                                    |
| 17:45:26               | `Process completed with exit code 1`. Job fails. Downstream Docker / Helm / Release jobs are gated and skipped.                                                                                                                                             |
| ~17:55                 | Issue #1730 filed with link to the failed run and the directive to compare against the JS/Rust pipeline templates.                                                                                                                                          |

## Reproducing the failure

The full job log is preserved at
[`data/run-25124605561-full.txt`](./data/run-25124605561-full.txt).

Local reproduction at the broken commit (before this PR's fix):

```bash
git checkout e3063fff
bash scripts/check-file-line-limits.sh
# ERROR: ./src/hive.mjs has 1504 lines (limit: 1500)
# ERROR: ./src/limits.lib.mjs has 1501 lines (limit: 1500)
# ERROR: ./src/solve.repository.lib.mjs has 1501 lines (limit: 1500)
# exit 1
```

Confirming that ESLint _did not_ catch this on the same commit:

```bash
npm run lint   # exits 0 — false negative
```

This false negative is the underlying root cause that let PR #1726 merge.

## Requirements (from the issue body)

The issue lists several explicit asks:

1. **Fix the CI failure** for run 25124605561.
2. **Use best practices from the JS/Rust pipeline templates**; if the same bug exists upstream, file a template issue.
3. **Compile all related logs and data** under `docs/case-studies/issue-{id}` for case-study analysis.
4. **Reconstruct timeline**, list requirements, identify root causes per problem, and propose solutions.
5. **Search online for related facts.**
6. **If root cause is unclear**, add debug output / verbose mode for the next iteration.
7. **Report upstream issues** in any other repository involved, with reproducible examples and suggested fixes.
8. **Plan and execute everything in a single PR** (PR #1731).

## Root-cause analysis

Two distinct bugs combined:

### Root cause #1 — ESLint `max-lines` desynced from CI line check

`eslint.config.mjs` (before this PR):

```js
'max-lines': [
  'error',
  {
    max: 1500,
    skipBlankLines: true,
    skipComments: true,
  },
],
```

vs. `scripts/check-file-line-limits.sh`:

```bash
LIMIT=1500
line_count=$(wc -l < "$file")
if [ "$line_count" -gt "$LIMIT" ]; then ...
```

The comment on the rule claimed the two checks were "synchronized," but they were not. ESLint counted only code lines (skipping blanks/comments), while `wc -l` counts everything. A file at 1504 raw lines could easily be ≤1500 code lines — exactly the case for the three files that broke this run.

Effect: developers running `npm run lint` locally saw a green build and merged. The first signal of failure was the post-merge CI run on `main`.

### Root cause #2 — PR #1726's marker import added 3–4 lines per file with no headroom check

PR #1726 introduced a per-file marker:

```js
// Marker: this file's gh API calls flow through a $ wrapped with
// wrapDollarWithGhRetry by the caller. See issue #1726.
import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';
void _wrapDollarWithGhRetry;
```

That is **4 lines** added to 17 files. Three of those files were already within 4 lines of the hard limit:

| File                           | Before #1726 | After #1726 |                                 Delta | Crossed limit? |
| ------------------------------ | -----------: | ----------: | ------------------------------------: | -------------- |
| `src/hive.mjs`                 |         1500 |        1504 |                                    +4 | yes            |
| `src/limits.lib.mjs`           |         1497 |        1501 |                                    +4 | yes            |
| `src/solve.repository.lib.mjs` |         1500 |        1501 | +1 (different `__rawDollar$` pattern) | yes            |

The warn threshold (1350) is supposed to catch this — and it did (warnings were emitted for these files in earlier CI runs) — but warnings are non-blocking and the marker rollout shipped anyway.

This is structurally identical to the **concurrent-PR-merge race** documented in case study `issue-1593`: two PRs each individually under 1500 can together push a file over. Here it was a single PR adding to many files near the threshold, but the safety story is the same — soft warnings are insufficient when the tolerance is small.

## Fixes applied in this PR

1. **Compact the marker** from 4 lines to 1 line in all 17 files (a trailing-comment marker is enough; the `void` is unnecessary because ESLint's `varsIgnorePattern: '^_'` already exempts the underscore-prefixed binding):

   ```js
   import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs'; // rate-limit marker (#1726): gh API calls flow through $ wrapped by caller
   ```

2. **Compact the `solve.repository.lib.mjs` wrap pattern** from 4 lines to 3, keeping the destructure form so the `no-direct-gh-exec` ESLint rule still recognizes `wrapDollarWithGhRetry` in scope.

3. **Synchronize ESLint `max-lines` with the CI script** by setting `skipBlankLines: false, skipComments: false`. Now `npm run lint` catches the failure locally before push, and the CI job is no longer the first signal.

4. **Documentation**: this case study, with raw CI logs preserved.

After the fix:

| File                           | Lines |
| ------------------------------ | ----: |
| `src/hive.mjs`                 |  1500 |
| `src/limits.lib.mjs`           |  1498 |
| `src/solve.repository.lib.mjs` |  1500 |

## Comparison with `link-foundation/js-ai-driven-development-pipeline-template`

Hive-mind's `check-file-line-limits.sh` is largely shared with the template's, but with one _additional_ safeguard: the `WARN_THRESHOLD=1350` band introduced in issue #1593. The template does **not** have the warn threshold and would hit the same concurrent-merge race as soon as a file crosses 1500.

The template's `eslint.config.js` uses `'max-lines': ['error', 1500]` (shorthand) — that defaults to `skipBlankLines: false, skipComments: false`, so it does **not** have the desync bug we just fixed. Hive-mind diverged from the template at some point and acquired the buggy long-form configuration; this PR brings it back in line.

Other gaps in hive-mind vs the template (out of scope for this issue but worth noting):

- No multi-runtime test matrix (template runs Node × Bun × Deno × Ubuntu/macOS/Windows).
- No `secretlint` job.
- Neither uses `actions/setup-node` `cache: 'npm'` — small optimization opportunity.

## Upstream report

The template is missing the `WARN_THRESHOLD=1350` band that prevents the
concurrent-PR-merge race. Hive-mind went through that exact failure (case study
`issue-1593`) and re-experienced its tail in this issue. Upstream issue filed:

- <https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/41>
  — `check-file-line-limits.sh: add 1350 warn threshold to mitigate concurrent-PR merge race`.
  Suggested patch: port the `WARN_THRESHOLD` block from
  `scripts/check-file-line-limits.sh` of this repo.

## Why no new debug output was added

The root cause was already legible from the existing log output (`ERROR: $file
has $line_count lines (limit: ${LIMIT})`) and from the per-file totals printed
above the failure. No additional verbose mode was needed — this was a
classification problem (the wrong tool reported "ok"), not a visibility one.

## Existing components that were reused

- `scripts/check-file-line-limits.sh` — already enforces the 1500/1350 bands.
- ESLint `max-lines` core rule — already configured, just had the wrong options.
- `eslint-rules/no-direct-gh-exec.mjs` — already recognizes `wrapDollarWithGhRetry` as a safe-wrapper marker, so the compacted single-line `import { wrapDollarWithGhRetry as _x }` form keeps working.

## Files changed

- `eslint.config.mjs` — synchronize `max-lines` with the CI script.
- `src/hive.mjs`, `src/limits.lib.mjs`, `src/solve.repository.lib.mjs` — compact the rate-limit marker / wrap pattern to drop back under 1500 lines.
- 14 other files in `src/` and `scripts/` — same marker-block compaction (4 lines → 1) for consistency and future headroom.
- `docs/case-studies/issue-1730/` — this case study + raw CI log.
