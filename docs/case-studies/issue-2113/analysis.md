# Root-cause analysis

## Observed failures

### Incomplete aliases

The alias entry point existed in two independent runs:

```text
.../command-stream-v-latest/src/$.mjs
```

but Node could not resolve two different relative files imported from it:

```text
.../command-stream-v-latest/src/terminal-capture.mjs
.../command-stream-v-latest/src/$.trace.mjs
code: ERR_MODULE_NOT_FOUND
```

This distinguishes the failure from issue #2092's truncated `$.mjs`
(`SyntaxError`) and failed `npm install -g`. It is another incomplete-tree
state: enough of the alias exists for use-m to reuse it, but not enough for Node
to evaluate it.

An `npm pack command-stream@0.17.2 --dry-run --json` audit found all three files
in the published tarball: `src/$.mjs` (12,555 bytes), `src/$.trace.mjs` (1,439
bytes), and `src/terminal-capture.mjs` (13,500 bytes). The tag and tarball agree.
There is therefore no evidence of a `command-stream` packaging defect.

### Cleanup failure after the upstream fix

`use-m@8.14.3`, published at 19:28 UTC, added the requested corrupt-alias
self-heal. The 20:04 UTC run reached it but failed while removing the alias:

```text
Failed to remove corrupt npm alias '.../command-stream-v-latest'.
Caused by: ENOTEMPTY .../command-stream-v-latest/examples
```

The upstream helper called `rm(path, { recursive: true, force: true })`.
Node documents that `ENOTEMPTY`, `EBUSY`, `EMFILE`, `ENFILE`, and `EPERM` are
retried only when recursive removal has a positive `maxRetries`; the default is
zero. The concurrent writer stress experiment reproduces `ENOTEMPTY` with the
zero-retry call and succeeds with five retries. The evidence proves a mutation
race or equivalent transient filesystem condition, but does not identify which
process performed the competing mutation.

## Root causes and gaps

1. **Incomplete alias install.** A versioned global package directory was visible
   before or after an interrupted/partial installation, while an internal file
   was absent. Two different missing files from a complete tarball rule out a
   deterministic missing-file release.
2. **Classifier gap.** `isCorruptInstallError()` recognized syntax corruption,
   invalid `package.json`, and use-m resolution failure, but not Node's
   `ERR_MODULE_NOT_FOUND` nested as the cause of use-m's import wrapper.
3. **Sticky reuse.** use-m sees the alias directory as installed, so without
   removing it a later load can reuse the same incomplete tree.
4. **Zero-retry cleanup.** The new use-m repair and Hive Mind's downstream
   cleanup both relied on `fsPromises.rm()` defaults, so `ENOTEMPTY` escaped
   rather than receiving the retry behavior Node provides.
5. **New wrapper signature.** Hive Mind did not classify or extract the alias
   from use-m 8.14.3's `Failed to remove corrupt npm alias ...` error.
6. **Degraded CDN fallback.** `ensureUseM()` falls back to a pinned bundle when
   unpkg cannot serve `latest`. That pin was `use-m@8.13.8`, verified to contain
   neither `removePackageAlias()` nor `isRecoverableNpmImportError()`. A CDN
   hiccup therefore silently downgraded every dependency import to the least
   resilient loader available, exactly when reliability matters most.

## Upstream resolution (2026-07-30)

use-m #68 was closed at 06:38:13 UTC and `use-m@8.14.4` was published at
06:39:50 UTC. Diffing the 8.14.3 and 8.14.4 tarballs shows the suggested fix
adopted verbatim, in the single shared helper, across all six bundled entry
points:

```js
await rm(packagePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
```

Because `ensureUseM()` loads `https://unpkg.com/use-m/use.js`, production picks
this up automatically with no pin to bump.

### Why the downstream guards are still kept

Reading the 8.14.4 source rather than assuming its coverage shows the shared
wrapper is still doing work that upstream does not:

