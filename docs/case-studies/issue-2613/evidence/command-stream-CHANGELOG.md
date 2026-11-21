# Changelog

## 2.0.0

### Major Changes

- Update all JavaScript runtime and development dependencies to their latest
  stable releases, including Execa 10.1.0 and the ShellJS 0.10 declarations.
  Execa 10 requires Node.js 22 or later; command-stream now requires Node.js 22.
  The Node.js CI matrix covers 22, 24, and 26. Use node-pty's latest stable 1.1.0
  release in place of the development prerelease.
  Repair its packaged macOS spawn-helper's missing executable permission before
  starting the PTY host so terminal capture continues to work on macOS.

  Preserve the public execaCommand and execaCommandSync helpers with typed
  wrappers around Execa 10. Update npm publishing to npm 12 and its supported
  Node.js ranges. Refresh GitHub Actions dependencies.

  Add dependency freshness CI for both language packages, Rust benchmarks, and
  embedded release-script manifests, with verified open-issue blockers for Rust.

  Pin the Changesets formatter to Prettier so release versioning no longer tries
  to run Deno, which the release runner does not have; create the GitHub release
  of a version that reached npm without one; make the signal handling tests wait
  for the child to be ready instead of sleeping; and run `bun test` in the test
  runner examples without a shell, so a checkout path with spaces no longer fails
  every file.

  Stop descendant processes on Windows when a command is killed or aborted.
  Avoid delayed retries against reused Windows PIDs.
  Handle asynchronous stdin EPIPE when a command exits without reading its input, and reuse error handlers across repeated writes to avoid listener warnings.

  Keep virtual `exit` statuses silent: nonzero exits have empty stderr and no
  mirrored diagnostic, while `exit 0` succeeds with errexit enabled.

## 1.6.2

### Patch Changes

- cda1830: Report signal-terminated processes with shell-compatible nonzero exit statuses
  in async and sync execution. Expose the signal name (or null for ordinary exits)
  on results, stream exit chunks, and exit events, with matching TypeScript types.
  Treat synchronous stdin mode keywords as modes rather than input bytes.
  Handle stdin EPIPE events when a child dies during an asynchronous input write.
  Normalize macOS signal names reported with the Linux table by older Bun versions.

## 1.6.1

### Patch Changes

- 5393e75: Finish streams promptly when the supplied AbortSignal is already aborted, yielding exactly one exit chunk with the stored result code. Also finish iteration when the runner completed before stream listeners were attached.

## 1.6.0

### Minor Changes

- Add the pinned ShellJS 0.10.0 compatibility API through `$.shelljs`, the named
  `shelljs` export, and the typed ESM/CommonJS `command-stream/shelljs` entry.
  ShellJS is now a production dependency. Add portable native head, tail, sort and
  uniq commands, preserve line endings, validate options strictly and stream file
  output where possible. Include migration guidance and bounded output benchmarks.

## 1.5.0

### Minor Changes

- Add the isolated Execa 9.6.1 API with ESM/CommonJS types, lazy `$.execa` and
  `execaCompat()` access through the general API, plus migration examples and
  reproducible streaming and size comparisons. Execa is now a production dependency.

  Prevent false CI and release results by validating registry publication, release commands, pull request metadata, audit failures, and manual release gates.

  Encode publisher package names safely, recognize actual npm badge images in release notes, and commit version messages without manual shell escaping.

  Keep repeated metadata staging safe after consuming release fragments.

## 1.4.0

### Minor Changes

