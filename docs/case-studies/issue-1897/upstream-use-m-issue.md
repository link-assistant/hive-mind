# Detect non-writable npm global prefix before `npm install -g`

Downstream report: https://github.com/link-assistant/hive-mind/issues/1897
Downstream workaround PR: https://github.com/link-assistant/hive-mind/pull/1898

## Problem

`use-m`'s Node/npm resolver installs requested packages globally with aliases,
for example:

```sh
npm install -g command-stream-v-latest@npm:command-stream@latest
```

When Node's global npm prefix points at a system-owned directory, the install can
fail before downstream CLIs load any dependencies. In the downstream Hive Mind
report, the first `use('command-stream')` failed with:

```text
Error: Failed to install command-stream@latest globally.
cause: Command failed: npm install -g command-stream-v-latest@npm:command-stream@latest
npm error code EACCES
npm error syscall rename
npm error path /opt/node-v24.16.0-linux-x64/lib/node_modules/command-stream-v-latest
npm error dest /opt/node-v24.16.0-linux-x64/lib/node_modules/.command-stream-v-latest-zpBoMDat
```

The package had been installed in a user-owned Bun global directory, but it was
launched with a system Node whose npm global root was under `/opt/node-...`.

## Expected behavior

`use-m` should detect that the npm global root or prefix is not writable before
running `npm install -g`, then either:

- redirect its own npm global installs to a user-writable prefix/cache, or
- fail with an actionable error that names the unwritable root and the supported
  override, before the raw npm EACCES stack reaches downstream applications.

The important downstream requirement is that each package using `use-m` should
not have to add its own npm-prefix preflight.

## Current downstream workaround

Hive Mind PR 1898 adds a temporary `ensureUseM()` bootstrap that:

- checks the likely and authoritative npm global `node_modules` path,
- respects existing `npm_config_prefix` and `NPM_CONFIG_PREFIX`,
- skips Windows, Bun runtime, and Deno runtime,
- when the npm global root is not writable, sets `npm_config_prefix` to
  `~/.npm-global` and prepends `~/.npm-global/bin` to `PATH`,
- routes direct `use-m` bootstraps through this helper.

That is a workaround for downstream safety, not the ideal ownership boundary.

## Suggested use-m-side solution

Recommended:

1. Before installing an alias, run `npm root -g` (or otherwise resolve npm's
   target global root) and test whether the current process can write there.
2. If it is writable, keep current behavior.
3. If it is not writable, use a `use-m`-owned user cache/prefix such as
   `~/.cache/use-m/npm-global` or an XDG-compatible equivalent, then run both
   `npm root -g` and `npm install -g` with that prefix in the child process env.
4. Respect an existing configured prefix/env override so users can still opt in
   to their own global location.
5. Include regression tests for non-writable roots and for already-writable or
   user-configured prefixes.

Lower-friction alternative:

- keep using npm's configured global root, but detect non-writable roots and
  throw a clear error with remediation steps before invoking `npm install -g`.

## Related context

- npm's EACCES guidance recommends using a version manager or changing npm's
  default directory to a user-owned location:
  https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/
- `npm root -g` reports the global package installation root:
  https://docs.npmjs.com/cli/v10/commands/npm-root/
- npm folder and prefix behavior:
  https://docs.npmjs.com/cli/v10/configuring-npm/folders/
  https://docs.npmjs.com/cli/v10/using-npm/config#prefix
- Related use-m npm resolver fragility already tracked in:
  https://github.com/link-foundation/use-m/issues/52
