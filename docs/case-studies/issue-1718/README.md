# Case Study: Issue #1718 — `/hive` reports success even when every solve worker fails

**Issue:** [link-assistant/hive-mind#1718](https://github.com/link-assistant/hive-mind/issues/1718)
**Pull Request:** [#1719](https://github.com/link-assistant/hive-mind/pull/1719)
**Triggering report:** [Telegram `/hive` run for `xlabtg/anti-corruption`](https://gist.githubusercontent.com/konard/0cf4ca016a593fff9812b5145ed98a8c/raw/7f353312d2ac5cfd557c6f75450aedc56b7bbfe7/938a9d28-8b2a-4cb0-aa37-35dc8bcac0d5.log)
**Labels:** `bug`
**Reported by:** @konard on 2026-04-29
**Status:** Implemented in PR #1719 — passthrough no longer forwards `false` for
string-typed solve options, and `hive` exits non-zero when any worker failed.

---

## 1. Reported observations (verbatim from the issue)

The `/hive` Telegram command reported a successful run while every single
worker had crashed:

```
✅ Work session finished successfully

⏱️ Duration: 1m 20s
📊 Session: dc59873a-23e8-4526-ac21-06d50ecf47ee
🔒 Isolation: screen
```

…even though the underlying log shows:

```
✅ All issues processed!
   Completed: 0
   Failed: 5
```

The bottom of the start-command log even confirms `Exit Code: 0`, which is what
ultimately caused the start-command wrapper to render the green
"Work session finished successfully" envelope.

The issue also says:

> _"First critical problem the hive command should return not success exit code
> when any task failing. Also we need to find root cause of all failures and fix
> them. It should just work."_
>
> _"Note that we should double check that like with /solve command, /hive
> command now uses latest `--isolation screen` to properly run solve command in
> `$` command."_
>
> _"We need to download all logs and data related about the issue to this
> repository, make sure we compile that data to `./docs/case-studies/issue-{id}`
> folder, and use it to do deep case study analysis […] reconstruct
> timeline/sequence of events, list of each and all requirements from the
> issue, find root causes of the each problem, and propose possible solutions
> and solution plans for each requirement […]"_
>
> _"If there is not enough data to find actual root cause, add debug output and
> verbose mode if not present, that will allow us to find root cause on next
> iteration."_

---

## 2. Source data captured for this case study

| Path                                             | What it is                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [`data/issue-1718.json`](./data/issue-1718.json) | Raw JSON of the GitHub issue.                                                                 |
| [`data/full-log.txt`](./data/full-log.txt)       | The 239-line start-command log linked from the issue (downloaded from gist, 24 KB).           |
| [`facts.md`](./facts.md)                         | The exact lines from the log that prove each symptom, with line numbers.                      |
| [`root-causes.md`](./root-causes.md)             | Per-symptom root cause analysis with file/line citations into `src/`.                         |
| [`solution-plans.md`](./solution-plans.md)       | Per-requirement solution plan with the library/component context already present in the repo. |
| [`upstream.md`](./upstream.md)                   | Upstream / third-party considerations (yargs boolean-vs-string interaction).                  |

Anyone trying to reproduce the case can rerun the failing forwarding logic
locally with the unit test in
[`tests/test-issue-1718-hive-passthrough-false.mjs`](../../../tests/test-issue-1718-hive-passthrough-false.mjs).

---

## 3. Timeline / sequence of events

| Time (UTC)              | Event                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-29 10:26:56.208 | `/hive` is invoked from Telegram bot for `https://github.com/xlabtg/anti-corruption` (`isolation=screen`, detached). Start-command writes its banner. |
| 2026-04-29 10:27:00.312 | `hive` boots, opens its own log `/home/box/hive-2026-04-29T10-27-00-312Z.log`, validates auth + Claude CLI.                                           |
| 2026-04-29 10:27:05     | Issue list fetched: 5 open issues, none with PRs. All five queued.                                                                                    |
| 2026-04-29 10:27:29     | Workers 1+2 spawn `solve` for issues #5 and #3. Both `solve` invocations contain the trailing tokens `--working-session-live-progress false`.         |
| 2026-04-29 10:27:30     | Both `solve` processes immediately exit 1 with `❌ Invalid --working-session-live-progress value: "false". Expected "comment" or "pr".`               |
| 2026-04-29 10:27:39     | Workers retry with the next queued issues (#6, #9). Same crash.                                                                                       |
| 2026-04-29 10:27:48     | Final issue #11 fails the same way.                                                                                                                   |
| 2026-04-29 10:27:55     | Hive prints `Failed: 5` and stops, but the Node process exits naturally with code 0 (no explicit `process.exit(stats.failed > 0 ? 1 : 0)`).           |
| 2026-04-29 10:27:55.620 | Start-command sees exit 0 and reports a green "Work session finished successfully" message back to Telegram.                                          |

Crucial point: **every reported symptom is deterministically reproducible just
from the captured log — there is no flakiness involved.**

---

## 4. Requirements extracted from the issue

| #   | Requirement                                                                                                                                    | Source phrase                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| R1  | When at least one queued issue fails, `hive` MUST exit with a non-zero status code so wrappers (`$`, Telegram bot) see failure.                | "the hive command should return not success exit code when any task failing"                                |
| R2  | All five `solve` invocations failing because of `--working-session-live-progress false` MUST stop crashing.                                    | "we need to find root cause of all failures and fix them. It should just work."                             |
| R3  | `/hive` MUST keep running solve under `--isolation screen` (i.e., make sure the existing wrapper does not regress).                            | "we should double check that like with /solve command, /hive command now uses latest `--isolation screen`…" |
| R4  | Capture all related logs/data in `docs/case-studies/issue-1718/` and produce a deep analysis (timeline, requirements, root causes, solutions). | "We need to download all logs and data related about the issue to this repository…"                         |
| R5  | If a root cause is not yet diagnosable, add debug/verbose output for the next iteration.                                                       | "If there is not enough data to find actual root cause, add debug output and verbose mode if not present…"  |
| R6  | If the bug touches a third-party project that accepts issues, file a reproducible bug report there.                                            | "If issue related to any other repository/project, where we can report issues on GitHub, please do so."     |

---

## 5. What this PR ships

- **R1** — When any worker has failed, `hive` now calls `safeExit(1, …)`
  before returning, so the start-command wrapper records the correct exit code
  and Telegram renders the failed-session envelope.
- **R2** — The auto-forwarder in `hive.mjs` no longer re-emits string-typed
  solve options whose value equals `false` (which is what yargs returns when
  the user did not pass the flag and the option's `default` is `false`). This
  is the root cause for `--working-session-live-progress false` reaching
  `solve`. Two more solve options share the same shape and benefited from the
  fix.
- **R3** — Verified: hive is already invoked under `screen` (line 5 of the
  log shows `Environment: screen`). The fix does not regress this path; a
  regression test pins it.
- **R4** — This case study folder.
- **R5** — Hive's `--verbose` mode now prints the exact `solve` argv it is
  about to spawn after the auto-forwarding loop completes, so the next time a
  malformed option leaks through it can be reproduced from the log alone.
- **R6** — See [`upstream.md`](./upstream.md). The bug is internal to this
  repo; nothing needs to be reported upstream.

The detailed analysis is in [`root-causes.md`](./root-causes.md) and
[`solution-plans.md`](./solution-plans.md).