- 836d2e3: Add a zx-compatible API (issue #26): `command-stream/zx`, `command-stream/zx/core`, `command-stream/zx/globals` and `command-stream/zx/cli` (ESM and CommonJS, with TypeScript types), `$.zx` on the main `$`, and a `command-stream` executable that runs zx scripts, including ones starting with `#!/usr/bin/env command-stream`. All 291 units of zx's test suite are ported and run on Node.js and Bun. See `docs/ZX_MIGRATION.md`.

  Share project-local executable lookup with the default `$`, `run()`, and Bun Shell APIs through the `preferLocal` option.

## 1.3.0

### Minor Changes

- afbd452: Add a Bun.$-compatible shell for Node.js, Bun and Deno: `import { $ } from 'command-stream/bun'`(also`require('command-stream/bun')`and`$.bun`). It is a portable port of the Bun Shell interpreter (lexer, parser, brace/glob expansion, pipelines, subshells, `if`, `&&`/`||`, redirects, command substitution, variables, and the builtins `cd`, `echo`, `pwd`, `export`, `exit`, `true`, `false`, `which`, `basename`, `dirname`, `seq`, `yes`, `ls`, `rm`, `mkdir`, `touch`, `mv`, `cat`, `cp`) with Bun's JavaScript API (`ShellPromise` with `.text()`, `.json()`, `.lines()`, `.bytes()`, `.blob()`, `.quiet()`, `.nothrow()`, `.cwd()`, `.env()`; `ShellOutput`, `ShellError`, `new $.Shell()`, `$.escape`, `$.braces`, `$.file`). It passes the whole Bun Shell conformance corpus (`conformance/bun-shell/`, recorded from Bun's own shell tests) byte for byte on Node.js, Bun and Deno, on Linux, macOS and Windows.

## 1.2.0

### Minor Changes

- f382121: Ship TypeScript declarations for the whole public API (ESM, CommonJS and `command-stream/process-runner`): typed options and results, typed event listeners, discriminated streaming chunks, type-safe virtual command registration, quoting, shell settings, ANSI and terminal capture. Declarations are type checked in strict mode in CI and verified against the runtime exports.

## 1.1.0

### Minor Changes

- 870dcc8: Expose cross-spawn as `$.spawn`, `spawn`, and `$.spawn.sync` while preserving native ChildProcess streams, options, and failure semantics. Document JavaScript and Rust migration paths.

## 1.0.0

### Major Changes

- e9afa6e: Expose completed result stdout and stderr as readable streams and stdin as a writable record. Use `result.text()` or `result.stdout.toString()` for captured text.

## 0.25.0

### Minor Changes

- 6c7118e: Expose `command.child` synchronously so a lazy command can be stopped with
  `command.child.kill('SIGTERM')` before startup has crossed its first asynchronous
  boundary. The stable pending handle follows the native Node.js or Bun child once
  it is spawned, also supports cancelling in-process built-ins, and is released
  from `command.child` after cleanup.

## 0.24.1

### Patch Changes

- e223318: Keep built-in and streaming pipeline results consistent across Node.js and Bun, and publish executable cross-language feature documentation.

## 0.24.0

### Minor Changes

- 3c6ee95: Expose the process id of a started command as `command.pid`. Issue #18 asked for
  documentation on reading it, and there was nothing to document: the only handle
  was `command.child.pid`, which throws once the command finishes (cleanup
  releases `child`), is not populated right after `start()`, and is absent for
  built-in commands with no indication of why. The id is now recorded at spawn
  time, so the same value is reported from `await`, `.sync()`, `.stream()` and the
  `streams` getters, and it stays readable after the command is done.

  Documents the behavior in "Process ID of a Running Command" - including what the
  id names (the process the shell put there, which leads its own process group,
  unless `exec` mode is used to skip the shell) and why built-in commands have
  none - and adds a runnable `examples/process-pid-access.mjs`.

## 0.23.1

### Patch Changes

