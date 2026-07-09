# Case Study — Issue #2028: False-positive release from a swallowed npm publish failure

- **Issue:** [link-assistant/hive-mind#2028](https://github.com/link-assistant/hive-mind/issues/2028)
- **Failing CI run:** [Actions run 29035249489](https://github.com/link-assistant/hive-mind/actions/runs/29035249489)
- **PR with the fix:** [#2030](https://github.com/link-assistant/hive-mind/pull/2030)
- **Date of failure:** 2026-07-09
- **Affected version:** `@link-assistant/hive-mind@2.1.10`

## TL;DR

The release job reported a **successful publish that never happened**. `npm publish`
crashed (npm 12.0.0 sigstore regression), `changeset publish` printed
`packages failed to publish`, yet `scripts/publish-to-npm.mjs` set
`published=true` and `published_version=2.1.10`. The four downstream Docker jobs
then waited 300 seconds each for a version that was never on npm and failed.

Three defects combined to turn one environmental error into a green-but-broken
release:

1. **False root cause** — `scripts/setup-npm.mjs` ran `npm install -g npm@latest`,
   which installed **npm 12.0.0**. npm 12.0.0 has a regression
   ([npm/cli#9722](https://github.com/npm/cli/issues/9722)): `npm publish --provenance`
   crashes with `Cannot find module 'sigstore'` (`MODULE_NOT_FOUND`).
2. **False positive / false negative** — `scripts/publish-to-npm.mjs` treated the
   absence of a thrown error as success. It used the `command-stream` `$` helper,
   which **does not throw on a non-zero exit code**, and `changeset publish`
   additionally masks the underlying npm exit code. So a failed publish was
   reported as a successful one.
3. **A warning nobody actioned** — every npm call printed
   `npm warn Unknown user config "always-auth"` because `actions/setup-node`
   writes a deprecated `always-auth` key that npm 11+ no longer recognises.

## Timeline of the failing run (run 29035249489)

All timestamps UTC, from
[`ci-run-29035249489-excerpt.log`](./ci-run-29035249489-excerpt.log)
(full log: [`ci-run-29035249489-full.log.gz`](./ci-run-29035249489-full.log.gz)).

| Time        | Job / Step           | Event                                                                                             |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| 17:09:25    | Release → Update npm | `Current npm version: 11.16.0`                                                                    |
| 17:09:31    | Release → Update npm | `Updated npm version: 12.0.0` ← **installed the broken npm**                                      |
| 17:09:41    | Release → Publish    | `Version 2.1.10 not found on npm, proceeding with publish...`                                     |
| 17:09:41    | Release → Publish    | `npm warn Unknown user config "always-auth"...`                                                   |
| 17:09:42    | Release → Publish    | `error ... MODULE_NOT_FOUND Cannot find module 'sigstore'` (in `libnpmpublish/lib/provenance.js`) |
| 17:09:42    | Release → Publish    | `packages failed to publish: @link-assistant/hive-mind@2.1.10`                                    |
| 17:09:42    | Release → Publish    | `Setting GitHub output: published=true` ← **FALSE POSITIVE**                                      |
| 17:09:42    | Release → Publish    | `Published @link-assistant/hive-mind@2.1.10 to npm` (it was not)                                  |
| 17:15–17:16 | Docker Publish ×4    | `Package @link-assistant/hive-mind@2.1.10 did not become available after 300 seconds`             |

The Release job went **green**. The failure only surfaced 6 minutes later, in the
Docker jobs, as an opaque 5-minute timeout with no hint of the real cause.

## Root-cause analysis

### 1. npm 12.0.0 sigstore regression (the trigger)

`node-version: '24.x'` ships npm 11.x, which works. The release workflow then ran
`setup-npm.mjs`, whose only job is to ensure npm supports OIDC trusted
publishing (needs npm ≥ 11.5.1). It did so with:

```js
await $`npm install -g npm@latest`;
```

On 2026-07-09 `npm@latest` was **12.0.0**. npm 12.0.0 fails to bundle the
`sigstore` module used by `libnpmpublish` for provenance, so any
`npm publish --provenance` (which is what changeset does under trusted
publishing) crashes:

```
npm error code MODULE_NOT_FOUND
npm error Cannot find module 'sigstore'
npm error Require stack:
npm error - .../npm/node_modules/libnpmpublish/lib/provenance.js
```

This is tracked upstream as [npm/cli#9722](https://github.com/npm/cli/issues/9722).
`npm@11` (11.18.0 at the time) is unaffected.

**Using `@latest` for a tool that gates releases is the underlying design flaw:**
it opts the pipeline into every upstream regression the day it ships.

### 2. `command-stream` `$` never throws → the failure was swallowed

The publish script relied on `try/catch` around the `command-stream` `$` helper:

```js
try {
  await $`npm run changeset:publish`; // never throws on non-zero exit
  setOutput('published', 'true'); // ...so this always runs
  return;
} catch (_error) {
  /* never reached */
}
```

`command-stream`'s `$` resolves with `{ code, stdout, stderr }` on failure
instead of throwing (documented in this repo under
[`docs/dependencies-research/command-stream-issues/`](../../dependencies-research/command-stream-issues/),
e.g. issue-10 "git push silent failure"). The `catch` was dead code.

Worse, even a script that checked the exit code would have been fooled here:
`changeset publish` caught npm's crash and **still exited 0** while printing
`packages failed to publish`. So exit-code checking alone is insufficient — the
output must also be scanned.

This is the classic **false-positive / false-negative** the issue asks about: a
real failure (false negative — the failure was not detected) reported as success
(false positive — a green release that did not release anything).

### 3. `always-auth` deprecation warning

`actions/setup-node@v5` with `registry-url` writes `always-auth` into
`~/.npmrc`. npm 11+ dropped that config key, so every npm invocation in the
release job logged:

```
npm warn Unknown user config "always-auth". This will stop working in the next
major version of npm.
```

Benign, but it is exactly the kind of noise the issue asks us to eliminate, and
it clutters the logs where the real error needed to be visible.

## The fix

All changes are in PR #2030. They port already-vetted patterns from the
`link-foundation/*-ai-driven-development-pipeline-template` repositories, which
had already fixed both bugs.

### `scripts/setup-npm.mjs` — pin npm 11 and validate

- Install `npm@11` instead of `npm@latest`, so the pipeline can never pick up the
  npm 12 sigstore regression.
- Skip the upgrade entirely when the runner already has a supported npm.
- After installing, **validate** the resulting version is ≥ 11.5.1 and < 12.0.0,
  failing loudly here rather than silently three steps later.
- Version comparison helpers (`parseVersion`, `compareVersions`,
  `isVersionAtLeast`, `isSupportedNpmVersion`) are exported and unit-tested.

### `scripts/publish-to-npm.mjs` — never report an unverified success

- Run commands via `child_process.spawn` so the **real exit code is always
  observed** (mirrors `scripts/npm-install-with-retry.mjs` from issue #1903).
- **Multi-layer failure detection** (`analyzePublishResult`): a publish counts as
  success only if the command exited 0 **and** the combined output contains no
  known failure pattern.
- **Post-publish verification**: after a "successful" publish, query the registry
  (`npm view <pkg>@<version>`) and only then set `published=true`. This is the
  last line of defence against a false-positive release.
- **Fast-fail** non-retryable auth/registry errors (E401/E403/E404/ENEEDAUTH)
  with actionable guidance instead of three pointless retries.

### `scripts/publish-failure-classifier.mjs` — new, shared classifier

`FAILURE_PATTERNS` (including `cannot find module` / `module_not_found` to catch
the sigstore crash), `detectPublishFailure`, `NON_RETRYABLE_PATTERNS`,
`isNonRetryableFailure`, and `buildAuthFailureGuidance`.

### `scripts/sanitize-npm-userconfig.mjs` — new, removes the warning

Strips the deprecated `always-auth` key from `~/.npmrc`. Wired into the release
workflow right after the npm upgrade, in both publish jobs.

### Tests

- `tests/test-publish-failure-classifier-2028.mjs`
- `tests/test-publish-to-npm-2028.mjs` — reproduces the exact false-positive
  (exit 0 + `packages failed to publish`) and asserts it is now caught.
- `tests/test-setup-npm-2028.mjs` — asserts npm 12.x is rejected and npm 11 is
  pinned.
- `tests/test-sanitize-npm-userconfig-2028.mjs`

All runners are mocked, so the tests never touch the network, npm, or git.

## Requirements traceability (from the issue)

| Requirement                                                         | Where addressed                                                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Find & fix false positives / negatives / warnings / errors in CI/CD | `publish-to-npm.mjs` (false positive/negative), `setup-npm.mjs` (error trigger), `sanitize-npm-userconfig.mjs` (warning)                                                                   |
| Apply across the entire codebase                                    | Both release-job publish paths in `.github/workflows/release.yml` use the fixed scripts; shared classifier reused                                                                          |
| Compare with the 4 pipeline templates & reuse best practices        | Ported `setup-npm`, `publish-to-npm`, `publish-failure-classifier`, `sanitize-npm-userconfig` patterns from `link-foundation/js-ai-driven-development-pipeline-template`                   |
| Report the same issue to templates if present                       | The templates **already** contain these fixes, so no upstream report is needed. The upstream trigger is reported at [npm/cli#9722](https://github.com/npm/cli/issues/9722) (pre-existing). |
| Download logs/data + deep case study                                | This directory (`README.md`, excerpt, gzipped full log)                                                                                                                                    |
| Root cause of each problem                                          | See "Root-cause analysis" above                                                                                                                                                            |
| Add debug/verbose output if data is insufficient                    | Not needed — root cause was fully determined from the logs. The new scripts additionally log the detected failure pattern and post-publish verification result for future runs.            |
| Related to other GitHub repos → file issues                         | Trigger is upstream `npm/cli` (already tracked as #9722); `command-stream` silent-failure is already documented in this repo's `docs/dependencies-research/`.                              |

## Lessons / systemic notes

- **Never `@latest` a release-gating tool.** Pin the major line and validate.
- **`command-stream` `$` does not throw on non-zero exit.** Any script that
  branches on success must check `result.code` (via `.run({ capture: true })`)
  or use `spawn`. This is a repo-wide footgun worth auditing beyond this script.
- **A publish is not confirmed until the registry confirms it.** Verify
  after publishing; do not trust the publish command's own success signal.

## References

- [npm/cli#9722 — npm 12.0.0 `Cannot find module 'sigstore'` on publish --provenance](https://github.com/npm/cli/issues/9722)
- [npm trusted publishers docs](https://docs.npmjs.com/trusted-publishers)
- Repo: `docs/dependencies-research/command-stream-issues/` (silent non-zero exit)
- Repo: `scripts/npm-install-with-retry.mjs` (issue #1903 — spawn + exit-code pattern reused here)
