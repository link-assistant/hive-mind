# Concurrent use() calls for the same package race in npm and corrupt the alias

Filed as [link-foundation/use-m#70](https://github.com/link-foundation/use-m/issues/70).

## Problem

`use()` has no in-flight deduplication. Every call goes through
`ensurePackageInstalled()` → `installPackage()`, which shells out to
`npm install -g <alias>@npm:<package>@<version>`. Two overlapping calls for the
same specifier therefore run two `npm install -g` into the same alias directory,
and npm has no cross-process (or cross-invocation) lock on the global prefix.
The installs delete and re-extract each other's trees.

Overlapping calls are not an exotic case. Node evaluates sibling
top-level-await subgraphs concurrently, so a project where several modules open
with

```js
const { $ } = await use('command-stream');
```

starts as many simultaneous installs as there are such modules in the cold
import wave. In our case that is six, on a cold container, every run.

Two failure shapes come out of it, both seen in production:

```text
npm error ENOTEMPTY: directory not empty, rmdir '.../command-stream-v-latest/examples'
Failed to install command-stream@latest globally into '...' after 3 attempts.
```

```text
Failed to import module from '.../command-stream-v-latest/src/$.mjs?use-m-retry=1'.
Caused by: Cannot find module '.../command-stream-v-latest/src/shell-parser.mjs'
```

The second one is the more dangerous shape: the failing process saw _no_ install
error at all. It read a directory another process was still writing — or had
just deleted.

### Why the current recovery makes it worse instead of better

`installPackage()` removes the shared alias directory after _every_ failed
attempt:

```js
} catch (error) {
  failures.push({ error, details: formatInstallFailure(error) });
  await removePackageAlias(packagePath, 'incomplete');
```

(`src/use.mjs` in 8.14.4, around line 695.)

Under contention the process that loses the race deletes the tree the winner
just installed successfully. So a caller that never saw an error still ends up
importing from a directory that is being recursively removed underneath it,
which is exactly the `ERR_MODULE_NOT_FOUND` shape above. The retry budget added
in 8.14.3 does not help either: all three attempts re-enter the same contention
window, which is why the production log shows all three failing within nine
seconds.

There is also a check-then-act window in `ensurePackageInstalled()`:

```js
} else if (await isPackageInstalled(packagePath, version, latestVersion)) {
  return packagePath;
}
```

`isPackageInstalled()` returns true for a `latest` install as soon as
`package.json` carries the right version, and for a pinned version as soon as
the directory exists — both are true well before extraction finishes, so a
concurrent caller can return a path to a half-written tree without any install
of its own.

## Reproduction

Standalone, no downstream code — stock use-m from the CDN, a fresh npm prefix,
N concurrent `use()` calls for one specifier:

https://github.com/link-assistant/hive-mind/blob/issue-2113-3b2c7937aea2/experiments/issue-2113/upstream-use-m-concurrency-repro.mjs

```js
const { use } = await eval(await (await fetch('https://unpkg.com/use-m@8.14.4/use.js')).text());
const results = await Promise.allSettled(Array.from({ length: 8 }, () => use('command-stream')));
```

Node 20.20.2, Linux, `npm_config_prefix` pointed at an empty directory:

```text
use-m: https://unpkg.com/use-m@8.14.4/use.js
node: v20.20.2

2/8 concurrent use('command-stream') calls failed in 16499ms

Failed to install command-stream@latest globally into '/tmp/use-m-concurrency-eRm06v/lib/node_modules' after 3 attempts.
Attempts:
  - 1/3: npm warn tar ENOENT: Cannot cd into '/tmp/use-m-concurrency-eRm06v/lib/node_modules/command-stream-v-latest'
npm warn tar ENOENT: Cannot cd into '/tmp/use-m-concurrency-eRm06v/lib/node_modules/command-stream-v-latest/node_modules/@resvg/resvg-js'
npm warn tar ENOENT: Cannot cd into '/tmp/use-m-concurrency-eRm06v/lib/node_modules/command-stream-v-latest/node_modules/gifenc'
```

At 24 concurrent calls it is not probabilistic any more — every call fails:

```text
## raw
   24/24 loads failed in 54802ms
## guarded
   0/24 loads failed in 3343ms
```

That npm itself is the limitation, rather than use-m's use of it, is confirmed
by an npm-only control: 24 concurrent `npm install -g` of _one_ alias produce
22 failures and leave the alias missing, while 5 concurrent installs of five
_different_ packages into the same prefix all succeed
([experiment](https://github.com/link-assistant/hive-mind/blob/issue-2113-3b2c7937aea2/experiments/issue-2113/reproduce-concurrent-install-race.mjs)).
Serialisation therefore has to be per alias, not global.

## Suggested fix

**1. In-flight deduplication (fixes the common case, ~10 lines).** Keep a map
from resolved specifier to the in-flight promise, and evict on rejection so a
genuine failure stays retryable:

```js
const inFlight = new Map();

const dedupe = (key, run) => {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = run().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
};
```

Wrapping `ensurePackageInstalled()` with `dedupe(alias, ...)` collapses the
whole cold wave into one install. This is the Go `singleflight` /
`p-memoize` shape and needs no dependency.

**2. A cross-process install lock (fixes separate processes).** Deduplication
inside one process does not help when a CI step, a daemon and a container share
one prefix. An advisory lock is enough, and `mkdir` is atomic on every
filesystem — the same strategy `proper-lockfile` uses: `mkdir` a
`<alias>.lock` directory, refresh its `mtime` on a timer, treat a lock older
than the stale threshold as abandoned and steal it, and always re-check
`isPackageInstalled()` after acquiring.

**3. Do not delete the alias after a failed attempt while others may be using
it.** `removePackageAlias(packagePath, 'incomplete')` in the `installPackage()`
catch block is safe only if the caller holds the lock from (2). With (1) and (2) in
place it becomes correct; without them it actively destroys successful peers.

**4. Verify after install rather than before.** `isPackageInstalled()` returning
true for any existing directory (pinned versions) or for a `package.json` that
was written before extraction finished (`latest`) means a concurrent caller can
skip the install and import a partial tree. Resolving the entry point, or
checking a marker written after extraction, closes that window.

(1) alone removes the failure for single-process consumers, which is the
overwhelmingly common shape; (2) makes it robust for shared prefixes.

## Downstream workaround

Until this lands upstream, Hive Mind wraps `use()` at its single bootstrap with
per-specifier single flight, an in-process per-alias promise-chain mutex, and a
cross-process advisory lock over the alias directory, using only Node built-ins
(the guard cannot depend on a package, because installing that package is the
thing it protects):

- https://github.com/link-assistant/hive-mind/blob/issue-2113-3b2c7937aea2/src/use-m-single-flight.lib.mjs
- https://github.com/link-assistant/hive-mind/pull/2127

Measured on a cold prefix: 24/24 concurrent loads fail unguarded in 54.8 s,
0/24 guarded in 3.3 s.

## Environment

- use-m 8.14.4 (`https://unpkg.com/use-m@8.14.4/use.js`, and the npm tarball —
  both entry-point bundles carry the same `installPackage()`).
- Node 20.20.2 and 24.3.0, Linux, npm 11.x; production failures observed in
  Docker-in-Docker containers.

Related: [use-m #66](https://github.com/link-foundation/use-m/issues/66) /
[PR #67](https://github.com/link-foundation/use-m/pull/67) (incomplete alias
repair, 8.14.3) and [use-m #68](https://github.com/link-foundation/use-m/issues/68)
(zero-retry cleanup, 8.14.4). Both fixed recovery; this report is about the
cause the recovery keeps re-entering.
