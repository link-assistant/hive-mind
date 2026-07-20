# Analysis — issue #2092

## Root causes

### RC1 — the recovery existed but covered 3 of 100 call sites

`src/use-with-retry.lib.mjs` has handled corrupt use-m installs since #1710. It
was imported explicitly by exactly three modules:

```
src/config.lib.mjs:26        useWithRetry(globalThis.use, 'getenv')
src/queue-config.lib.mjs:47  useWithRetry(globalThis.use, 'getenv')
src/queue-config.lib.mjs:50  useWithRetry(globalThis.use, 'links-notation')
src/lino.lib.mjs:8           useWithRetry(globalThis.use, 'links-notation')
```

Meanwhile the repository contains **100 raw `await use(...)` calls across 46
files**, ~40 of which are `await use('command-stream')` at *module top level*:

```
src/github.lib.mjs:5   const { $ } = await use('command-stream');
src/solve.mjs:10       const { $: __rawDollar$ } = await use('command-stream');
src/claude.lib.mjs:6   const { $ } = await use('command-stream');
…
```

Being at module top level makes this worse than an ordinary unprotected call:
the failure happens during `import()` resolution, so it cannot be caught by any
`try/catch` around the *logical* operation (`createTaskIssue`) that triggered it.

**Fix:** wrap once at the source. `ensureUseM()` — the single bootstrap for
`globalThis.use` (`src/use-m-bootstrap.lib.mjs`, the only place in the repo that
evaluates the unpkg bundle) — now returns `wrapUseWithRetry(rawUse)`. Every
present and future call site inherits the recovery with no edit. The wrapper is
idempotent (`Symbol.for('hive-mind.use-with-retry.wrapped')`), so the repeated
`ensureUseM()` calls scattered across modules do not nest retries.

### RC2 — a failed `npm install -g` was not treated as retryable

Run 2 failed with `Failed to install command-stream@latest globally into …`,
thrown by use-m at `use.js:682`:

```js
try {
  await execAsync(`npm install -g ${alias}@npm:${packageName}@${version}`, { env: installContext.env, stdio: 'ignore' });
} catch (error) {
  throw new Error(`Failed to install ${packageName}@${version} globally into '${installContext.globalModulesPath}'.`, { cause: error });
}
```

`isCorruptInstallError` did not match this message, so even a fully-wired
`useWithRetry` would have given up immediately. In a DinD container the registry
(or DNS) is routinely unavailable for the first seconds of the container's life,
which is exactly when `/fix` runs.

**Fix:** `isTransientInstallError` (mode 4). There is nothing on disk to delete,
so the retry backs off (1 s, then 2 s, injectable via `options.sleep`) and lets
npm try again.

### RC3 — cleanup deleted the wrong directory for nested entry points

`useWithRetry` derived the directory to delete with `dirname(corruptedPath)`
unless the path itself ended in the alias segment. For
`.../command-stream-v-latest/src/$.mjs` that is `.../command-stream-v-latest/src`
— it removes the source directory but leaves `package.json` behind, so
`isPackageInstalled()` in use-m still reports the package as installed and the
retry re-imports the same broken tree. The bug was invisible for #1710/#1712
because `getenv` and `links-notation` both expose top-level entry files.

**Fix:** `resolveAliasDir()` walks the path up to the `<pkg>-v-<version>`
segment, so the *whole* alias install is removed. Falls back to the parent
directory when no alias segment is present.

### RC4 — the failure was undiagnosable from the log

`src/fix.mjs:240` was `console.error(\`❌ ${error.message}\`)`. use-m attaches
the real explanation to `error.cause` (`SyntaxError: Unexpected end of input`),
and it was discarded — the run log in the issue contains one line of diagnosis
for a 12-second crash, and `--verbose` changed nothing about it.

Upstream compounds this: use-m runs the install with `stdio: 'ignore'`
(`use.js:681`), so npm's own stderr — the actual reason the install failed in
run 2 — is destroyed before the error object is even constructed. That part
cannot be fixed here; see `research.md` and the upstream report.

**Fix:** `src/error-formatting.lib.mjs::formatFatalError` keeps the one-line
summary and appends the cause chain (with `code`), plus full stacks under
`HIVE_MIND_VERBOSE`. Wired into `src/fix.mjs` and `src/cleanup.mjs`, the two
entry points that collapsed errors to `.message`.

## Defective control flow, before and after

```
before:  fix.mjs → import task.issue-creation.lib.mjs
                 → import github.lib.mjs
                 → await use('command-stream')        ← raw, unprotected
                 → use-m: install (may fail)          ← not retryable
                 → use-m: import  (may be truncated)  ← retryable, but nobody retried
                 → throw → catch prints .message only → exit 1

after:   fix.mjs → … → await use('command-stream')    ← wrapped by ensureUseM
                 → attempt 1 fails
                     · install failure  → backoff 1s, retry
                     · corrupt install  → rm -rf <pkg>-v-latest, retry
                 → attempt 2/3 succeeds → run continues
                 → if all attempts fail → formatFatalError prints cause chain
```

## Why not the alternatives

| Alternative                                        | Why not                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Add `useWithRetry` to each of the ~40 call sites   | 40 mechanical edits that a 41st call site silently escapes; the wrapper achieves the same with one change     |
| Bake `command-stream` into the Docker image        | Worth doing as defence in depth, but it does not help non-Docker installs and use-m still resolves at runtime |
| Vendor `command-stream` as a normal dependency     | Largest and most correct long-term change, but out of scope for a crash fix and affects every `use()` package |
| Increase npm retries via `.npmrc`                  | Only covers RC2, and not the corrupt-tree case that run 1 hit                                                 |

The image/vendoring options remain open follow-ups; they are complementary to,
not substitutes for, a loader that heals itself.