- 35b7589: Cover parallel execution of sleeping commands with tests (issue #22). Two and
  three commands started together — through the built-in `sleep`, through real
  `sleep` processes with virtual commands disabled, and through `sh -c` scripts
  that sleep between writes — must all finish, keep their own output and
  environment, and overlap in time instead of running one after another.

## 0.23.0

### Minor Changes

- 08e295b: Deliver signals gracefully when stopping a running command. `kill()` used to
  send the requested signal and `SIGKILL` in the same tick, so a child that
  trapped `SIGTERM` never got to run its handler even though the reported exit
  code claimed it had. The signal is now delivered to the whole process group,
  followed by a grace period, and only then by `SIGKILL`. The new `killGrace`
  option controls that window (default `100` ms; `0` escalates immediately), and
  `killSignal` sets the default signal for `kill()`, `break`, and `AbortSignal`.

  Documents the behavior in "Sending Signals to a Running Command" with the
  `128 + signal` exit-code table, and adds a runnable
  `examples/signals-graceful-shutdown.mjs`.

## 0.22.0

### Minor Changes

- ef7645e: Add `tee` as a built-in virtual command. It was implemented but never
  registered, so `` $`tee ...` `` fell through to the system binary. Follows GNU
  coreutils: `-a`/`--append`, `-i`/`--ignore-interrupts`, clustered short flags,
  `--` as an option terminator, a bare `-` treated as a file named `-`, and a
  write failure reported on stderr with exit code 1 while the remaining files are
  still written.

  Also stop stdio mode keywords from becoming virtual command input. The `stdin`
  option carries either input data or one of `inherit`, `ignore` and `pipe`, but
  both virtual command runners treated any string as data, so `` await $`cat` ``
  returned the literal `"inherit"`. Piped input now also wins over the pipeline's
  own `stdin` option instead of being overwritten by it.

## 0.21.8

### Patch Changes

- 0f0cf27: Add a reproducible benchmark playground comparing process performance, package
  size, feature coverage, and deterministic real-world workloads with Execa,
  cross-spawn, ShellJS, zx, and Bun Shell.

## 0.21.7

### Patch Changes

- 728030c: Guarantee that successful stderr-only CLI output remains separately captured,
  including pull request URLs, while `2>&1` retains normal shell merge behavior.

## 0.21.6

### Patch Changes

- 010ce00: Expose the exit status of a failing command under both `error.code` and
  `error.exitCode`, so handlers written for Node.js `child_process` and for
  Execa, zx, nano-spawn or the Bun shell work unchanged. The attached
  `error.result` carries both names as well, and a command that could not be
  launched at all reports its shell-compatible status (127, 126) through
  `error.exitCode` while `error.code` keeps the POSIX errno.

## 0.21.5

### Patch Changes

- 434cf1f: Document and lock in exact GitHub CLI Markdown body interpolation, including
  fenced code, quotes, shell-looking text, multiline whitespace, and Unicode.

## 0.21.4

### Patch Changes

- d0cc6ac: Replace conceptual competitor checks with executable JavaScript and Rust compatibility corpora and complete per-test provenance ledgers.

  Also fix duplicate explicit stdin writes under Node.js, normalize missing-executable results in async and sync execution, and keep each in-flight runner's captured `errexit` setting.

## 0.21.3

### Patch Changes

- bc77d9a: Preserve exact multiline output, including missing final newlines, document safe
  multiline file writes, and keep shell settings stable for in-flight external
  commands.

## 0.21.2

### Patch Changes

- Document and lock in literal JSON interpolation across command arguments,
  author-written quote contexts, pipelines, and shell redirection.

## 0.21.1

### Patch Changes

- b854143: Document and lock down shell-like interpolation for pre-quoted values and
  author-written template quotes, including the legacy compatibility option.

## 0.21.0

### Minor Changes

- Reject terminal interactions that contain neither an action nor a wait instead
  of silently ignoring them. Invalid initial interactions now fail before a PTY
  is opened, and invalid `session.send()` input fails before waiting or writing.

  Interpolate every value as exactly one literal argument, like `"$var"` in a
  POSIX shell. `quote()` no longer treats a value that starts and ends with a
  matching quote as ready-made shell syntax: those quote characters are part of
  the value, so a path such as `/My Documents/report.txt` (or a pre-quoted one)
  reaches the command intact (issue #41). This matches `sh`, Bun's `$`, zx and
  execa, and it removes two defects of the old heuristic - `quote('"it\'s"')`
  emitted the unterminated string `'"it\'s"'`, and a value like
  `"' ; touch /tmp/pwned ; '"` was spliced in as shell syntax and executed. The
  previous behavior is available for balanced values only, via
  `shell.preQuotedPassthrough(true)`, `setPreQuotedPassthroughEnabled(true)`, or
  `COMMAND_STREAM_PREQUOTED_PASSTHROUGH=1`.

  Also ignore `EPIPE` when a pipeline stage closes the stdin of a process that
  has already exited. Closing (or writing to) that pipe is a normal race in a
  pipeline - a shell ignores it - but the streaming pipeline let the rejection
  escape as an unhandled error, which could fail an otherwise successful
  command. This matches the Rust implementation, which already discards those
  write and shutdown errors.

## 0.20.4

### Patch Changes

- 626cf46: Fix shell quote removal so interpolated values containing spaces (e.g. GitHub search labels) reach commands as a single argument.

  Previously `$\`gh issue list --label "${label}"\``(with`label = "help wanted"`) failed because command-stream only stripped quotes from wholly-quoted words. Mid-word quotes such as `label:"help wanted"`were left intact or split incorrectly, diverging from POSIX`sh`.

  The parser now performs POSIX-style quote removal per argument (single quotes are literal; double quotes honor `\` escapes for ``$ ` " \``; backslash escapes outside quotes on POSIX platforms), so quoted and unquoted pieces concatenate into one argument — matching `/bin/sh`. Virtual commands (`echo`, custom handlers) receive the quote-removed value, while the original word is preserved for faithful re-serialization to a real shell. On Windows an unquoted backslash is kept literal so paths such as `cd C:\Users\foo` survive intact. The Rust implementation is updated in parity.

## 0.20.3

### Patch Changes

- d4fbd50: Route redirections and expansions to the system shell so they are no longer
  silently swallowed by built-in commands (#46).

  `needsRealShell()` was only consulted when the command also contained `&&`,
  `||`, `;`, `&` or `(`, and redirection characters are not part of that operator
  set. A command whose first word is a built-in (`echo`, `cat`, `true`, `ls`,
  `seq`, ...) was therefore dispatched in-process with the operators passed
  through as literal arguments: `echo hello > out.txt` printed `hello > out.txt`
  and wrote no file, and `git push origin main 2>&1` reported exit code 0 with
  empty output even when the push had failed. The verdict is now independent of
  the operator set, and `>`, `>>`, `<`, `2>`, `&>`, `>&` and `<<` are recognised
  as requiring a real shell, matching `/bin/sh` behaviour. Redirection characters
  inside quotes stay literal, as in `sh`.

## 0.20.2

### Patch Changes

- a00126b: Update the development toolchain (eslint, prettier, jscpd, lint-staged, changesets, node-pty, subset-font) to versions with no outstanding npm or bun audit findings, and reformat `terminal-artifacts.mjs` for prettier 3.9. No runtime behaviour changes.

## 0.20.1

### Patch Changes

- e47f684: Track virtual `cd` changes in invocation-local cwd and environment state, including overlapping commands, subshells, and explicit `cwd` command chains, without mutating the host working directory or `PWD`/`OLDPWD`.

## 0.20.0

### Minor Changes

- 9042b5d: Quote interpolated values according to the shell quoting context they land in.
  A value inside quotes written by the author is now spliced in as escaped literal
  text, exactly like `"$var"` in a POSIX shell, instead of being wrapped in a
  second pair of quotes. This fixes the common `` $`bash -c "${cmd}"` `` form,
  which previously produced `bash -c "'...'"` and failed (issue #49), while
  remaining injection-safe: an interpolated value still cannot close a quote or
  start a new command. Commands containing backslash escapes are routed to the
  system shell so escapes are removed exactly as POSIX specifies. `raw()` and
  `literal()` are unchanged, and the previous always-quote behavior is available
  via `shell.quoteContext(false)`, `setQuoteContextEnabled(false)`, or
  `COMMAND_STREAM_QUOTE_CONTEXT=0`.

## 0.19.0

### Minor Changes

- 2236e65: Add a CommonJS entry point (`src/$.cjs`) published under the `require` export condition, so `require('command-stream')` returns the callable `$` with every named export attached and CommonJS hosts can use the synchronous `ProcessRunner.sync()` API without `await import()`. Both entry points load one shared module instance, so virtual commands, shell settings, and cleanup state stay in sync regardless of how the package was loaded.

## 0.18.2

### Patch Changes

- 7b2911a: Support `{ mode: 'shell', file, args }` ProcessRunner specifications for commands that require the platform shell, including Windows `.cmd` shims. Async and sync execution now delegate this form to Node's shell-enabled spawn APIs while preserving the existing streaming, capture, stdin, cwd, environment, and result behavior.

## 0.18.1

### Patch Changes

- 9ac5b4a: Add a lightweight `command-stream/process-runner` export that excludes optional PTY and terminal rendering dependencies from its module graph.

## 0.18.0

### Minor Changes

- Add `openTerminal()`, an incremental PTY session alongside `captureTerminal()`: the child stays alive with no implicit timeout, `waitFor()` reuses the existing readiness matcher (including `idleMilliseconds`), `send()` accepts the `interactions` vocabulary at any later point, and `close()`/`dispose()` return the usual frames, transcript, and asciicast. `captureTerminal()` is now implemented on top of it.

  Stream compound commands progressively while preserving virtual-command dispatch, nested-process cancellation, and safe real-shell fallback.

## 0.17.2

### Patch Changes

- 6e89fc4: Render terminal SVG text at its visible cell-grid position and width without
  stretching glyphs across leading or trailing row padding.

## 0.17.1

### Patch Changes

- 2e89d4e: Fix GIF terminal artifact rendering on Node.js by supporting the CommonJS
  default export exposed by `gifenc`.

## 0.17.0

### Minor Changes

- 2549f26: Add regex readiness markers and per-interaction output-idle waits to PTY terminal
  capture, enabling deterministic end-to-end TUI navigation with raw key
  sequences.

## 0.16.0

### Minor Changes

- 00cf1ad: Render faithful terminal SVG and GIF artifacts with styled cells, exact grid geometry, embedded subset fonts, real CSS animation timing, and configurable capture geometry.

## 0.15.0

### Minor Changes

- 4b8a864: Add PTY-backed terminal capture with resize and input control, settled frame
  deduplication, unrolled text transcripts, asciicast v2 interchange, and animated
  SVG recording artifacts.

### Patch Changes

- d917186: Preserve the current terminal frame before a later full-screen repaint,
  including when its control sequence is split across PTY output chunks.

## 0.14.1

### Patch Changes

- 891f1a1: Clarify and diagnose Go/Docker template arguments that contain an internal space (issue #172).

  A literal template token such as `--format {{json .Config.Env}}` contains an unquoted space, so `command-stream` splits it into separate argv words — exactly as a POSIX shell (`bash`) would. This made Docker report `template parsing error: ... unclosed action`, while a space-free `{{.Id}}` worked, which was surprising and hard to diagnose.

  This is shell-faithful behavior, not a bug: quoting (`'{{json .Config.Env}}'`), double-quoting, or interpolating the whole token as a single `${value}` all pass it through untouched. To make the failing case easy to spot:
  - **Diagnostics**: when a built command contains an unquoted `{{ … }}` token with an internal space, `command-stream` now prints a one-line warning to stderr pointing at the gotcha (fired once per unique token, silenced via `COMMAND_STREAM_NO_TEMPLATE_WARNING=1`).
  - **Docs**: a new "Go templates & `{{ }}` arguments" section in the README documents the works/breaks/workaround patterns.
  - A runnable `examples/go-template-arguments.mjs` demonstrates each pattern.

## 0.14.0

### Minor Changes

- Add `exitCode` as an alias for the `code` property on all command result objects (issue #36). Code written against the `exitCode` convention (e.g. `child_process` / `execa`) now works without changes, while the existing `code` property remains fully supported.

## 0.13.0

### Minor Changes

- Handle `getcwd() failed` errors gracefully during subshell execution (issue #44).

  `process.cwd()` throws `getcwd() failed: No such file or directory` when the current working directory has been deleted or becomes inaccessible (common in CI/CD with temporary directories). Subshell execution and directory restoration now degrade gracefully instead of crashing:
  - capturing the working directory before a subshell no longer throws when `getcwd()` fails
  - directory restoration falls back to a safe location (`HOME`, then `/`) when the original directory is gone
  - simple commands fall back to the inherited `cwd` when `getcwd()` is unavailable
  - spawning a child process no longer fails with `posix_spawn ENOENT` when the inherited working directory has been deleted; the process is launched from a valid fallback directory (`HOME`, `USERPROFILE`, the temp dir, then `/`) instead

  Make the built-in `cd` command fully `sh`/bash compatible so shell scripts translate directly to `.mjs` (issue #50):
  - `cd -` switches to the previous directory and prints it, like `sh`
  - `~` and `~/path` tilde expansion
  - successful `cd` updates the `PWD` and `OLDPWD` environment variables
  - relative targets resolve against the `cwd` option for consistency

  Also documents the working-directory behavior (persistence across commands, subshell isolation, and `cd` vs. the `cwd` option) in the README.

  Fix CI false positives where a global teardown preempted an in-flight, awaited command (issue #170).

  Three related defects made tests intermittently report a `SIGTERM` result (exit code 143) and emit a `MaxListenersExceeded` warning, most visibly on Windows/Bun. All are now keyed on a new `_awaited` flag, set synchronously when user code starts consuming a runner (`await`/`then`/`catch`/`finally`/`stream`):
  - `_handleParentStreamClosure()` killed any active runner when a parent `stdout`/`stderr` `close` event fired. On Windows/Bun the parent `WriteStream` can emit a spurious `close` (the same instability behind the `MaxListenersExceeded` warning), which preempted the awaited command and replaced its real exit code with `143`. It now skips runners that are being awaited, since the `await` is the authoritative consumer. This was the actual CI trigger.
  - `cleanupActiveRunners()` (invoked by `resetGlobalState()` between tests) could force-kill a command that user code was still awaiting, replacing its real exit code with a synthetic SIGTERM result. The reaper now skips awaited, unfinished runners.
  - `monitorParentStreams()` attached a `close` listener to `process.stdout`/`process.stderr` on every `ProcessRunner` construction but never removed them on reset, so they accumulated until Node/Bun emitted a `MaxListenersExceeded` warning. The listeners are now tracked and removed in `resetGlobalState()`/`resetParentStreamMonitoring()`.

## 0.12.0

### Minor Changes

- 9a35335: Fix `stream()` async iterator to yield exit chunks and never hang on open pipes (issue #155)
  - `stream()` now yields a final `{ type: 'exit', code }` chunk when the process
    exits, so the documented `chunk.type === 'exit'` handling is no longer dead
    code. Consumers that touch `chunk.data` must guard on `chunk.type` first.
  - Both `stream()` and awaiting a command no longer hang forever when the process
    has exited but a grandchild keeps the stdio pipes open (e.g.
    `sh -c 'long-task & echo done'`). The command resolves as soon as the process
    exits; remaining buffered output is drained within a short grace period before
    the lingering reads are aborted.
  - The grace period is configurable via the `exitPumpGrace` option (milliseconds,
    default `100`). For ordinary commands the pumps drain immediately, so the grace
    adds no latency — it only bounds the wait in the grandchild-holds-pipe case.
  - A long-running command can be stopped from inside the `stream()` loop, either by
    calling `kill()` (the loop then ends with a terminating `exit` chunk) or by
    `break`ing out of the loop (which kills the process as the iterator unwinds).
  - The stop signal is configurable via the new `killSignal` option (default
    `SIGTERM`). An argument-less `kill()`, a `break`, and an external `AbortSignal`
    all use it; an explicit `kill(signal)` argument still overrides it. Exit codes
    follow the conventional `128 + signal` mapping (e.g. `SIGINT` => 130).
  - Awaiting a command while an external `AbortSignal` fires no longer hangs: the
    abort listener is now registered on the await/then path too, so the command
    resolves promptly with the configured signal's exit code.

## 0.11.1

### Patch Changes

- a8caefd: Fix false-positive releases and the "failed to deploy" restart in the JavaScript
  release pipeline (issue #166):
  - `publish-to-npm.mjs`: only report success when output-scan, exit code, and an
    `npm view` registry check all agree — a failed `changeset publish` (e.g. npm
    E404) can no longer create a GitHub release for a version that never reached
    npm.
  - `check-release-needed.mjs`: always probe npm and emit `current_unpublished`,
    so a version that was committed to `main` but never published self-heals on the
    next push regardless of changeset state (closes the restart that "failed to do
    any deploy").
  - New `wait-for-npm.mjs` step verifies, after publish, that the exact version is
    actually installable from npm — turning any "tagged but not on npm" divergence
    into a hard CI failure.
  - `setup-npm.mjs` now asserts npm ≥ 11.5.1 (required for OIDC trusted
    publishing) and `create-github-release.mjs` caps the release-notes body and is
    idempotent on an already-existing release.

## 0.11.0

### Minor Changes

- Add `literal()` function to preserve apostrophes in shell arguments

  When passing text containing apostrophes to programs that store it literally (like API calls via CLI tools), apostrophes would appear corrupted as triple quotes (`'''`). The new `literal()` function uses double-quote escaping which preserves apostrophes while still escaping shell-dangerous characters.

  **New features:**
  - `literal(value)` - Mark text for double-quote escaping, preserving apostrophes
  - `quoteLiteral(value)` - Low-level function for manual command building

  **Usage:**

  ```javascript
  import { $, literal } from 'command-stream';

  // Apostrophes now preserved for API storage
  const notes = "Dependencies didn't exist";
  await $`gh release create --notes ${literal(notes)}`;
  ```

## 0.10.2

### Patch Changes

- 7185b33: Prevent false-positive GitHub releases when the npm publish actually failed
  (#166). `scripts/publish-to-npm.mjs` relied on command-stream's `$` throwing on
  a non-zero exit, but `$` does not throw by default (errexit is off, see #156),
  so a failed `changeset publish` (e.g. an npm E404) was still reported as
  `published=true` and a GitHub release was created for a version that never
  reached npm. The publish step now confirms success with three independent
  checks — output-pattern scan, exit code, and an `npm view` registry
  verification — and fails the job otherwise. `scripts/create-github-release.mjs`
  and `scripts/version-and-commit.mjs` were hardened against the same
  non-throwing-`$` false-positive class.

## 0.10.1

### Patch Changes

- b5f7309: Update the JavaScript release workflow to the action versions used by the
  pipeline templates (`actions/checkout@v6`, `actions/setup-node@v6`,
  `peter-evans/create-pull-request@v8`), clearing the Node.js 20 deprecation
  warnings emitted by GitHub Actions.

## 0.10.0

### Minor Changes

- a6f0693: Add chainable `.quiet()` method on `ProcessRunner` to suppress console output
  (mirroring) for a single command while still capturing its result, matching the
  behavior of zx's `quiet()` (issue #136).

  ```javascript
  // Suppress console output but still capture the result
  const result = await $`gh api gists/${gistId} --jq '.files'`.quiet();
  ```

## 0.9.6

### Patch Changes

- Ensure the JavaScript release job still evaluates on main pushes after the
  pull-request-only changeset gate is skipped.

  Separate JavaScript package metadata, scripts, documentation, and release tags
  from the Rust crate release path.

## 0.9.5

### Patch Changes

- Document try/catch anti-pattern with errexit=false default (issue #156)
  - Add js/docs/case-studies/issue-156/README.md with comprehensive case study including:
    - Reconstructed timeline and sequence of events from calculator#78 silent bug
    - Root cause analysis with code evidence from command-stream source
    - Bash vs command-stream behavior comparison table
    - Full configuration API documentation (shell.errexit(), set(), unset())
    - Recommended patterns for mixed strict/optional error handling
    - Comparison with similar libraries (execa, zx, bash, child_process)
    - Proposed solutions ranked by impact
  - Add Pitfall #7 to js/BEST-PRACTICES.md: try/catch anti-pattern with errexit=false, with examples and correct fix patterns
  - Add 4 reproducible experiment scripts in experiments/issue-156/:
    - 01-default-behavior.mjs — demonstrates default errexit=false behavior
    - 02-errexit-enabled.mjs — demonstrates shell.errexit(true) configuration
    - 03-bash-comparison.sh — bash set -e reference comparison
    - 04-calculator-bug-repro.mjs — exact reproduction of calculator#78 bug

  Publish the Rust crate from CI, sync Cargo release versions, and harden shell option isolation in Bun tests.

## 0.9.4

### Patch Changes

- 3265939: Document Array.join() pitfall and add best practices (fixes #153)
  - Add js/BEST-PRACTICES.md with detailed usage patterns for arrays, security, and error handling
  - Add Common Pitfalls section to README.md explaining the Array.join() issue
  - Add js/docs/case-studies/issue-153/ with real-world bug investigation from hive-mind#1096
  - Add rust/BEST-PRACTICES.md for Rust-specific patterns
  - Add 34 tests for array interpolation covering correct usage and anti-patterns
  - Reorganize file structure: move JS-related docs to js/ folder, case studies to js/docs/case-studies/

## 0.9.2

### Patch Changes

- 535eb02: Reorganize Rust code with modular utilities (matching JS pattern)
  - Extract trace.rs (152 lines) - Logging and tracing utilities
  - Extract ansi.rs (194 lines) - ANSI escape code handling
  - Extract quote.rs (161 lines) - Shell quoting utilities
  - Update utils.rs to re-export from new modules and focus on CommandResult/VirtualUtils
  - Update lib.rs with new module declarations and re-exports

  The Rust structure now mirrors the JavaScript modular organization for consistency.
  All modules remain well under the 1500-line limit guideline.

## 0.9.1

### Patch Changes

- 38dc1c3: Reorganize codebase with modular utilities for better maintainability
  - Extract trace/logging utilities to $.trace.mjs
  - Extract shell detection to $.shell.mjs
  - Extract stream utilities to $.stream-utils.mjs and $.stream-emitter.mjs
  - Extract shell quoting to $.quote.mjs
  - Extract result creation to $.result.mjs
  - Extract ANSI utilities to $.ansi.mjs
  - Extract global state management to $.state.mjs
  - Extract shell settings to $.shell-settings.mjs
  - Extract virtual command registration to $.virtual-commands.mjs
  - Add commands/index.mjs for module exports
  - Update $.utils.mjs to use shared trace module

  All new modules follow the 1500-line limit guideline. The Rust code
  structure already follows best practices with tests in separate files.

## 0.9.0

### Minor Changes

- 60e2a36: Add Rust translation and reorganize codebase
  - Reorganize JavaScript source files into `js/` folder structure
  - Move tests from root `tests/` to `js/tests/`
  - Add complete Rust translation in `rust/` folder with:
    - Shell parser supporting &&, ||, ;, |, (), and redirections
    - All 21 virtual commands (cat, cp, mv, rm, touch, mkdir, ls, cd, pwd, echo, yes, seq, sleep, env, which, test, exit, basename, dirname, true, false)
    - ProcessRunner for async command execution with tokio
    - Comprehensive test suite mirroring JavaScript tests
    - Case study documentation in docs/case-studies/issue-146/

## 0.8.3

### Patch Changes

- 0e1c9e0: Fix trace logs interfering with output when CI=true
  - Removed automatic trace log enabling when CI environment variable is set
  - Trace logs no longer pollute stderr in CI/CD environments (GitHub Actions, GitLab CI, etc.)
  - Added COMMAND_STREAM_TRACE environment variable for explicit trace control
  - COMMAND_STREAM_TRACE=true explicitly enables tracing
  - COMMAND_STREAM_TRACE=false explicitly disables tracing (overrides COMMAND_STREAM_VERBOSE)
  - COMMAND_STREAM_VERBOSE=true continues to work as before
  - JSON parsing works reliably in CI environments

  Fixes #135

## 0.8.2

### Patch Changes

- b3dac3d: Add Windows shell detection support
  - Added Windows-specific shell detection (Git Bash, PowerShell, cmd.exe)
  - Use 'where' command on Windows instead of 'which' for PATH lookups
  - Fallback to cmd.exe on Windows when no Unix-compatible shell is found
  - Updated timing expectations in tests for slower Windows shell spawning
  - Created case study documentation for Windows CI failures (Issue #144)

## 0.8.1

### Patch Changes

- Test patch release

## 0.8.0

### Minor Changes

- f4dbb49: Transition to new CI/CD template with modern best practices

  Features:
  - Changeset-based versioning for semantic version management
  - OIDC trusted publishing to npm (no tokens required)
  - Manual and automatic release workflows
  - Multi-platform testing (Ubuntu, macOS, Windows)
  - Node.js compatibility testing (v20, v22, v24)
  - ESLint + Prettier with Husky pre-commit hooks
  - Code duplication detection with jscpd
  - Consolidated release workflow for all publishing

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.7.1

### Patch Changes

- Current stable release with streaming support, async iteration, and EventEmitter support
