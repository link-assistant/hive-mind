# Research

## Why concurrent installs happen at all: Node's top-level await

- [V8's top-level await documentation](https://v8.dev/features/top-level-await)
  describes the execution model: when a module suspends on a top-level `await`,
  "the sibling modules, and siblings of parent modules, are able to continue
  executing in the same synchronous order". A suspended module does not block
  its siblings, so several `await use(...)` calls end up in flight at once.
- The [TC39 top-level await proposal](https://github.com/tc39/proposal-top-level-await)
  (stage 4) specifies the same asynchronous evaluation: dependencies are
  evaluated in post-order, but an awaiting module yields to the rest of the graph
  rather than freezing it.
- Verified locally rather than assumed:
  [`experiments/issue-2113/prove-top-level-await-concurrency.mjs`](../../../experiments/issue-2113/prove-top-level-await-concurrency.mjs)
  imports three sibling modules that each top-level-await a 50 ms task and
  reports peak concurrency:

  ```text
  order: a start, b start, c start, a end, b end, c end
  peak concurrency: 3 of 3 sibling modules
  ```

  This is the mechanism that turns 31 modules opening with
  `const { $ } = await use('command-stream')` into simultaneous `npm install -g`
  calls in a cold container.

## npm and concurrency

- npm has no cross-process lock on the global prefix. Neither
  [npm-install](https://docs.npmjs.com/cli/v11/commands/npm-install) nor
  [npm-prefix](https://docs.npmjs.com/cli/v11/commands/npm-prefix) documents any
  guarantee about two installs writing to the same tree at once, and npm 11.17.0
  keeps no lock state at all: its cache directory contains only `_cacache`,
  `_logs`, `_npx`, and the update-notifier stamp.
- [npm/npm#2500, "concurrent npm install problems"](https://github.com/npm/npm/issues/2500)
  is the long-standing upstream report of this class; npm's own design notes
  acknowledge that it does as much work concurrently as practical, which is what
  makes overlapping installs collide.
- The same failure is still being reported against current npm by other
  projects, for example
  [google-gemini/gemini-cli#15123](https://github.com/google-gemini/gemini-cli/issues/15123),
  where `npm install -g <pkg>@latest` fails with `ENOTEMPTY` on a leftover
  directory in the global `node_modules`. This is not a Hive Mind-specific or
  use-m-specific limitation — it is why callers have to serialise.
- [npm package-spec](https://docs.npmjs.com/cli/v11/using-npm/package-spec/)
  defines `<alias>@npm:<name>@<version>`, which is what use-m installs, so two
  different specifiers that resolve to the same alias contend for one directory.
  That is why the lock key is the alias and not the specifier.
- Measured directly rather than inferred:
  [`reproduce-concurrent-install-race.mjs`](../../../experiments/issue-2113/reproduce-concurrent-install-race.mjs)
  shows 22/24 concurrent installs of one alias failing and the alias directory
  gone afterwards, while 5/5 concurrent installs of _different_ packages into the
  same prefix succeed.

## Upstream use-m

- `use()` resolves a specifier, then calls `ensurePackageInstalled()` →
  `installPackage()`, which shells out to
  `npm install -g <alias>@npm:<package>@<version>` with up to three attempts.
  There is no map of in-flight loads, so two overlapping calls for the same
  specifier both install. Reported as
  [use-m #70](upstream-use-m-concurrency-report.md) with a reproduction, the
  downstream workaround, and a suggested patch.
- Earlier reports from this issue are fixed and released:
  [#66](https://github.com/link-foundation/use-m/issues/66) →
  [PR #67](https://github.com/link-foundation/use-m/pull/67) / `use-m@8.14.3`
  (install retry, corrupt-alias repair, cache-busted recovery), and
  [#68](https://github.com/link-foundation/use-m/issues/68) → `use-m@8.14.4`
  (`maxRetries: 5`, `retryDelay: 100` in `removePackageAlias()`, confirmed by a
  tarball diff across all six bundled entry points).
- Reading the 8.14.4 source shows its recovery is narrower than the release
  notes suggest: repair is skipped for specifiers with a subpath
  (`if (options?.repair || modulePath) throw error;`), import repair runs once
  per call, and `isPackageInstalled()` treats any existing directory as a valid
  install. Those gaps, plus the fact that a CDN, a cache, or a preinstalled
  global can still serve an older use-m, are why the downstream wrapper stays.
- Version availability was checked against the registry and the CDN:
  `npm view use-m dist-tags` reports `latest: 8.14.4`, and
  `https://unpkg.com/use-m@8.14.4/use.js` serves HTTP 200 with the retry budget
  present. The previously pinned `https://unpkg.com/use-m@8.13.8/use.js` bundle
  contains no `removePackageAlias` at all.

## Prior art for the three guards

| Layer              | Established prior art                                                                                                                                          | What was used here                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Single flight      | Go's [`golang.org/x/sync/singleflight`](https://pkg.go.dev/golang.org/x/sync/singleflight); npm's [`p-memoize`](https://www.npmjs.com/package/p-memoize) 8.0.0 | A `Map` from specifier to the in-flight promise, with rejections evicted so a failure stays retryable. |
| In-process mutex   | [`async-mutex`](https://www.npmjs.com/package/async-mutex) 0.5.0                                                                                               | A promise chain keyed by alias — same semantics for one key, no dependency.                            |
| Cross-process lock | [`proper-lockfile`](https://www.npmjs.com/package/proper-lockfile) 4.1.2, [`lockfile`](https://www.npmjs.com/package/lockfile) 1.0.4                           | The same design: atomic `mkdir`, `mtime` heartbeat, stale detection, then steal.                       |

`proper-lockfile` is the closest match and its README documents exactly why this
shape is correct:

> This library utilizes the `mkdir` strategy which works atomically on any kind
> of file system, even network based ones.

> When a lock is successfully acquired, the lockfile's `mtime` (modified time)
> is periodically updated to prevent staleness. This allows to effectively check
> if a lock is stale by checking its `mtime` against a stale threshold.

Its defaults (`stale: 10000`, `update: stale/2`) informed the values used here
(`DEFAULT_STALE_MS = 15000`, `DEFAULT_HEARTBEAT_MS = 1000`), with a longer stale
window because a cold `npm install -g` legitimately takes several seconds.

**Why none of these packages is a dependency.** The guard has to run _before_
any dependency can be loaded — it is the thing that makes loading dependencies
safe. Requiring `use('proper-lockfile')` inside the loader would need the exact
mechanism it is protecting, and the repository deliberately has no runtime
`dependencies` block for these (`package.json` ships only `src` and `*.md`). The
implementation therefore uses `node:fs`, `node:os`, `node:path`, and
`node:module` only, and stays about 350 lines including comments.

## Node.js platform facts used

- [ESM resolution](https://nodejs.org/api/esm.html): a nonexistent resolved file
  produces `ERR_MODULE_NOT_FOUND`, matching the half-extracted-tree evidence;
  ESM keeps its own cache and query-string variants load as distinct modules,
  which is what the retained cache-busting recovery relies on.
- [`fsPromises.rm`](https://nodejs.org/api/fs.html#fspromisesrmpath-options)
  lists `ENOTEMPTY`, `EBUSY`, `EMFILE`, `ENFILE`, and `EPERM` as retryable during
  recursive removal, with `maxRetries` defaulting to zero — the basis of the
  8.14.4 upstream fix and of the downstream cleanup budget.
- [`module.isBuiltin()`](https://nodejs.org/api/module.html#moduleisbuiltinmodulename)
  identifies specifiers that install nothing, so `use('fs')` and its 70 sibling
  builtin call sites are deduplicated but never serialised behind an install
  lock.
- `fs.mkdir()` maps to POSIX `mkdir(2)`, which fails with `EEXIST` atomically —
  the primitive both `proper-lockfile` and this loader build on.

## command-stream

- The current release is `command-stream@0.17.2`, published 2026-07-26 and
  matching repository tag `js-v0.17.2`.
- `npm pack command-stream@0.17.2 --dry-run --json` reports 466 entries and the
  registry integrity recorded in [`raw/dependency-audit.json`](raw/dependency-audit.json),
  including every file production reported missing. Pinning an older release
  cannot prevent a concurrently-mutated alias, so no command-stream defect was
  reported.

## Related Hive Mind work

- PR #2093 centralised recovery at the loader: whole-alias removal, transient
  install retry, and ESM cache-busting. It is the layer this fix sits on top of.
- PR #1725 pre-installs use-m packages with retry to avoid concurrent CI install
  races — the same class of problem, solved for one environment only. The
  single-flight loader generalises it to every environment.
- Issues #1710, #1712, and #2092 supplied the original corruption classifier.
