---
'@link-assistant/hive-mind': patch
---

Fix `check-file-line-limits` CI failure on `main` after issue #1726 merge.

After PR #1726 (rate-limit safeguards) merged into `main`, the
`check-file-line-limits` job failed because three `.mjs` files crossed the
1500-line hard limit:

- `src/hive.mjs` — 1500 → 1504 lines
- `src/limits.lib.mjs` — 1497 → 1501 lines
- `src/solve.repository.lib.mjs` — 1500 → 1501 lines

Two root causes combined: (1) the per-file marker block PR #1726 added was 4
lines (2 comment lines + import + `void`), with no headroom check; (2) ESLint's
`max-lines` rule was configured with `skipBlankLines: true, skipComments: true`
while the CI script counts raw `wc -l`, so `npm run lint` passed locally even
though the CI script would fail. Local lint and CI line-limit had silently
drifted apart. See
[`docs/case-studies/issue-1730`](./docs/case-studies/issue-1730/README.md)
for the timeline, log excerpts, and template comparison.

Fix:

- **Synchronize ESLint `max-lines` with the CI script** in
  [`eslint.config.mjs`](./eslint.config.mjs) by setting `skipBlankLines: false,
  skipComments: false`. Now `npm run lint` catches the failure locally before
  push, restoring the invariant the rule's comment claimed.
- **Compact the rate-limit marker** introduced by #1726 from 4 lines to 1 line
  in all 17 files. ESLint's existing `varsIgnorePattern: '^_'` means the
  `void _wrapDollarWithGhRetry;` line was redundant; the trailing-comment form
  preserves rate-limit awareness for `no-direct-gh-exec` while saving 3 lines
  per file. Files: `src/hive.mjs`, `src/limits.lib.mjs`,
  `src/{solve.session,solve.preparation,solve.progress-monitoring,solve.error-handlers,solve.feedback,solve.auto-pr,solve.branch-errors,hive.recheck,github.batch,bidirectional-interactive,token-sanitization}.lib.mjs`,
  `src/youtrack/youtrack-sync.mjs`,
  `scripts/{create-github-release,format-github-release,format-release-notes}.mjs`.
- **Compact `solve.repository.lib.mjs`** wrap pattern from 4 lines to 3 while
  keeping the destructure form so `eslint-rules/no-direct-gh-exec.mjs` still
  recognizes `wrapDollarWithGhRetry` in scope.

After the fix, all three previously-failing files are at or below 1500 raw
lines (1500 / 1498 / 1500) and `npm run lint` would now reject any
re-introduction of the regression.
