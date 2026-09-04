# F1 — The release job dies with `spawn bun ENOENT` (the failure in the issue)

**Severity:** Critical · **Class:** Error (real failure, correctly reported red)
**Status:** Root cause proven experimentally; fixed in `5e918d50`.

## Symptom

Run [33861728465](https://github.com/link-assistant/hive-mind/actions/runs/33861728465)
("Checks and release", default branch, 2026-09-04) failed in the `Release` job. Every
other job in the run was green.

```
> @link-assistant/hive-mind@2.16.0 changeset:version
> changeset version

🦋 changeset v3.0.1

Error: spawn bun ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:287:19)
🦋 Exited with code 1

Error: Command failed with exit code 1: npm run changeset:version
##[error]Process completed with exit code 1.
```

Full excerpt: [`release-failure-excerpt.log.txt`](release-failure-excerpt.log.txt),
sourced from [`../ci-logs/release-job.log`](../ci-logs/release-job.log.gz) lines 2270–2286.

## Root cause

Nothing in this repository asks for `bun`. The spawn comes from inside changesets:

1. `changeset version` rewrites `package.json` and the changelog.
2. `@changesets/cli` 3.x formats what it rewrites through **`@changesets/format`**.
3. `@changesets/format` asks **`package-manager-detector`** which package manager owns
   the workspace, so it can run that manager's own formatter.
4. `package-manager-detector`'s `LOCKS` table maps lockfile names to managers and is
   probed **in insertion order**. `bun.lock` is probed **before** `package-lock.json`.
5. This repository carried a `bun.lock` at the root — added by `5e059ea1`
   (2026-06-19, "chore(docker): pin start-command 0.29.2 + box-dind 2.3.5") — that
   **nothing ever installed from**. Every workflow and every contributor uses npm; the
   file was a leftover.
6. The runner has no `bun` on `PATH`, so the spawn fails with `ENOENT` and changesets
   exits 1.

The detection is therefore not a bug in changesets. It is a correct answer to a
question the repository was answering wrongly: *the root lockfile said bun*.

The reproduction, before and after, is recorded in
[`../local/repro-before-fix.txt`](../local/repro-before-fix.txt) and
[`../local/repro-after-fix.txt`](../local/repro-after-fix.txt).

## Why nothing caught it earlier

The failure needs three things to coincide: a changeset to release, `changeset version`
being reached (which only happens on the default branch), and a runner without bun. PRs
never run `changeset version`, so no pre-merge check could observe it. The lockfile sat
in the tree for two and a half months before a release run met it.

## Fix

Three parts, so that neither half of the cause can return:

- **Remove `bun.lock`.** It described a dependency graph nothing consumed.
- **Declare the manager explicitly** via `devEngines.packageManager` in `package.json`,
  so detection does not depend on which files happen to be on disk.
- **Guard it**: `scripts/check-package-manager.mjs` fails the `lint` job if a foreign
  lockfile reappears or the declaration goes missing, and
  `detect-code-changes.mjs` now counts lockfile changes as package changes so the guard
  cannot be gated out of a run that touches only lockfiles.

Regression test: `tests/test-issue-2198-package-manager-detection.mjs`.

## Alternatives considered

| Option | Verdict |
| --- | --- |
| Install bun on the runner | Makes the symptom disappear while leaving the repository lying about its package manager. A second manager's lockfile then silently drifts. Rejected. |
| Pin `@changesets/cli` to 2.x | Freezes a dependency to avoid stating a fact about the repository. Rejected. |
| `packageManager` (corepack field) | Also read by `package-manager-detector`, but corepack would then want to *provision* npm. `devEngines.packageManager` states the requirement without changing how npm is obtained. Chosen. |
