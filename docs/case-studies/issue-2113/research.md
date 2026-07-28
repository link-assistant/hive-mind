# Research

## Upstream use-m

- [use-m issue #66](https://github.com/link-foundation/use-m/issues/66) already
  tracks the underlying design problem: global installs are not retried and
  corrupt alias directories remain sticky. Issue #2113 adds a fourth concrete
  corrupt-tree signature: a wrapped `ERR_MODULE_NOT_FOUND` for an internal file.
  The exact evidence, reproduction, guard, and suggested fix were added in
  [this upstream report](https://github.com/link-foundation/use-m/issues/66#issuecomment-5107282485).
- use-m 8.14.2 installs npm aliases such as
  `command-stream-v-latest@npm:command-stream@latest`, then dynamically imports
  the resolved entry point. Hive Mind's shared wrapper remains an appropriate
  downstream workaround until upstream owns install validation and recovery.

## Node.js

- [Node's ESM documentation](https://nodejs.org/api/esm.html) says file URLs are
  resolved as modules and a nonexistent resolved file produces Module Not
  Found. This matches the missing relative `terminal-capture.mjs` evidence.
- The same documentation states ESM has a separate cache from `require.cache`
  and that query-string variants load as distinct modules. That supports the
  existing cache-busting recovery retained from issue #2092.

## npm

- [npm install documentation](https://docs.npmjs.com/cli/install/) confirms an
  install includes a package and its dependencies, and global mode writes under
  the configured prefix.
- [npm package-spec documentation](https://docs.npmjs.com/cli/v11/using-npm/package-spec/)
  defines `<alias>@npm:<name>` as the alias syntax reified in `node_modules`,
  matching use-m's versioned alias layout.

## Related Hive Mind work

- PR #2093 is the closest implementation: it centralized recovery at the loader,
  removed whole aliases, retried transient installs, and handled ESM caching.
- PR #1725 pre-installs use-m packages with retry to avoid concurrent CI install
  races. It reduces exposure but cannot replace runtime self-healing.
- Issues #1710 and #1712 supplied the original corruption classifier.
