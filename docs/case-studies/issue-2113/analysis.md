# Root-cause analysis

## Summary

Every failure recorded in this issue is a symptom of one defect:

> **use-m runs one `npm install -g <alias>@npm:<package>@<version>` per `use()`
> call with no in-flight deduplication, and Hive Mind entry points import
> several modules whose bodies start with a top-level `await use('command-stream')`.
> Node evaluates sibling top-level-await subgraphs concurrently, so a cold
> container launches several simultaneous global installs of the _same_
> directory. npm has no cross-process lock for the global prefix, so those
> installs delete and re-extract each other's trees.**

That single condition produces both logged signatures — `ENOTEMPTY` while npm
removes the old alias, and a half-extracted tree that later surfaces as
`ERR_MODULE_NOT_FOUND` for an arbitrary internal file — and it explains why
retrying never helped: every retry re-enters the same race.

The earlier rounds of this issue treated the symptoms (classification, cleanup
retry budgets, upstream self-healing). Those layers are correct and retained,
but they are recovery, not prevention. This round adds the prevention.

## Evidence

### 1. The two supplied production logs are the same race, one round apart

| Log                                                                                                      | Image  | Signature                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`raw/start-command-2.10.2-missing-shell-parser.log`](raw/start-command-2.10.2-missing-shell-parser.log) | 2.10.2 | `Failed to import module from '.../command-stream-v-latest/src/$.mjs?use-m-retry=1'.` caused by `Cannot find module '.../src/shell-parser.mjs'`  |
| [`raw/start-command-2.11.1-enotempty-examples.log`](raw/start-command-2.11.1-enotempty-examples.log)     | 2.11.1 | `Failed to install command-stream@latest globally ... after 3 attempts`, all three `ENOTEMPTY: ... rmdir '.../command-stream-v-latest/examples'` |

Both ran the identical command, `fix https://github.com/link-assistant/agent --ci-cd --attach-logs --verbose ...`,
in a fresh Docker-in-Docker container where the alias was cold. In the 2.11.1
log all three of use-m's own install attempts fail on the same directory inside
nine seconds — a fixed packaging or disk problem would not repair itself between
attempts, and a transient one would not fail three times in a row at the same
path. A competing writer that is still extracting into that directory does
exactly this.

The `ERR_MODULE_NOT_FOUND` file also changes between runs — `shell-parser.mjs`,
`terminal-capture.mjs`, `$.trace.mjs` — which is the fingerprint of a partially
extracted tarball rather than of a bad release. `npm pack command-stream@0.17.2 --dry-run --json`
confirms all of them are published (see [`raw/dependency-audit.json`](raw/dependency-audit.json)).

### 2. The race reproduces with npm alone

[`experiments/issue-2113/reproduce-concurrent-install-race.mjs`](../../../experiments/issue-2113/reproduce-concurrent-install-race.mjs)
installs one alias concurrently into a fresh global prefix — no use-m, no Hive
Mind. Recorded run in [`raw/experiment-concurrent-install-race.log`](raw/experiment-concurrent-install-race.log):

```text
## same alias — 24 concurrent installs of command-stream
   22/24 installs failed in 15783ms
      npm error ENOTEMPTY: directory not empty, rmdir '<prefix>/lib/node_modules/command-stream-v-latest/examples'
   alias directory does not exist after the race — every later import fails

## control — 5 concurrent installs of different packages
   0/5 installs failed in 8622ms
   5/5 aliases installed cleanly
```

The control matters: concurrency into the same global root is fine, concurrency
into the same _alias_ is not. That is what narrows the fix to a per-alias lock
instead of a global install lock, which would needlessly serialise unrelated
dependencies.

Concurrency level matters too. At 8 the race frequently does not trigger; at 24
it is reliable (24/24, 21/24, 24/24, 22/24 failures across runs). This is why
production failures looked random.

### 3. The race reproduces end to end through use-m, and the fix removes it

[`experiments/issue-2113/reproduce-parallel-use-race.mjs`](../../../experiments/issue-2113/reproduce-parallel-use-race.mjs)
runs 24 concurrent `use('command-stream')` calls in a child process with its own
cold npm prefix, once with the raw CDN loader and once through `ensureUseM()`.
Recorded run in [`raw/experiment-parallel-use-race.log`](raw/experiment-parallel-use-race.log):

```text
## raw
   24/24 loads failed in 54802ms
      Failed to install command-stream@latest globally into '<prefix>/lib/node_modules' after 3 attempts.
## guarded
   0/24 loads failed in 3343ms
```

The guarded run is also ~16× faster, because 23 redundant registry round-trips
and installs disappear.

### 4. Why "two commands that do the same thing" worked

