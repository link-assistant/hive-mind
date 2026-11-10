## Summary

`scripts/check-mjs-syntax.sh` checks the syntax of every tracked `.js`, `.mjs` and `.cjs` file, "including shipped examples". The job that runs it (`test-compilation` in `release.yml`) only runs when `detect-changes` reports `js-changed == 'true'`, though, and `scripts/detect-code-changes.mjs` puts `examples/` (and `experiments/`) in `ignoredPathPrefixes` (lines 42-48 at 34415b0).

So a pull request that changes only `examples/basic-usage.js` skips the syntax check, and the pipeline goes green even if the example no longer parses. This is a false negative: the gate exists to cover that file, but it never runs for that change.

## Reproduction

1. On a branch, put a syntax error in `examples/basic-usage.js`, e.g. append `const = ;`.
2. Open a pull request.
3. `Detect Changes` reports `js-changed=false`, `Test Compilation` is skipped, and `Pipeline Status` is green.
4. Locally, `bash scripts/check-mjs-syntax.sh` fails on the same tree.

## Workaround / suggested fix

Make the trigger match what the job checks. Either:

- count `examples/**/*.{js,mjs,cjs}` as JavaScript changes in `detect-code-changes.mjs` (keep `experiments/` ignored if it is also excluded from the syntax check), or
- run `test-compilation` unconditionally; the job takes under 10 seconds.

A test that feeds a single `examples/*.js` path to the detector and expects `js-changed=true` pins it.
