## Summary

Since the Rust stage was gated behind JavaScript (412f49807, 2026-10-10), **no Rust release can land**. Every `Rust CI/CD / Auto Release` run:

1. bumps `rust/Cargo.toml` 0.23.0 → 0.24.0 locally and commits `rust-v0.24.0`,
2. has the push rejected by ruleset 24848039 _"JavaScript first and Rust parity on main"_,
3. still logs `✅ Version bump committed and pushed to main`,
4. finds `start-command@0.24.0` already on crates.io (published 2026-10-10T18:58Z), skips publishing, and ends **green**.

As a result, the Rust changelog fragments `rust/changelog.d/204.md`, `208.md` (the Rust half of the #205/#206 CPU penalty fixes, PR #208) and `210.md` (#209 OOM attribution, PR #210) never ship. `rust/Cargo.toml` on `main` is still `version = "0.23.0"`. crates.io's newest version is 0.24.0, which predates #208 and #210. The JavaScript package is fine (npm 0.37.2 has all of them).

Found while verifying start-command for link-assistant/hive-mind#2801 (Docker CPU penalty; PR link-assistant/hive-mind#2802).

## Evidence

The same lines appear in runs [38077619981](https://github.com/link-foundation/start/actions/runs/38077619981) (0.37.0, 348ad41c2), [38142394108](https://github.com/link-foundation/start/actions/runs/38142394108) (0.37.1, e758515fc) and [38263164479](https://github.com/link-foundation/start/actions/runs/38263164479) (0.37.2, 176b6f9f5). From 38263164479:

```
Rust CI/CD / Auto Release  Output: should_release=true
Rust CI/CD / Auto Release  Output: skip_bump=false
Rust CI/CD / Auto Release  remote: error: GH013: Repository rule violations found for refs/heads/main.
Rust CI/CD / Auto Release  - 2 of 2 required status checks are expected.
Rust CI/CD / Auto Release  ! [remote rejected] main -> main (push declined due to repository rule violations)
Rust CI/CD / Auto Release  error: failed to push some refs to 'https://github.com/link-foundation/start'
Rust CI/CD / Auto Release  ✅ Version bump committed and pushed to main
Rust CI/CD / Auto Release  start-command@0.24.0 is already published to crates.io
Rust CI/CD / Auto Release  publish_result=already_published
Rust CI/CD / Auto Release  GitHub release already exists: rust-v0.24.0 ([Rust] 0.24.0)
```

## Root cause

There are two independent defects.

### 1. The Rust writer job checks out with `GITHUB_TOKEN`, not the release deploy key

Ruleset 24848039 requires the `JavaScript Stage` and `Rust CI/CD / Rust Stage` checks on `main`. Its only bypass actor is `DeployKey`. `START_RELEASE_SSH_KEY` is an environment secret of `release-main`: `gh api repos/link-foundation/start/environments/release-main/secrets` lists it, and the repository has no repo-level secrets.

- In `js.yml` → `Release`, the checkout gets the key and pushes over SSH:
  ```
  Release  ssh-key: ***
  Release  git remote add origin git@github.com:link-foundation/start.git
  ```
- In `rust.yml` → `Auto Release`, the job also declares `environment: release-main` and `ssh-key: ${{ secrets.START_RELEASE_SSH_KEY }}`, but the input arrives empty. The checkout `with:` block shows only `token: ***` and no `ssh-key`. The remote is `https://github.com/link-foundation/start`, so the push uses `GITHUB_TOKEN`, which cannot bypass the ruleset.

`rust.yml` declares `START_RELEASE_SSH_KEY` under `on.workflow_call.secrets`, with the comment "Obtained from release-main only, rather than passed by the caller". The caller (`js.yml` → `rust-stage`) passes only `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN`. In the logs, `secrets.START_RELEASE_SSH_KEY` resolves to the caller-provided (absent) value, not to the `release-main` environment secret. The same applies to `manual-release`.

### 2. A failed `git push` is reported as success

`scripts/version-and-commit.mjs`:

```js
await $`git commit -m ${commitMessage}`;
// Push directly to main
await $`git push origin main`;
console.log('✅ Version bump committed and pushed to main');
setOutput('version_committed', 'true');
```

command-stream's `$` does not throw on a non-zero exit code by default. The rejected push falls through to the success message and `version_committed=true`. The self-healing check against crates.io then hides the problem by turning the run green. The same pattern may exist in the JS path. It only works there because the deploy key bypasses the ruleset.

## Proposed fix

1. Make the Rust writer jobs actually receive the deploy key. Pick whichever works with GitHub's reusable-workflow secret resolution:
   - Remove `START_RELEASE_SSH_KEY` from `on.workflow_call.secrets`, so the job-level `environment: release-main` secret is the one that resolves.
   - Or run the Rust release job from `js.yml` itself, as a non-reusable job with `environment: release-main`, after `rust-stage` succeeds.
2. Fail closed. Check the exit code of every `git commit`, `git push` and `git push --tags` in the release scripts (e.g. `const r = await $\`git push origin main\`; if (r.code !== 0) throw …`, or enable command-stream's errexit). Add a regression test with a remote that rejects the push.
3. Add a guard to the Rust release job. When `should_release=true` and the bump step ran, verify `git ls-remote origin main` points at the new commit before publishing. Fail the run if `rust/changelog.d/*.md` fragments remain on `main` after a release run.
4. Once fixed, the next run should release **0.25.0** (minor, from 204.md) containing 204/208/210. Don't reuse 0.24.0, which is already on crates.io from an older tree.

## Acceptance criteria

- [ ] A push to `main` with pending `rust/changelog.d` fragments produces a `rust-vX.Y.Z` commit on `main`, a crates.io release and a `[Rust] X.Y.Z` GitHub release.
- [ ] The crates.io `start-command` release includes the #205/#206 (PR #208) and #209 (PR #210) fixes, giving parity with npm 0.37.2.
- [ ] A rejected push fails the job (red), instead of logging `✅ … pushed to main`.
