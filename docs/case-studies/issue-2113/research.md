# Research

## Upstream use-m

- [use-m issue #66](https://github.com/link-foundation/use-m/issues/66) already
  tracked the underlying design problem: global installs were not retried and
  corrupt alias directories remained sticky. Issue #2113 added a fourth concrete
  corrupt-tree signature: a wrapped `ERR_MODULE_NOT_FOUND` for an internal file.
  The exact evidence, reproduction, guard, and suggested fix were added in
  [this upstream report](https://github.com/link-foundation/use-m/issues/66#issuecomment-5107282485).
- [use-m PR #67](https://github.com/link-foundation/use-m/pull/67) merged at
  19:26 UTC and `use-m@8.14.3` was published at 19:28 UTC. It added install
  retries, corrupt-alias repair, and cache-busted recovery.
- The supplied 20:04 UTC run confirms 8.14.3 reached its new repair path, then
  failed with `ENOTEMPTY` because `removePackageAlias()` used recursive `rm`
  without `maxRetries`. The follow-up is reported as
  [use-m #68](https://github.com/link-foundation/use-m/issues/68).
- [use-m #68](https://github.com/link-foundation/use-m/issues/68) was closed on
  2026-07-30 at 06:38:13 UTC and `use-m@8.14.4` was published at 06:39:50 UTC.
  A tarball diff of 8.14.3 against 8.14.4 shows the suggested
  `maxRetries: 5` / `retryDelay: 100` applied to `removePackageAlias()` in all
  six bundled entry points (`src/use.{mjs,cjs,js}` and `use.{mjs,cjs,js}`), with
  no other behavioral change. Both upstream reports raised from this issue are
  now fixed and released.
- Reading the 8.14.4 source shows its recovery is narrower than its release
  notes suggest: repair is skipped for specifiers with a subpath
  (`if (options?.repair || modulePath) throw error;`), import repair runs once
  per call, and `isPackageInstalled()` treats any existing directory as a valid
  install. These gaps are why the downstream wrapper is retained.
- use-m installs npm aliases such as
  `command-stream-v-latest@npm:command-stream@latest`, then dynamically imports
  the resolved entry point. Hive Mind's narrow shared wrapper remains a
  downstream defense for older versions and cleanup failures.
- Version availability was checked directly against the registry and the CDN:
  `npm view use-m dist-tags` reports `latest: 8.14.4`, and
  `https://unpkg.com/use-m@8.14.4/use.js` serves HTTP 200 with the retry budget
  present. The previously pinned `https://unpkg.com/use-m@8.13.8/use.js` bundle
  contains no `removePackageAlias` at all.

## command-stream

- The current release is `command-stream@0.17.2`, published on 2026-07-26 and
  matching repository tag `js-v0.17.2`.
- `npm pack command-stream@0.17.2 --dry-run --json` reports 466 entries and the
  registry integrity recorded in `raw/dependency-audit.json`. The tarball
  includes the 12,555-byte `src/$.mjs`, 1,439-byte `src/$.trace.mjs`, and
  13,500-byte `src/terminal-capture.mjs`.
- The two production aliases were missing different members of that complete
  set. Pinning an older command-stream cannot prevent an interrupted or
  concurrently-mutated alias, so no command-stream defect was reported.

## Node.js

- [Node's ESM documentation](https://nodejs.org/api/esm.html) says file URLs are
  resolved as modules and a nonexistent resolved file produces Module Not
  Found. This matches the missing relative `terminal-capture.mjs` evidence.
- The same documentation states ESM has a separate cache from `require.cache`
  and that query-string variants load as distinct modules. That supports the
  existing cache-busting recovery retained from issue #2092.
- [Node's `fsPromises.rm` documentation](https://nodejs.org/api/fs.html#fspromisesrmpath-options)
  explicitly lists `ENOTEMPTY`, `EBUSY`, `EMFILE`, `ENFILE`, and `EPERM` as
  retryable during recursive removal. `maxRetries` defaults to zero and
  `retryDelay` defaults to 100 ms. The selected five-retry budget uses this
  platform-supported mechanism.
- Node's promise-based filesystem documentation also warns that concurrent
  modifications are not synchronized. The cleanup stress experiment models
  that condition directly.

## npm

- [npm install documentation](https://docs.npmjs.com/cli/install/) confirms an
  install includes a package and its dependencies, and global mode writes under
  the configured prefix.
- [npm package-spec documentation](https://docs.npmjs.com/cli/v11/using-npm/package-spec/)
  defines `<alias>@npm:<name>` as the alias syntax reified in `node_modules`,
  matching use-m's versioned alias layout.
- [npm pack documentation](https://docs.npmjs.com/cli/v11/commands/npm-pack)
  defines `--dry-run` as a no-change report of what pack/publish would include.
  This makes the registry tarball inventory appropriate evidence when checking
  whether command-stream omitted either missing module.

## Related Hive Mind work

- PR #2093 is the closest implementation: it centralized recovery at the loader,
  removed whole aliases, retried transient installs, and handled ESM caching.
- PR #1725 pre-installs use-m packages with retry to avoid concurrent CI install
  races. It reduces exposure but cannot replace runtime self-healing.
- Issues #1710 and #1712 supplied the original corruption classifier.
