# F5 — Two declared `bin` entries ship non-executable

**Severity:** Medium · **Class:** False negative (a guard existed and was never run)
**Status:** Fixed in `515843e8`.

## Symptom

Found while reproducing F4: `npm link` chmods its bin targets, and the resulting
`git status` showed two files flipping mode:

```
100644 -> 100755  src/cleanup.mjs
100644 -> 100755  src/fix.mjs
```

Both declare `#!/usr/bin/env node` and both are registered in `package.json#bin`, but
neither was committed executable. From a fresh clone:

```
$ ./src/cleanup.mjs
bash: ./src/cleanup.mjs: Permission denied
```

That is the invocation style `release.yml` already uses for the other bins
(`timeout 10s ./src/solve.mjs --help`), so the two were one workflow edit away from
becoming a red release.

## Root cause

A guard did exist — the `build:pre` npm script chmods the bins — and it is **dead code**:
no workflow, no npm lifecycle hook and no other script references it. Its
hand-maintained list had drifted to **5 of the 10 declared bins**.

A dead step that looks like coverage is worse than no step: it is why nobody looked.

## Fix

`build:pre` is regenerated from `package.json#bin` so it cannot drift, and
`tests/test-issue-2198-bin-executable.mjs` pins both halves:

- the modes recorded **in the git index** — not the working tree, which `npm link`
  rewrites, so the test cannot pass by accident on a developer machine that has run
  `npm link`;
- the `build:pre` list staying in sync with the bin map.