- **Subpath specifiers are never self-healed.** The npm resolver's repair branch
  reads `if (options?.repair || modulePath) throw error;`, so any specifier with
  a subpath skips repair entirely. This repository calls
  `use('yargs@17.7.2/helpers')`, which upstream will not recover.
- **Import repair is one-shot.** `isRecoverableNpmImportError()` triggers a
  single repair-and-reimport. A second corruption in the same process is fatal
  upstream, while the shared wrapper still has attempts left.
- **Sticky reuse persists.** `isPackageInstalled()` only checks
  `directoryExists()` for exact versions, and compares `package.json` version for
  `latest`. An incomplete tree with an intact `package.json` still counts as
  installed.
- **Budget exhaustion rethrows the same wrapper.** Five retries reduce but do not
  eliminate the race; when it is exhausted, 8.14.4 throws the identical
  `Failed to remove corrupt npm alias '…'.` error the classifier handles.
- **Older loaders remain reachable.** The CDN fallback pin, preinstalled globals,
  and cached bundles can all supply a use-m without any of this recovery.

## Selected solution

The shared recovery recognizes two narrow signatures:

1. `ERR_MODULE_NOT_FOUND` only when it is the cause of use-m's exact
   `Failed to import module from '…'` wrapper;
2. use-m's exact `Failed to remove (corrupt|incomplete) npm alias '…'.` wrapper
   only when its cause is one of Node's documented recursive-rm retry codes.

It then extracts or derives the `<package>-v-<version>` alias, removes it with
`recursive`, `force`, five retries, and 100 ms linear retry delay, and calls
use-m again. The existing cache-busted import fallback remains available if
Node replays a failed ESM evaluation for the same entry URL.

Because `ensureUseM()` wraps `globalThis.use`, this applies to all dependency
imports rather than only `command-stream` or the failing `/fix` path.

The CDN bootstrap fallback is additionally repinned from `use-m@8.13.8` to
`use-m@8.14.4`, so the degraded path retains upstream alias repair instead of
losing it. A regression test asserts the pin never moves back below that floor.

## Alternatives

- **Pin `command-stream`:** rejected because the 0.17.2 registry tarball contains
  every missing file. An older version can be left incomplete by the same
  install/mutation failure.
- **Pin use-m 8.14.2:** rejected because it removes upstream self-healing and its
  downstream cleanup still had the same zero-retry `rm` behavior.
- **Use only use-m 8.14.3 self-healing:** insufficient because the supplied
  post-release log demonstrates its cleanup can fail before reinstall.
- **Retry only in `/fix`:** rejected because the failure happens during shared
  module loading and affects every command.
- **Add retries at every `use(...)`:** rejected because it duplicates policy and
  misses future call sites.
- **Rely only on CI/Docker pre-installation:** insufficient for runtime installs
  and for aliases that become incomplete after the pre-install step.
- **Move every dynamic dependency into local `package.json`:** potentially more
  reproducible, but a broad architectural migration that does not repair the
  current global alias cache. It can be evaluated separately.
- **Retry all `ERR_MODULE_NOT_FOUND`:** rejected because permanently broken
  package releases and application coding errors should remain visible. The
  use-m wrapper guard keeps the workaround narrow.

## Verification strategy

The unit tests recreate both exact wrapper errors and assert classification,
path extraction, whole-alias cleanup, and retry. A separate unit test verifies
the default cleanup passes `maxRetries: 5` and `retryDelay: 100` to recursive
`rm`. The hermetic missing-file experiment confirms Node's real
`ERR_MODULE_NOT_FOUND` shape. The concurrent writer experiment provokes real
`ENOTEMPTY` and verifies retry-budget cleanup. Full default tests, lint, format,
syntax, and file-size checks provide regression coverage.

The original incomplete-install problem was reported and fixed in
[use-m #66](https://github.com/link-foundation/use-m/issues/66) /
[PR #67](https://github.com/link-foundation/use-m/pull/67). The cleanup race is
reported separately as [use-m #68](https://github.com/link-foundation/use-m/issues/68).
