# F8 — secretlint installed on every build, never run

**Severity:** High · **Class:** False negative (dependency mistaken for coverage)
**Status:** Fixed in `b1479a18`.

## Symptom

`secretlint`, `@secretlint/core` and `@secretlint/secretlint-rule-preset-recommend` have
been in `dependencies` since the log sanitizer landed — `src/*.lib.mjs` calls secretlint's
API over solve/hive logs before they are attached to a pull request.

But nothing ever ran secretlint as a **linter** over the repository, and there was no
`.secretlintrc.json`. A credential committed to any tracked file would have passed every
job in "Checks and release".

**The packages always being installed is exactly why the gap was invisible**: their
presence in the dependency tree looks like coverage in every audit that greps for a
scanner. The template does run it, so this was a gap rather than a decision.

## Fix

Fail-closed wiring:

- `.secretlintrc.json` enables the recommended preset;
- `npm run check:secrets` runs it over the whole tree;
- the `lint` job in `release.yml` runs that on every code change.

## What the first blanket scan found

22 findings across 12 files — [`../local/secretlint-before.txt`](../local/secretlint-before.txt).
All fake. Rather than weakening the rules to make them go away:

- `.secretlintignore` exempts **only files whose entire purpose is holding a fake
  secret**: the sanitizer's own test fixtures, the reproducers that found its bugs, and
  archived case-study logs captured with credentials already redacted at capture time.
- The two remaining hits were token-shaped **placeholders** in the coolify docs
  (`ghp_` followed by 36 `x`s, which matches the real GitHub token pattern). Those became
  `ghp_your_github_token_here`, so the files stay in scope and a real token pasted there
  still fails the build.

After: [`../local/secretlint-after.txt`](../local/secretlint-after.txt) — clean.

## Guarding the guard

`tests/secret-scan-2198.test.mjs` runs the real binary and fails if:

- the `check:secrets` step is dropped from the `lint` job, or
- `.secretlintignore` grows a blanket entry or a source-tree entry.

The second assertion matters more than the first. The cheapest way to make a secret scan
pass is to widen its ignore file, and that would recreate this exact finding with a
scanner running.
