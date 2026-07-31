# Issue #2113 — concurrent use-m installs corrupt the global alias

Hive Mind commands kept dying at startup while loading `command-stream`, in two
alternating shapes:

```text
npm error ENOTEMPTY: directory not empty, rmdir '.../command-stream-v-latest/examples'
Failed to install command-stream@latest globally into '...' after 3 attempts.
```

```text
Failed to import module from '.../command-stream-v-latest/src/$.mjs?use-m-retry=1'.
Caused by: Cannot find module '.../command-stream-v-latest/src/shell-parser.mjs'
```

**Root cause.** use-m runs one `npm install -g <alias>@npm:<package>@<version>`
per `use()` call and has no in-flight deduplication. 38 modules under `src/`
load `command-stream` through `use()`, 31 of them with a top-level `await`, and
Node evaluates sibling top-level-await subgraphs concurrently — so `fix`
launches six simultaneous global installs of one directory in a cold container.
npm does not lock the global prefix, so those installs delete and re-extract
each other's trees: whoever loses gets `ENOTEMPTY`, and whoever reads a
half-extracted tree gets `ERR_MODULE_NOT_FOUND` for whichever file was not
written yet. Retrying cannot help, because every retry re-enters the same race.

**Fix.** `src/use-m-single-flight.lib.mjs` wraps the loader at `ensureUseM()` so
every one of the 72 files that bootstrap through it inherits three guards:
per-specifier single flight, an in-process per-alias mutex, and a cross-process
advisory lock on the alias directory. Measured on a cold npm prefix: unguarded
24/24 loads fail in 54.8 s, guarded 0/24 in 3.3 s.

Earlier rounds of this issue added recovery for the _symptoms_ — classification
of wrapped `ERR_MODULE_NOT_FOUND`, whole-alias cleanup with a retry budget,
upstream repairs in use-m 8.14.3/8.14.4, and a CDN fallback pin that no longer
downgrades to a loader without recovery. Those layers are kept underneath: this
round adds the prevention they could not provide.

## Contents

- [`timeline.md`](timeline.md) reconstructs the observed sequence and prior fixes.
- [`requirements.md`](requirements.md) maps every issue requirement to evidence.
- [`analysis.md`](analysis.md) documents root cause, evidence, alternatives, and plan.
- [`research.md`](research.md) records upstream, platform, and prior-art research.
- [`raw/`](raw/) preserves every supplied log, the workaround screenshot, the
  package/release audit, and the recorded experiment output.
- [`upstream-use-m-concurrency-report.md`](upstream-use-m-concurrency-report.md)
  preserves the concurrency report filed as
  [use-m #70](https://github.com/link-foundation/use-m/issues/70).
- [`upstream-use-m-cleanup-report.md`](upstream-use-m-cleanup-report.md) preserves
  the earlier report filed as [use-m #68](https://github.com/link-foundation/use-m/issues/68).

## Experiments

- [`reproduce-concurrent-install-race.mjs`](../../../experiments/issue-2113/reproduce-concurrent-install-race.mjs)
  reproduces the race with npm alone, plus the control that keeps the fix
  per-alias rather than global.
- [`reproduce-parallel-use-race.mjs`](../../../experiments/issue-2113/reproduce-parallel-use-race.mjs)
  reproduces it end to end through use-m and proves the guard removes it.
- [`measure-entrypoint-fanout.mjs`](../../../experiments/issue-2113/measure-entrypoint-fanout.mjs)
  measures how many simultaneous installs each binary can trigger.
- [`upstream-use-m-concurrency-repro.mjs`](../../../experiments/issue-2113/upstream-use-m-concurrency-repro.mjs)
  is the standalone reproduction attached to use-m #70: stock use-m from the
  CDN, no Hive Mind code.
- [`prove-top-level-await-concurrency.mjs`](../../../experiments/issue-2113/prove-top-level-await-concurrency.mjs)
  proves that sibling top-level-await modules really do overlap.
- [`reproduce-missing-transitive.mjs`](../../../experiments/issue-2113/reproduce-missing-transitive.mjs)
  is a hermetic missing-file reproduction (earlier round).
- [`reproduce-cleanup-race.mjs`](../../../experiments/issue-2113/reproduce-cleanup-race.mjs)
  reproduces `ENOTEMPTY` cleanup and verifies retry-budget removal (earlier round).

## Verification

```bash
node tests/test-use-m-single-flight-2113.mjs
node tests/test-use-with-retry.mjs
node experiments/issue-2113/measure-entrypoint-fanout.mjs
node experiments/issue-2113/prove-top-level-await-concurrency.mjs

# opt-in, need network and npm:
node experiments/issue-2113/reproduce-concurrent-install-race.mjs
node experiments/issue-2113/reproduce-parallel-use-race.mjs
node experiments/issue-2113/upstream-use-m-concurrency-repro.mjs
node experiments/issue-2113/reproduce-missing-transitive.mjs
node experiments/issue-2113/reproduce-cleanup-race.mjs
```

## Diagnostics

Both supplied logs were produced with `--verbose` and still contained no loader
output, which is why the first analysis had to work backwards from a stack
trace. Dependency loading is now traced under `--verbose` as well as
`HIVE_MIND_USE_M_DEBUG=1`:

```text
[use-m] use('command-stream') loading (alias command-stream-v-latest)
[use-m] use('command-stream') joined an in-flight load (alias command-stream-v-latest)
[use-m] use('command-stream') loaded in 2841ms
```
