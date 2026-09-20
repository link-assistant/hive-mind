# Case Study: Issue #1897 - use-m npm global prefix EACCES on startup

- Issue: [link-assistant/hive-mind#1897](https://github.com/link-assistant/hive-mind/issues/1897)
- Pull request: [link-assistant/hive-mind#1898](https://github.com/link-assistant/hive-mind/pull/1898)
- Cleanup pull request: [link-assistant/hive-mind#1911](https://github.com/link-assistant/hive-mind/pull/1911)
- Upstream package: [link-foundation/use-m](https://github.com/link-foundation/use-m)
- Upstream issue: https://github.com/link-foundation/use-m/issues/54
- Follow-up cleanup issue: https://github.com/link-assistant/hive-mind/issues/1910
- Evidence excerpt: [original-error-excerpt.txt](./original-error-excerpt.txt)

## Summary

Hive Mind failed before `solve` could load its dependency graph because `use-m`
tried to install `command-stream@latest` with `npm install -g` into a root-owned
system Node global directory:

```text
npm error code EACCES
npm error syscall rename
npm error path /opt/node-v24.16.0-linux-x64/lib/node_modules/command-stream-v-latest
```

The installed Hive Mind path was user-owned under `~/.bun/install/global`, but
the process ran under a system Node whose npm global root was
`/opt/node-v24.16.0-linux-x64/lib/node_modules`. The first `use()` call therefore
crashed with `Error: Failed to install command-stream@latest globally.`

PR #1898 kept users unblocked by routing all real Hive Mind `use-m` bootstraps
through `src/use-m-bootstrap.lib.mjs`, which ran a temporary npm-prefix
workaround before `use-m` could run its npm resolver. After upstream
`use-m@8.13.8` added its own non-writable npm global-root fallback, PR #1911
removed the downstream preflight so Hive Mind no longer duplicates resolver
policy.

## Requirements inventory

From the original issue:

1. Fix the install/startup error shown in the attached log.
2. Preserve the ability to run `solve` after installing Hive Mind globally.
3. Avoid requiring users to run Hive Mind or npm as root.

From the PR discussion:

1. Treat `link-foundation/use-m` as the likely long-term owner.
2. Report the issue upstream with evidence, a workaround, and a proposed
   use-m-side solution.
3. Keep the downstream workaround until upstream `use-m` owns the behavior.
4. Create a Hive Mind follow-up issue to remove the workaround after upstream is
   resolved.
5. Double-check that the workaround does not break previously working startup
   paths.
6. Compile issue data under `docs/case-studies/issue-1897`.
7. Perform deep case-study analysis, including online research.
8. List every requirement from the issue and PR discussion.
9. Propose possible solutions and solution plans for each requirement.
10. Search for existing components/libraries that solve or help solve the
    problem.
11. Apply the change consistently across the repository, not only the original
    `solve` path.
12. Validate with tests and local checks, then verify CI.

## Root cause

`use-m`'s Node resolver installs packages globally with version aliases. The
current upstream source resolves `npm root -g`, constructs an alias path under
that global root, then runs `npm install -g <alias>@npm:<package>@<version>`.
That is reasonable when npm's global prefix is user-writable, but it fails in
environments where Node is installed under a system-owned prefix.

The failing log has the exact shape of npm's documented global-install EACCES
case: npm attempted to rename a directory under a global root that the current
user could not write. npm's own guidance for this class of problem is to use a
version manager or change npm's default directory to a user-owned location. It
also documents that `npm root -g` reports the global package root and that prefix
controls global folder placement.

## Solution options

| Option                                                               | Owner              | Plan                                                                                                                    | Pros                                                                       | Cons                                                                             | Decision                                      |
| -------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| Downstream preflight in Hive Mind                                    | Hive Mind          | Detect non-writable npm global root before `use-m`, set `npm_config_prefix=~/.npm-global`, prepend `~/.npm-global/bin`. | Fixes users immediately; can be tested locally with injected fs/npm mocks. | Duplicates policy that belongs in use-m.                                         | Implemented temporarily, removed by PR #1911. |
| Writable cache/prefix in use-m                                       | use-m              | Before `npm install -g`, test `npm root -g`; if unwritable, use a use-m-owned user prefix/cache for alias installs.     | Fixes all downstream packages and keeps resolver logic in one place.       | Requires upstream release and migration decision.                                | Recommended upstream solution.                |
| Clear upstream error only                                            | use-m              | Detect unwritable global root and throw an actionable error before raw npm EACCES.                                      | Smallest upstream change.                                                  | Users still need manual remediation; downstream CLIs still fail.                 | Acceptable fallback, not preferred.           |
| Replace use-m global npm installs with project-local dynamic imports | use-m or Hive Mind | Avoid `npm install -g`; install/cache packages under an app/user cache and import from there.                           | Avoids global npm prefix entirely.                                         | Larger resolver redesign; more cache invalidation and security review.           | Long-term alternative.                        |
| Vendor all dynamic dependencies                                      | Hive Mind          | Replace `use-m` bootstraps with package dependencies/imports.                                                           | Removes this class of startup failure for Hive Mind.                       | Large architectural change; loses current cross-runtime dynamic-loading pattern. | Out of scope for this bug.                    |

## Temporary downstream coverage

PR #1898 centralized the workaround while upstream support was pending:

- `src/npm-global-prefix.lib.mjs` detects writable/non-writable global npm roots
  and redirects only when needed.
- `src/use-m-bootstrap.lib.mjs` calls the prefix preflight before loading
  `use-m`.
- Direct runtime `use-m` bootstraps in `src/`, `scripts/`, and `do.mjs` route
  through the shared helper.
- `hive.mjs` keeps its existing timeout-wrapped fetch behavior while using the
  shared helper for the prefix preflight.
- The helper respects `npm_config_prefix` and `NPM_CONFIG_PREFIX`, skips
  Windows, and skips Bun/Deno runtimes because the workaround targets the
  Node/npm resolver.

The source-level regression test prevents reintroducing direct
`eval(await fetch('https://unpkg.com/use-m/use.js'))` bootstraps outside the
shared helper.

## Cleanup coverage

PR #1911 removed Hive Mind's local npm-prefix preflight after verifying
`use-m@8.13.8` includes equivalent upstream handling:

- `src/npm-global-prefix.lib.mjs` was deleted.
- `src/use-m-bootstrap.lib.mjs` now only loads the shared upstream `use-m`
  bootstrap.
- `tests/test-npm-global-prefix.mjs` was replaced with
  `tests/test-use-m-bootstrap-no-npm-prefix-workaround.mjs`, which guards
  against reintroducing project-local npm prefix policy.

## Existing components and libraries considered

- npm global prefix configuration: relevant and used. It is the documented
  mechanism for placing global installs under a user-owned directory.
- `npm root -g`: relevant and used as the authoritative path after the cheap
  `process.execPath` heuristic indicates a likely non-writable system prefix.
- Node version managers (`nvm`, `fnm`, Volta): npm's preferred user-facing
  prevention strategy, but not something Hive Mind can assume after installation.
- XDG user cache directories: good upstream use-m design option for alias package
  installs, but too broad for this downstream patch.
- Replacing `use-m`: too broad for issue #1897 and not necessary to unblock the
  reported failure.

## Validation plan

Implemented and run locally for PR #1898:

- `node tests/test-npm-global-prefix.mjs`
- `npm run lint`
- `npm run format:check`
- `npm test`
- `git diff --check`

Still required after push:

- fresh PR CI after push

Implemented and run locally for PR #1911:

- `node tests/test-use-m-bootstrap-no-npm-prefix-workaround.mjs`
- `npm run lint`
- `npm run format:check`
- `npm test`
- `git diff --check`

## Source data

- Original attachment: https://github.com/user-attachments/files/28828561/d8b3067e-6d6c-4907-b4a6-78f42b41ea3b.log
- npm EACCES guidance: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/
- npm `root` command: https://docs.npmjs.com/cli/v10/commands/npm-root/
- npm folders/prefix docs:
  - https://docs.npmjs.com/cli/v10/configuring-npm/folders/
  - https://docs.npmjs.com/cli/v10/using-npm/config#prefix
- use-m repository: https://github.com/link-foundation/use-m
- use-m npm package: https://www.npmjs.com/package/use-m
- Related use-m issue #52: https://github.com/link-foundation/use-m/issues/52
