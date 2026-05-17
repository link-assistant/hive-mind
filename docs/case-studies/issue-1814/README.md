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
4. Reduce duplication in all existing translation strings with deeper nested
   grouping, including unlimited-depth nesting where it makes the catalogue
   clearer.
5. Preserve all existing translation keys and user-visible translations.
6. Report missing `lino-i18n` capabilities upstream if Hive Mind cannot be
   fully implemented with the library.
7. Collect issue-related data under `docs/case-studies/issue-1814`.
8. Analyze requirements, related work, available libraries, and solution plans.
9. Implement and verify the solution in PR 1816.

## Research

Raw research data is stored in [data](data/):

- [issue-1814.json](data/issue-1814.json)
- [issue-1814-comments.json](data/issue-1814-comments.json)
- [pr-1816.json](data/pr-1816.json)
- [pr-1816-comments.json](data/pr-1816-comments.json)
- [pr-1816-review-comments.json](data/pr-1816-review-comments.json)
- [pr-1816-reviews.json](data/pr-1816-reviews.json)
- [related-i18n-prs.json](data/related-i18n-prs.json)
- [lino-i18n-repo.json](data/lino-i18n-repo.json)
- [lino-i18n-readme.md](data/lino-i18n-readme.md)
- [lino-i18n-js-readme.md](data/lino-i18n-js-readme.md)
- [lino-i18n-js-package.json](data/lino-i18n-js-package.json)
- [lino-i18n-latest-release.json](data/lino-i18n-latest-release.json)
- [npm-lino-i18n.json](data/npm-lino-i18n.json)
- [lino-i18n-upstream-reports.json](data/lino-i18n-upstream-reports.json)

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
runtime keys. A focused reproduction showed existing translations resolving to
raw keys after the locale files were converted to nested authoring.

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
- Converted every locale catalogue to deeper nested `.lino` blocks, including
  mixed parent-label families such as `error`, `success`, `warning`, and
  `info`.
- Represented mixed scalar/object nodes with a nested `label` child, then added
  runtime compatibility aliases so existing keys such as `error`,
  `error.invalid_github_url`, and `telegram.help_title` still resolve.
- Added collapse-tail compatibility aliases for underscore-based legacy keys,
  so canonical nested keys such as `telegram.help.solve.alias.detail` also
  resolve through the old `telegram.help_solve_alias_detail` shape.
- Converted multiline values to `"""` blocks.
- Updated `examples/test-i18n.mjs` to use the current i18n public API.
- Added tests that verify nested keys, deeper grouping, multiline values,
  compatibility aliases, and locale key-set parity.

After review feedback requested upstream follow-up before merge, three
`lino-i18n` issues were opened from the Hive Mind migration experience:

- [link-foundation/lino-i18n#10](https://github.com/link-foundation/lino-i18n/issues/10):
  preserve scalar parent translations when a key is both a label and a
  namespace for deeper children.
- [link-foundation/lino-i18n#11](https://github.com/link-foundation/lino-i18n/issues/11):
  provide migration aliases for old underscore-tail keys when catalogues are
  rewritten with deeper nesting.
- [link-foundation/lino-i18n#12](https://github.com/link-foundation/lino-i18n/issues/12):
  add a real-world deeply nested Hive Mind-style catalogue example to the
  default documentation/tests.

Until those upstream improvements exist, Hive Mind keeps a small local
compatibility layer so existing public keys such as `error`,
`telegram.help_title`, and `telegram.help_solve_alias_detail` continue to
resolve while the source catalogues use deeper `.lino` groups.

## Verification

Verification commands were captured in local implementation logs and produced
these results:

- Focused i18n reproduction failed before replacing the custom loader, then
  `node tests/test-i18n.mjs` passed after adopting `lino-i18n`.
- A deeper-nesting regression test failed before applying the PR feedback, then
  `node tests/test-i18n.mjs` passed after converting all locale catalogues and
  adding compatibility aliases.
- A legacy-key compatibility check confirmed every pre-change runtime key still
  exists in the expanded current translations for `en`, `ru`, `zh`, and `hi`.
- Focused regression coverage passed for i18n, Telegram UI, version, limits,
  queue display, and solve queue behavior.
- `node examples/test-i18n.mjs` ran successfully.
- `npm run lint` passed.
- `npm run format:check` passed.
- `node tests/docs-validation.mjs` passed.
- `bash scripts/check-file-line-limits.sh` passed with warnings only for
  pre-existing near-limit files.
- `npm test` passed with all 212 selected test files.

`npm install` emitted engine warnings because the local shell used Node
v20.20.2 while this repository and `lino-i18n` declare Node >=24. The full local
test suite passed in the same environment after the dependency update.