The issue includes a screenshot ([`raw/workaround-two-commands.png`](raw/workaround-two-commands.png))
where the failing `fix --ci-cd` work is split into `/task --ci-cd` followed by
`/claude <issue>` and both succeed. That is consistent with the race, not
against it, because neither leg produces a wide cold burst:

- `/task --ci-cd` never spawns a process. `src/telegram-task-command.lib.mjs:177`
  calls `createCiCdIssueFn(...)` directly inside the long-running bot, whose
  global alias is already installed and whose `use()` results are already
  resolved. Installs performed: zero.
- `/claude <issue>` spawns `solve` in a fresh container, and `solve` has a cold
  burst of exactly one `command-stream` loader; everything else it needs arrives
  through dynamic `import()` later, by which time the alias is warm.

[`experiments/issue-2113/measure-entrypoint-fanout.mjs`](../../../experiments/issue-2113/measure-entrypoint-fanout.mjs)
walks the import graph of every binary in `package.json` and counts the reachable
modules that top-level-await a `command-stream` load
([`raw/experiment-entrypoint-fanout.log`](raw/experiment-entrypoint-fanout.log)):

```text
binary              modules   cold burst (static)   reachable (incl. dynamic)
task                93        6                     8
fix                 95        6                     8
review              90        5                     9
solve               156       1                     25
```

`fix` starts six simultaneous installs of one alias before its own body runs;
`solve` starts one. The workaround therefore reduced exposure rather than
removing it — `/task --ci-cd` executed in a warm process this time, but the same
command in a cold container has the same six-wide burst as `fix`. This is why
the workaround is not a fix and why the guard belongs in the loader.

## Root causes and gaps

