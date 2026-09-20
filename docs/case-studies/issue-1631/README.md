# Case Study: Issue #1631 — Solve.mjs can't post tool comments after #1626

- **Issue**: [link-assistant/hive-mind#1631](https://github.com/link-assistant/hive-mind/issues/1631)
- **Pull Request**: [link-assistant/hive-mind#1632](https://github.com/link-assistant/hive-mind/pull/1632)
- **Regression introduced by**: [#1626](https://github.com/link-assistant/hive-mind/pull/1626) (merged 2026-04-17)
- **Related Issue**: [#1625](https://github.com/link-assistant/hive-mind/issues/1625) (the feature that #1626 implemented)
- **First released broken in**: `v1.53.1`
- **Observed on external PR**: [Jhon-Crow/godot-topdown-MVP#1870](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1870)

## Summary

After merging PR #1626 (`v1.53.1`), every solve.mjs invocation that tried to
post a tool-authored GitHub comment — `AI Work Session Started`, ready-to-merge,
log-upload link, usage-limit notice, etc. — returned **HTTP 400 Bad Request**
from `gh api`, accompanied by GitHub's generic `"Whoa there!"` HTML page (the
anti-abuse/edge rejection page, served _before_ the API layer runs).

Consequences observed across six user-supplied logs:

- `AI Work Session Started` comment never posted at session start.
- `Solution Draft Log` comment never posted at session end (log uploaded to
  Gist successfully, but the PR comment linking to it failed).
- `Ready to merge` and `Auto-merged` status comments never posted.
- Subsequent retries of solve.mjs would sometimes eventually succeed after long
  delays (7 – 45 minutes), creating the impression that "everything is
  broken" — the user explicitly considered reverting to `v1.53.0`.

## Timeline of events

All times UTC. Version history from `git log`:

| Time                 | Event                                                                                 | Source                                                            |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 2026-04-17T(pre)     | PR #1626 introduces `src/tool-comments.lib.mjs` with `postTrackedComment()` helper    | commit `8936a32f`                                                 |
| 2026-04-17T(merge)   | PR #1626 merged to `main`                                                             | commit `186e5ded`                                                 |
| 2026-04-17T(release) | `v1.53.1` tagged with the new helper                                                  | commit `5357f4fb`                                                 |
| 2026-04-17T20:32:44Z | First user report: `gh: HTTP 400` on comment post (gist `29407cc`)                    | user log                                                          |
| 2026-04-17T20:42:52Z | Second report: same 400, this time on log-upload comment (gist `f74f24d` / `cbc94f7`) | user log                                                          |
| 2026-04-17T20:51:12Z | Third report: 400 on log-upload, succeeded eventually via retry (gist `9df13d5`)      | user log                                                          |
| 2026-04-17T20:54:42Z | Fourth report: 400 on session-start comment, succeeded eventually 33 min later        | user log                                                          |
| 2026-04-17T20:55:25Z | Fifth report: near-duplicate of the fourth                                            | user log                                                          |
| 2026-04-17T21:04:18Z | Sixth report: 400 on log-upload, full failure — no comment posted (gist `32e805d`)    | user log                                                          |
| 2026-04-17T21:10Z    | Issue #1631 opened                                                                    | [#1631](../../../issue-1631)                                      |
| 2026-04-17T22:00:40Z | AI work session began on #1631                                                        | [PR #1632](https://github.com/link-assistant/hive-mind/pull/1632) |

All six raw logs are referenced by gist URL in [`data/log-urls.json`](data/log-urls.json)
(they are multi-MB and would bloat the repo). A focused excerpt around each
HTTP 400 is checked in at [`data/log-excerpts.txt`](data/log-excerpts.txt).

## Root cause

`postTrackedComment()` in `src/tool-comments.lib.mjs` (introduced by #1626) posts
the comment body to GitHub's `POST /repos/:o/:r/issues/:n/comments` endpoint by
piping a JSON payload to `gh api … --input -` via command-stream's options bag:

```js
// src/tool-comments.lib.mjs — the buggy invocation
const payload = JSON.stringify({ body });
result = await $({ input: payload })`gh api ${apiPath} -X POST --input -`;
```

The command-stream library (`node_modules/command-stream`, v0.9.4) does **not**
recognise an `input` option. Its documented option name is `stdin` — verified
in the library README, in `$.process-runner-base.mjs` (`handleStdin()` only
branches on `stdin === 'inherit' | 'ignore' | string | Buffer`), and in
existing correct usage elsewhere in the repo:

- `src/claude.lib.mjs:810` — `$({ cwd, stdin: prompt, mirror: false, env })\`${claudePath}…\``
- `scripts/create-github-release.mjs:81` — `$\`gh api … --input -\`.run({ stdin: payload })`
- `scripts/format-release-notes.mjs:233` — `$\`gh api … -X PATCH --input -\`.run({ stdin: payload })`

With the misnamed `input:` option silently ignored, command-stream's `stdin`
fell back to the default `'inherit'`. `handleInheritStdin()` then wired the
child's stdin to the **parent process's** stdin — which for solve.mjs is
either a TTY attached to the caller's shell or a pipe that has already been
consumed/closed. `gh api --input -` therefore read an empty / already-closed /
unrelated stream, produced an empty `POST` body, and GitHub's edge tier
rejected the request with the generic `400 "Whoa there!"` HTML page. The JSON
API layer never saw the request, which is why the error payload is HTML rather
than the usual GitHub API JSON error.

### Why it was missed

`tests/test-solution-summary.mjs` (added alongside #1626) mocks `$` with a
callable that ignores its options and returns a canned JSON response. The
mock happily accepts `{ input: … }` because it never inspects the options bag
— the exact same footgun documented in [`docs/case-studies/issue-1532/README.md`](../issue-1532/README.md)
for `promisify(execFile)`'s ignored `input` option.

## Requirements from the issue

1. **Download all related logs and data to the repository** →
   [`data/log-urls.json`](data/log-urls.json) catalogs every user-linked gist;
   [`data/log-excerpts.txt`](data/log-excerpts.txt) contains the failure
   excerpts from all six logs (the full multi-MB logs live in the referenced
   gists to avoid bloating the repo).
2. **Compile a case study** → this document.
3. **Reconstruct timeline** → see "Timeline of events" above.
4. **List all requirements from the issue** → this list.
5. **Find root cause for each problem** → single root cause for all six logs:
   the `input` vs `stdin` option-name mismatch in `postTrackedComment`.
6. **Propose solution plan** → see "Fix" below.
7. **Search online for existing components/libraries that solve a similar
   problem** → see "Existing libraries / patterns surveyed".
8. **If not enough data, add debug output / verbose mode** → the diagnostic
   info was already sufficient to find the root cause (the logs showed `gh: HTTP 400`
   plus the HTML body); no additional logging is required for this fix.
9. **Report issues in other repositories that are affected** → command-stream's
   silent ignore of unknown options is a usability trap worth documenting
   upstream. See "Related upstream issues".

## Fix

`src/tool-comments.lib.mjs` now passes the JSON body via the documented
`stdin` option:

```js
result = await $({ stdin: payload })`gh api ${apiPath} -X POST --input -`;
```

The patch is a one-line change plus inline documentation explaining the
footgun. The regression test asserts the option name explicitly so a rename
can't silently recur:

```js
// tests/test-solution-summary.mjs — new test
assertTrue(Object.prototype.hasOwnProperty.call(capturedOptions, 'stdin'), 'options bag must include `stdin` key (command-stream ignores `input`)');
assertFalse(Object.prototype.hasOwnProperty.call(capturedOptions, 'input'), 'options bag must NOT use legacy `input` key (silently ignored by command-stream)');
```

## Existing libraries / patterns surveyed

- **command-stream** (in-repo, v0.9.4) — the library whose misused option
  caused the bug. Documented option name: `stdin`.
- **execa** — widely-used child-process library; its option is `{ input: … }`.
  Adopting execa would make the original `{ input: payload }` line correct —
  but would introduce a new runtime dependency just to avoid a one-line fix.
  Not warranted.
- **`node:child_process` `execFile`/`spawn`** — also uses `input` under
  `promisify(execFile)`, which is exactly the trap documented in
  [issue #1532](../issue-1532/README.md). Same class of bug, different
  library.
- **Direct `gh api` with `--field body=@-`** — an alternative that doesn't
  require stdin piping. Rejected because the existing payload shape (`body`
  as a JSON string, nothing else) is already minimal and the stdin path works
  once the option name is correct.

## Related upstream issues

- **command-stream**: option-name typos are silently ignored. Recommend adding
  an unknown-option warning under a debug flag, or documenting the list of
  supported options prominently. Tracking as a follow-up — not blocking.
- Internal note: future `{ … }` options to `$(…)` that differ from the
  supported set (`stdin`, `cwd`, `env`, `mirror`, …) should be caught by a
  repo-local ESLint rule or a lightweight validator. Listed in
  "Follow-up tasks" below.

## Follow-up tasks (not in this PR)

- [ ] Add an ESLint rule (or a `tests/test-*` consistency check) that flags
      `$({ input: …, … })`/`$(…).run({ input: … })` since `input` is never a
      command-stream option.
- [ ] File an upstream issue/PR on command-stream to warn about unknown
      option keys.
- [ ] Audit every `$({ … })` options-bag usage in the repository for other
      silently-ignored keys.

## Reproduction

1. Check out any commit on or after `5357f4fb` (`v1.53.1`) and before the fix.
2. Run solve.mjs against any PR with `--watch` or `--auto-continue` so
   `startWorkSession()` is invoked:
   ```bash
   solve https://github.com/<owner>/<repo>/pull/<n> --tool claude --attach-logs --verbose --auto-continue
   ```
3. Observe the `gh: HTTP 400` line immediately after
   `📝 Converting PR: Back to draft mode...` in the log.

After the fix, the same invocation posts the session-start comment without
error and the log-upload comment carries a valid comment `id`.

## Evidence: raw log excerpts

### Session-start comment fails (log 4 / 5)

```
[2026-04-17T20:55:14.094Z] [INFO] 🔄 Checking out PR branch:   issue-1817-44a1ed5736dd
[2026-04-17T20:55:15.797Z] [INFO]   ✅ PR converted:           Now in draft mode
[2026-04-17T20:55:25.869Z] [STDOUT]
<html>… <h1>Whoa there!</h1> …</html>
[2026-04-17T20:55:25.870Z] [STDERR] gh: HTTP 400
[2026-04-17T21:28:13.119Z] [INFO]   💬 Posted:                 AI Work Session Started comment
```

The session start comment finally succeeded **33 minutes later** — a second,
retry-triggered solve.mjs invocation got further (the retry was caused by the
parent's CTRL+C handler re-entering the comment-post path under different
stdin conditions).

### Log-upload comment fails (logs 1 / 2 / 6)

```
[2026-04-17T21:04:57.207Z] [ERROR] ❌ Command failed: No messages processed
[2026-04-17T21:04:57.209Z] [INFO] 📄 Attaching failure logs to Pull Request...
[2026-04-17T21:05:01.442Z] [STDOUT] ✅ Gist created (🌐 public)
[2026-04-17T21:05:01.442Z] [STDOUT] 🔗 https://gist.github.com/konard/19845c36ad1ae80f6b76207a550be9f4
[2026-04-17T21:05:12.062Z] [STDOUT] <html>… <h1>Whoa there!</h1> …</html>
[2026-04-17T21:05:12.062Z] [STDERR] gh: HTTP 400
[2026-04-17T21:20:51.436Z] [INFO]   ❌ Failed to post comment with log link: gh: HTTP 400
[2026-04-17T21:20:51.436Z] [INFO]   ⚠️  Failed to upload failure logs
```

The Gist itself uploaded fine (15-second round-trip). The comment on the PR
linking to that Gist is what failed — and that comment goes through
`postTrackedCommentFromFile` → `postTrackedComment` → the misnamed `input:`
option. The "long delay before failure" pattern (20:51:12 → 21:26:28 on log 2,
21:05:12 → 21:20:51 on log 6) is solve.mjs's upstream retry loop retrying the
same broken code path until giving up.

## Source files touched

- `src/tool-comments.lib.mjs` — one-line fix: `input:` → `stdin:` in
  `postTrackedComment()`.
- `tests/test-solution-summary.mjs` — new regression test pinning the option
  name.
- `.changeset/` — patch-bump entry.
- `docs/case-studies/issue-1631/` — this case study, with log excerpts and
  full-log gist URLs under `data/`.
