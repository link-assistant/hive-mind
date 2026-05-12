# Case Study: Issue #1649 - Convert `hive-screens.sh` into a `hive-screens` command

- Issue: [link-assistant/hive-mind#1649](https://github.com/link-assistant/hive-mind/issues/1649)
- Prepared fix PR: [link-assistant/hive-mind#1650](https://github.com/link-assistant/hive-mind/pull/1650)
- Related command: [`start-screen`](../../../src/start-screen.mjs) — existing bin that creates GNU screen sessions for solve/hive.

## Summary

`README.md` ships a `hive-screens.sh` bash script (via a large `cat <<EOF` block)
that scans detached GNU screen sessions, extracts their scrollback, matches the
ones that completed a solve run (`process completed` plus `pr is mergeable!` /
`pr merged!`), and either enters or closes them. Users must copy the script out
of the README to use it.

Issue #1649 asks to replace that snippet with a real JavaScript command,
`hive-screens`, shipped as a bin entry of the `@link-assistant/hive-mind`
package, with `--enter`, `--close`, and `--list` flags. `--list` must share the
exact matching logic used by `--enter` and `--close`, so that a safe `--list`
preview guarantees what the dangerous `--close` will act on.

## Requirements

Directly from the issue:

1. Convert the `Script for managing screens` sh script in `README.md` into a
   JavaScript command called `hive-screens`.
2. Ship that command as a bin of the `@link-assistant/hive-mind` npm package
   (so `npx hive-screens` and `/usr/local/bin/hive-screens` both work).
3. Support `--enter`, `--close`, `--list` in the same style as the sh script.
4. All three flags must share the **same matching function**, so that any
   session that appears in `--list` is guaranteed to be handled by `--enter`
   and `--close`. `--list` becomes the safe debugging tool for `--close`.
5. Update `README.md` to document how to run the new command, and remove the
   embedded sh script.
6. Preserve the sh script's auxiliary flags that control which matched
   sessions are acted on: `--oldest`, `--newest`, `--all`. The default remains
   `--oldest`.
7. Collect issue-related data into `docs/case-studies/issue-1649` and write a
   case-study analysis (this document) with deep-dive, solution plans, and a
   survey of existing components that could help.

## Source sh script behaviour (canonical specification)

The script lives in `README.md` under `## Maintenance` → `### Script for
managing screens`. Distilled behaviour, to be preserved 1:1 by the JS port:

1. **Arg parsing** — recognizes `--enter`, `--close`, `--oldest`, `--newest`,
   `--all`. Unknown args exit with code 1 and `Unknown option: <arg>`.
2. **Validation** — at least one of `--enter` or `--close` must be set; else
   `Must specify --enter or --close` and exit 1.
3. **Selection defaults** — if none of `--oldest/--newest/--all` is set,
   `--oldest` is the default.
4. **Sort order** — detached sessions are read from `screen -ls` and sorted:
   - `sort -n` (ascending lexical/numeric) for `--oldest`/default.
   - `sort -nr` (descending) for `--newest`.
5. **Matching** — for each detached session:
   - Temporarily set scrollback to `200000` lines.
   - Capture a hardcopy to a temp file (`screen -X hardcopy -h`).
   - Strip non-printable characters.
   - The session matches iff the scrollback contains both
     (case-insensitive):
     - `process completed`, and
     - `pr is mergeable!` or `pr merged!`.
   - If matched, extract the last `Full log file: <path>` and last
     `Issue: https://github.com/...` for reporting.
6. **No matches** — print `No matching sessions` and exit 0.
7. **Action** — for the selected matches (oldest / newest / all), print the
   session name, log path, issue URL, then:
   - If `--enter`, run `screen -r <sess>` (blocking; control returns to the
     user's terminal).
   - If `--close`, send `exit\n` via `screen -X stuff` so the wrapper shell
     exits cleanly.
   - Always print a `-----------------------------------` separator between
     sessions.

## Solution Plan

Implementation mirrors the existing `configure-claude` lib + bin split:

- `src/hive-screens.lib.mjs` — testable pure functions and IO helpers:
  - `parseHiveScreensArgs(argv)` — args → `{enter, close, selection, help}`.
  - `listDetachedSessions(exec)` — runs `screen -ls`, returns `string[]` in
    oldest-first order.
  - `captureSessionScrollback(exec, session, { scrollback, settleMs })` —
    performs the `screen -X scrollback` + `screen -X hardcopy -h` dance,
    reads the file, strips non-printable characters, returns plain text.
  - `sessionMatches(text)` — the shared matching predicate, returns
    `{ matched, logPath, issueUrl }` using the same regexes as the sh script
    (`/process completed/i`, `/pr is mergeable!|pr merged!/i`,
    `/Full log file:\s*(.+)$/i`, `/Issue:\s*(https:\/\/github\.com\/\S+)/i`).
  - `findMatchingSessions({ exec, fs, order })` — orchestrator that returns
    the ordered list of matches. Used verbatim by `--list`, `--enter`, and
    `--close`, guaranteeing parity.
  - `selectMatches(matches, selection)` — applies `oldest / newest / all`.
  - `runHiveScreens(args, deps)` — top-level orchestrator that prints output
    and performs enter/close side-effects. `deps` is injected for tests.
- `src/hive-screens.mjs` — thin bin wrapper, same shape as
  `src/configure-claude.mjs`.
- `package.json` — add `"hive-screens": "./src/hive-screens.mjs"` under `bin`,
  and include the script in `build:pre` so release marks it executable.
- `tests/test-hive-screens.mjs` — unit tests for `parseHiveScreensArgs`,
  `sessionMatches` (positive and negative fixtures derived from the sh
  grep logic), `selectMatches`, and the bin contract (arg validation,
  `--help`, `--list` with no sessions).
- `README.md` — replace the embedded sh script with a short usage block that
  points at `hive-screens --list / --enter / --close [--oldest|--newest|--all]`.

### Why a shared `sessionMatches`?

The key safety property from issue #1649:

> if we see it in list we will be sure it will also work with enter and close

is exactly the test-theoretic invariant `list == enter == close` over the
matching predicate. Keeping `sessionMatches` and `findMatchingSessions` as
the single entry point used by all three flags makes this a structural
guarantee rather than three parallel grep pipelines that can drift.

### Existing components considered

- **[`screen(1)`](https://www.gnu.org/software/screen/manual/screen.html)** —
  the only sensible way to drive detached sessions is the `screen -X`
  command family already used by the sh script and `src/start-screen.mjs`.
  We keep child-process calls to `screen` and do not introduce a wrapper
  library.
- **`src/start-screen.mjs`** — already uses `screen -ls` + `screen -X stuff`
  via `child_process.exec`. We reuse the same `promisify(exec)` pattern and
  the same shell-escaping conventions so the two commands feel native.
- **`src/session-monitor.lib.mjs`** — has `checkScreenSessionExists` built
  on `screen -ls`. We do not import it (its contract is "substring match in
  `screen -ls`"; we need the full detached-session list), but we match its
  style and keep both implementations close so future consolidation is
  easy.
- **npm packages like `node-screen`, `screenjs`** — none of these wrap GNU
  screen in the way we need, and adding a dependency for 4 shell-outs would
  be overkill given the code size.

## Data Inventory

Raw evidence is preserved under `source-data/`:

- `source-data/github/issue-1649.json` — issue metadata.
- `source-data/github/issue-1649-comments.json` — issue comments (empty
  at time of capture).
- `source-data/github/pr-1650.json` — work-in-progress PR metadata.

## Out of Scope

- Rewriting `start-screen.mjs` or `session-monitor.lib.mjs`. `hive-screens`
  is additive.
- Supporting backends other than GNU screen (tmux, docker isolation) — the
  sh script was screen-only and the issue does not ask for more.
- Automatically migrating existing deployments of `hive-screens.sh`; users
  can delete the old file and run `hive-screens` instead.