1. **No in-flight deduplication in use-m (primary).** `use()` goes straight to
   `ensurePackageInstalled()` → `installPackage()`; two overlapping calls for the
   same specifier both shell out to `npm install -g`. Reported upstream as
   [use-m #70](upstream-use-m-concurrency-report.md).
2. **use-m's own recovery amplifies the race.** In 8.14.4, every failed install
   attempt runs `removePackageAlias(packagePath, 'incomplete')` — a recursive
   delete of the shared alias directory. Under contention the loser therefore
   deletes the tree the winner just installed successfully, so a process that
   never saw an error still imports from a directory that is being removed. This
   is the precise mechanism behind the `Cannot find module '.../src/shell-parser.mjs'`
   log: a valid install, deleted underneath a valid reader.
3. **No cross-process install lock.** npm does not lock the global prefix, so
   even separate Hive Mind processes on the same host (bot, container, CI step)
   can collide on one alias directory.
4. **Wide cold burst in the module graph.** Six modules reachable from `fix` and
   `task` open with a top-level `await use('command-stream')`, which converts a
   latent npm limitation into a reproducible startup failure.
5. **Recovery cannot fix a race.** use-m's three install attempts and Hive Mind's
   `useWithRetry()` backoff both re-enter the same contention window, so both
   exhaust their budgets — visible verbatim in the 2.11.1 log.
6. **No loader diagnostics in the failing runs.** Both logs were produced with
   `--verbose`, yet no line describes which specifiers were being loaded or how
   many were in flight. `HIVE_MIND_USE_M_DEBUG` existed but nothing enabled it.

The earlier gaps found in this issue — classifier coverage for wrapped
`ERR_MODULE_NOT_FOUND`, sticky reuse of incomplete aliases, zero-retry cleanup,
and the degraded CDN fallback pin — remain accurate and their fixes are kept as
the recovery layer beneath the new prevention layer.

## Selected solution

`src/use-m-single-flight.lib.mjs` adds three layers, applied at `ensureUseM()` as
`wrapUseWithSingleFlight(wrapUseWithRetry(rawUse))`, so all 72 files that
bootstrap through it inherit the guard with no call-site changes:

1. **Single flight.** A per-specifier promise map. Concurrent `use('command-stream')`
   calls share one load; the second and later callers await the first instead of
   starting their own install. Rejections are evicted so a failure is retryable.
2. **In-process per-alias mutex.** Different specifiers that resolve to the same
   alias (`command-stream` and `command-stream@latest` both map to
   `command-stream-v-latest`) are serialised through a promise chain keyed by
   alias, so they cannot install over each other.
3. **Cross-process advisory lock.** An atomic `mkdir` of
   `<tmp>/hive-mind-use-m-locks/<alias>` with a heartbeat (`utimes` every second),
   stale-lock stealing after 15 s of silence, and a 5-minute ceiling after which
   the load proceeds unguarded rather than hanging. Lock-directory failures
   degrade to "no lock" instead of breaking dependency loading.

Builtin specifiers (`use('fs')` and friends, 71 call sites) are detected with
`node:module`'s `isBuiltin()` and skip the lock entirely — they are deduplicated
but never serialised, because nothing is installed for them.

`HIVE_MIND_USE_M_LOCK_DIR` overrides the lock root, which is what lets the
experiments give each child process an isolated lock namespace.

## Diagnostics

Both failing runs used `--verbose` and produced no loader output at all, so the
first analysis had to work backwards from a stack trace. The loader now traces
under either `HIVE_MIND_USE_M_DEBUG=1` or `--verbose`:

```text
[use-m] use('command-stream') loading (alias command-stream-v-latest)
[use-m] use('command-stream') joined an in-flight load (alias command-stream-v-latest)
[use-m] use('command-stream') loaded in 2841ms
```

A repeat of this failure will therefore show, in the attached log, how many
loads were in flight, which alias they contended for, and how long each took.

## Alternatives considered

- **Retry harder (more attempts, longer backoff).** Rejected: the 2.11.1 log
  shows three consecutive attempts losing to the same competing writer. Backoff
  reduces the probability per attempt but the contention window scales with the
  install itself, and every additional process makes it worse.
- **One global install lock instead of a per-alias lock.** Rejected: the control
  phase of the npm experiment shows concurrent installs of _different_ packages
  are safe, so a global lock would serialise unrelated dependencies and slow cold
  start for no reliability gain.
- **Preinstall the aliases into the Docker images.** Rejected as a complete fix,
  useful as an optimisation: use-m re-checks the registry for `latest` on every
  cold `use()`, so the day a new `command-stream` is published the burst returns.
  It also does nothing for non-Docker execution.
- **Serialise the module graph (remove top-level `await use(...)`).** Rejected:
  it would mean rewriting the initialisation order of 31 modules, it makes the
  failure quieter rather than impossible (any two processes still collide), and
  it trades a real fix for an architectural migration.
- **Pin `command-stream` or use-m.** Rejected: the audited 0.17.2 tarball is
  complete, and the race is independent of the installed version.
- **Move every dynamic dependency into local `package.json`.** Still the most
  robust long-term option and still out of scope here: it is a broad migration
  that does not repair already-corrupt global aliases.
- **Wait for upstream only.** Rejected: [use-m #70](upstream-use-m-concurrency-report.md)
  is filed with a reproduction and a suggested patch, but Hive Mind must be
  reliable on every use-m version that a CDN, cache, or preinstalled global can
  serve.

## Verification

| Claim                                          | Evidence                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Concurrent same-alias installs destroy trees   | `experiments/issue-2113/reproduce-concurrent-install-race.mjs`, 22/24 failures, alias gone afterwards                       |
| Concurrent different-package installs are safe | Same experiment, control phase, 5/5 clean                                                                                   |
| use-m has no in-flight dedup                   | `experiments/issue-2113/reproduce-parallel-use-race.mjs`, raw mode 24/24 failures                                           |
| The single-flight guard removes it             | Same experiment, guarded mode 0/24 failures in 3.3 s                                                                        |
| Only one install happens per alias             | `tests/test-use-m-single-flight-2113.mjs` (20 tests), including a 36-way concurrency assertion                              |
| Every entry point inherits the guard           | Same test file asserts `ensureUseM()` installs it; no `src/`, `scripts/`, `bin/` or `tests/` file bootstraps use-m directly |
| Cold burst per binary                          | `experiments/issue-2113/measure-entrypoint-fanout.mjs`                                                                      |

Earlier rounds' verification (classification of both wrapper signatures,
whole-alias cleanup with a retry budget, the CDN fallback pin floor) remains in
`tests/test-use-with-retry.mjs` and
`tests/test-use-m-bootstrap-no-npm-prefix-workaround.mjs`.

## Appendix: previously identified gaps (still fixed, now secondary)

1. **Incomplete alias install.** A versioned global directory visible with an
   internal file absent. Now explained: a competing installer re-extracted it.
2. **Classifier gap.** `isCorruptInstallError()` did not recognise Node's
   `ERR_MODULE_NOT_FOUND` nested inside use-m's `Failed to import module from '…'`
   wrapper. Fixed in this issue's first round.
3. **Sticky reuse.** use-m treats an existing alias directory as installed, so an
   incomplete tree is reused until it is removed.
4. **Zero-retry cleanup.** Both use-m and the downstream cleanup used
   `fsPromises.rm()` defaults, so documented-retryable `ENOTEMPTY` escaped.
   Reported as [use-m #68](https://github.com/link-foundation/use-m/issues/68),
   fixed upstream in 8.14.4 and mirrored downstream.
5. **New wrapper signature.** use-m 8.14.3's `Failed to remove corrupt npm alias '…'.`
   is now classified and its alias extracted.
6. **Degraded CDN fallback.** The bootstrap fallback pinned `use-m@8.13.8`, the
   last release with no alias recovery at all; repinned to 8.14.4 with a
   regression test that keeps the floor.
