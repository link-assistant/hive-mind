# Issue 1814 Case Study: Adopt lino-i18n

Issue: https://github.com/link-assistant/hive-mind/issues/1814

Pull request: https://github.com/link-assistant/hive-mind/pull/1816

## Problem

Hive Mind already stored translations in `.lino` files, but `src/i18n.lib.mjs`
implemented its own loader by parsing each file with `lino-objects-codec` and
treating the result as a flat key/value object. That path only worked for flat
catalogues such as `telegram.solve_disabled "..."`.

The requested target, `link-foundation/lino-i18n`, supports the catalogue style
the issue asked us to prefer:

- nested authoring blocks, for example `telegram` followed by indented keys;
- quoted multiline strings with `"""`;
- runtime flattening back to existing dotted keys;
- interpolation and fallback semantics.

## Requirements

1. Replace Hive Mind's custom i18n loading/runtime implementation with
   `lino-i18n`.
2. Add `lino-i18n` as a project dependency.
3. Prefer nested `.lino` examples and multiline quoted strings like the
   `link-foundation/lino-i18n` README.
4. Preserve all existing translation keys and user-visible translations.
5. Report missing `lino-i18n` capabilities upstream if Hive Mind cannot be
   fully implemented with the library.
6. Collect issue-related data under `docs/case-studies/issue-1814`.
7. Analyze requirements, related work, available libraries, and solution plans.
8. Implement and verify the solution in PR 1816.

## Research

Raw research data is stored in [data](data/):

- [issue-1814.json](data/issue-1814.json)
- [issue-1814-comments.json](data/issue-1814-comments.json)
- [pr-1816.json](data/pr-1816.json)
- [related-i18n-prs.json](data/related-i18n-prs.json)
- [lino-i18n-repo.json](data/lino-i18n-repo.json)
- [lino-i18n-readme.md](data/lino-i18n-readme.md)
- [lino-i18n-js-readme.md](data/lino-i18n-js-readme.md)
- [lino-i18n-js-package.json](data/lino-i18n-js-package.json)
- [lino-i18n-latest-release.json](data/lino-i18n-latest-release.json)
- [npm-lino-i18n.json](data/npm-lino-i18n.json)

Relevant primary sources:

- `link-foundation/lino-i18n`: https://github.com/link-foundation/lino-i18n
- JavaScript package README: https://github.com/link-foundation/lino-i18n/tree/main/js
- npm package `lino-i18n`: https://www.npmjs.com/package/lino-i18n
- Latest release observed during implementation: `js-v0.0.1`, published
  2026-05-16.

Related Hive Mind work:

- PR 384 introduced the original Hive Mind i18n layer.
- PR 676 expanded Telegram command localization.
- PR 1789 completed localized bot output fallbacks.

## Root Cause

The old loader converted only top-level parsed values into strings. Once a
catalogue used nested `.lino` blocks, nested objects were not flattened into
runtime keys. The focused reproduction in
[test-logs/before-fix-i18n.log](test-logs/before-fix-i18n.log) shows existing
translations resolving to raw keys after the locale files were converted to
nested authoring.

## Options Considered

### Option 1: Keep the Custom Loader

This would require implementing nested tree flattening, multiline parsing,
plural/context suffix behavior, and ongoing compatibility with `.lino`
catalogue conventions. It conflicts with the issue because Hive Mind would keep
owning a parallel i18n implementation.

### Option 2: Use only `lino-i18n` Format Helpers

This would convert files to a nicer shape but keep Hive Mind's custom runtime.
It reduces some authoring pain but still leaves interpolation, fallback, and key
resolution duplicated locally.

### Option 3: Use `lino-i18n` Loader and Runtime

This installs `lino-i18n`, loads `.lino` files through `loadLocalesFromFile`,
and resolves translations through `createI18n`. Hive Mind keeps its existing
public wrapper API (`initI18n`, `t`, locale tracks, Telegram per-user locale
store) while delegating catalogue parsing and key lookup to the library.

This is the implemented option.

## Implementation Notes

- Added `lino-i18n` to `dependencies`.
- Updated `src/i18n.lib.mjs` to use `lino-i18n/loaders` and `createI18n`.
- Converted locale files to nested `.lino` where possible.
- Kept `error.*`, `success.*`, `warning.*`, and `info.*` flat because each
  family also has a direct parent label (`error`, `success`, `warning`,
  `info`). A single nested node cannot be both a string and an object, so this
  hybrid shape preserves every existing runtime key while still preferring
  nested blocks for representable groups.
- Converted multiline values to `"""` blocks.
- Updated `examples/test-i18n.mjs` to use the current i18n public API.
- Added tests that verify nested keys, multiline values, and locale key-set
  parity.

No upstream `lino-i18n` issue was opened. The library has enough functionality
to implement Hive Mind's current translations; the only shape conflict is
representable with flat keys for the affected families.

## Verification

Logs are stored under [test-logs](test-logs/):

- `before-fix-i18n.log`: focused i18n reproduction failed with the custom
  loader.
- `after-fix-i18n.log`: focused i18n tests passed after adopting `lino-i18n`.
- `after-fix-focused.log`: i18n, Telegram UI, version, limits, and queue tests
  passed.
- `example-i18n.log`: the i18n example script ran successfully.
- `lint.log`: `npm run lint` passed.
- `format-check.log`: `npm run format:check` passed.
- `docs-validation.log`: `node tests/docs-validation.mjs` passed.
- `check-file-line-limits.log`: `bash scripts/check-file-line-limits.sh`
  passed with warnings only for pre-existing near-limit files.
- `npm-test.log`: `npm test` passed with all 212 selected test files.

`npm install` emitted engine warnings because the local shell used Node
v20.20.2 while this repository and `lino-i18n` declare Node >=24. The full local
test suite passed in the same environment after the dependency update.
