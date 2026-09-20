# F21 — The `tests/` tree was never linted (false negative)

**Severity:** Medium · **Class:** False negative (a green lint job that never read the largest source tree)

## The gap

Both definitions of "what gets linted" agreed with each other, and both were wrong:

```jsonc
// package.json
"lint": "eslint 'src/**/*.{js,mjs,cjs}' 'scripts/**/*.{js,mjs,cjs}' 'eslint-rules/**/*.{js,mjs,cjs}'"
```

```js
// eslint.config.mjs
files: ['src/**/*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}', 'eslint-rules/**/*.{js,mjs,cjs}'],
```

`tests/` — 340 files, the largest `.mjs` tree in the repository — appears in neither.
The `lint` job in `release.yml` therefore reported success on every push while never
having read a single test file.

This is the same shape as F3: a check whose green result carries no signal over the
code it was assumed to cover.

## What it was hiding

Turning the glob on surfaced real defects across 59 files, not style noise:

| Defect                                                            | Example                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `assert.match` regexes with unescaped literal indentation         | `tests/test-i18n.mjs` — `/\n    solve\n/` instead of `/\n {4}solve\n/` |
| A `catch` that discarded the original error                       | `tests/test-hive.mjs` — `throw new Error(...)` with no `{ cause }`     |
| Unused bindings, including unused imports of functions under test | `tests/test-opus-47-model-support.mjs`, `tests/version-info.test.mjs`  |

The regex cases matter most. `no-regex-spaces` flags runs of literal spaces precisely
because they are easy to miscount and impossible to read; an `assert.match` whose
pattern is subtly wrong is an assertion that passes for the wrong reason.

## Why CI could not have caught it

Nothing in the workflow was broken — the job did exactly what it was configured to do.
The failure is in the configuration itself, which is why no amount of log-reading finds
it. It is only visible by comparing "what CI lints" against "what the repository
contains".

## Fix

Add `tests/**/*.{js,mjs,cjs}` to both the npm script and the config `files` entry, and
fix the defects the glob exposed.

The two definitions must be kept in agreement: CI invokes `npm run lint`, while
`--fix` and editor integrations resolve `eslint.config.mjs`. If they drift, one of the
two is lying about what is checked. `tests/lint-covers-tests-2082.test.mjs` pins both,
and asserts the glob is non-vacuous (a glob matching nothing would satisfy every other
assertion while checking no code).

## Verification

Both halves of the contract test were mutation-checked — the assertion was confirmed to
fail when the tree is removed from `package.json`, and again, independently, when it is
removed from `eslint.config.mjs`.

Change detection needed no workflow edit: `scripts/detect-code-changes.mjs` sets
`mjs-changed` from `file.endsWith('.mjs')` with no path restriction, so edits under
`tests/` already trigger the `lint` job.

Full default suite (340 files) re-run after the change: no regressions.
