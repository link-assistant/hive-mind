# Case study — Issue #2085

> `/fix --ci-cd` does not call real /solve command with working session, that
> leads to no defaults for the solve command applied

- **Issue:** <https://github.com/link-assistant/hive-mind/issues/2085>
- **Author:** konard
- **Opened:** 2026-07-19
- **Working PR:** <https://github.com/link-assistant/hive-mind/pull/2087>
- **Cited run:** <https://github.com/link-assistant/hive-mind/pull/2083> (a `/fix --ci-cd` run for issue #2082)
- **Origin:** <https://github.com/link-assistant/hive-mind/issues/1733> (the original `/fix` request)

The raw data backing this analysis is in [`data/`](./data), the external
references are indexed in [`research-sources.json`](./research-sources.json).

---

## 1. Timeline / sequence of events

1. **#1733** requested that `/fix --ci-cd` behave as a combination of `/task`
   and `/solve`: generate the CI/CD remediation issue, then run
   `/solve --development-log --deep-analysis --auto-merge` on it, **passing
   through all options that `/fix` itself does not consume** (`--tool`,
   `--model`, `--think`, and ideally everything else).
2. `/fix` was implemented (`src/fix.mjs`, `src/fix.ci-cd.lib.mjs`) and the
   Telegram `/fix` command was added (`src/telegram-fix-command.lib.mjs`,
   issue #1733). The Telegram handler spawns the real `fix` CLI, which in turn
   spawns the real `solve.mjs`.
3. **PR #2083** was produced by a real `/fix --ci-cd` run against issue #2082.
   Its captured solve-session `metadata.json` records the exact command that
   was launched (see [`data/pr-2083-solve-metadata.json`](./data/pr-2083-solve-metadata.json)):

   ```text
   node .../src/solve.mjs https://github.com/link-assistant/hive-mind/issues/2082 \
     --development-log --deep-analysis --auto-merge --language en
   ```

4. **#2085** was opened: the operator observed that `--attach-logs` — a solve
   default they had configured — **was not applied** to the solve started by
   `/fix`, and asked whether the solve was "entirely fake." The issue restates
   the #1733 expectation: no fancy re-invention, just `/task` + `/solve`.

## 2. Requirements extracted from the issue

| #   | Requirement                                                                                                                 | Status                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `/fix --ci-cd` must call the **real** `/solve` in a real working session (not a fake/emulated one).                         | Already true — verified, see §3.                                                                                                      |
| R2  | Solve **defaults/overrides** (e.g. `--attach-logs`) configured for `/solve` must also apply to the solve started by `/fix`. | **Fixed** in this PR.                                                                                                                 |
| R3  | Behave as a straightforward combination of `/task` + `/solve` as originally asked in #1733 — no fancy re-invention.         | Satisfied — fix reuses the exact same override mechanism `/solve` uses.                                                               |
| R4  | Download all logs/data about the issue into `docs/case-studies/issue-2085/`.                                                | Done — this folder.                                                                                                                   |
| R5  | Deep case study: timeline, requirements, root causes, solution plans, existing-components review.                           | This document.                                                                                                                        |
| R6  | Search online for additional facts/data.                                                                                    | Done — see [`research-sources.json`](./research-sources.json).                                                                        |
| R7  | If root cause is unclear, add debug/verbose output for the next iteration.                                                  | Root cause was determinable from PR #2083's metadata; no new tracing required. Existing `--verbose` already surfaces the merged args. |
| R8  | If another repo is involved, report there with reproducible examples.                                                       | Not applicable — the defect is entirely within this repo (Telegram bot wiring). No external project involved.                         |
| R9  | Fix in **all** places the bug exists across the codebase.                                                                   | Audited — see §5. Only the `/fix` Telegram handler was affected; `/solve` and `/hive` already applied overrides.                      |
| R10 | Do everything in the single PR #2087; add tests; prepare a release (version/changeset); CI green.                           | In progress in this PR.                                                                                                               |

## 3. Root-cause analysis

### R1 — Is the solve "fake"? No.

`src/fix.mjs` spawns the real `solve.mjs` with `stdio: 'inherit'` via
`buildSolveArgs()` in `src/fix.ci-cd.lib.mjs`, producing
`[issueUrl, --development-log, --deep-analysis, --auto-merge, ...passthrough]`.
PR #2083's `metadata.json` `rawCommand` field is the primary evidence: it shows
a genuine `node .../src/solve.mjs …` invocation. **The solve is real.** The
"fake" hypothesis in the issue title is disproved by the captured data.

### R2 — Why `--attach-logs` was missing (the actual bug)

Operators configure solve defaults through the **`TELEGRAM_SOLVE_OVERRIDES`**
environment variable (lino-formatted, e.g. `(\n  --attach-logs\n  --auto-continue\n)`).
The Telegram bot parses this into a `solveOverrides` array
(`src/telegram-bot.mjs`) and merges it into user args via
`mergeArgsWithOverrides()` — but **only for the `/solve` and `/hive` handlers**.

The `/fix` handler (`src/telegram-fix-command.lib.mjs`) never received
`solveOverrides` and never merged them. So when `/fix` forwarded its arguments
to the real `solve.mjs`, the operator overrides were absent — exactly why
`--attach-logs` did not appear in PR #2083's `rawCommand`.

This is a **wiring gap**, not a solve defect: `/fix` genuinely delegates to
`/solve`, but the operator-default layer that sits _in front of_ `/solve` in the
Telegram bot was not applied to the `/fix` delegation.

Why the override must be baked into the **arguments** (not read from env by
`fix.mjs`): the bot runs work sessions under isolation backends
(screen/tmux/**docker**). `buildDockerIsolationStartArgs()` only forwards
explicitly listed `-e` environment variables into the container, so a Docker
`/fix` session would not see `TELEGRAM_SOLVE_OVERRIDES` at all. Applying the
overrides at the Telegram handler (baking them into the forwarded args) is the
only approach that is robust across every isolation backend — and it is exactly
what the `/solve` handler already does.

## 4. Solution (implemented in PR #2087)

1. **Extract the shared helper.** `mergeArgsWithOverrides()` was moved out of
   `src/telegram-bot.mjs` into a new shared module
   [`src/args-overrides.lib.mjs`](../../../src/args-overrides.lib.mjs) (with
   added `Array.isArray` null-safety) so `/solve`, `/hive` **and** `/fix` share
   one implementation — no copy/paste, no circular import on the bot entry
   point.
2. **Wire overrides into `/fix`.** `registerFixCommand()` now accepts
   `solveOverrides`, and `handleFixCommand()`:
   - extracts any `--isolation` from the overrides
     (`extractIsolationFromArgs`), validates it, and lets an override isolation
     take precedence over a per-command one (`effectiveIsolation`);
   - merges the remaining overrides into the fix args with
     `mergeArgsWithOverrides()` (overrides win, appended last for yargs'
     last-wins parsing);
   - validates the model on the _merged_ args;
   - surfaces a `🔒 Solve overrides: …` line in the work-session info block so
     the operator can see the locked options.
3. **Telegram bot passes `solveOverrides` to `registerFixCommand`.**

Because `/fix` forwards every option it does not consume through to
`solve.mjs`, appending the solve overrides to the fix args makes them reach the
real solve invocation — restoring `--attach-logs` and any other operator
default.

### Why this matches #1733's "no fancy re-invention"

The fix does **not** add a new mechanism. It reuses the _identical_ override
merge that `/solve` already uses, so `/fix`'s embedded solve is now configured
exactly like a direct `/solve` — the combination of `/task` + `/solve` that
#1733 asked for.

## 5. Codebase audit — is the bug anywhere else?

- `/solve` handler — already merges `solveOverrides`. ✅
- `/hive` handler — already merges `hiveOverrides`. ✅
- `/fix` handler — **was missing**; fixed here. ✅
- `/task` handler — does not delegate to `/solve`, so no solve overrides apply. ✅
- Direct CLI `fix` (outside Telegram) — `TELEGRAM_SOLVE_OVERRIDES` is a
  Telegram-bot concept; the direct CLI already forwards user options to
  `solve.mjs`. No change needed. ✅

No other delegation site omits the overrides.

## 6. Existing components / libraries reviewed

- **`mergeArgsWithOverrides` (internal, issue #1228).** The repo already had a
  battle-tested override-merge helper for `/solve` and `/hive`. Rather than
  writing something new, this fix promotes it to a shared module and reuses it.
  This is the "known existing component that solves a similar problem."
- **yargs last-wins parsing** ([advanced docs](https://github.com/yargs/yargs/blob/main/docs/advanced.md)).
  `solve.mjs`/`fix.mjs` parse with yargs, where the last occurrence of an option
  wins. Appending overrides at the end of the arg list is therefore the correct,
  documented way to guarantee they take precedence — matching the existing
  helper's contract.
- **`extractIsolationFromArgs` / `isValidPerCommandIsolation`** (internal). Reused
  verbatim to handle an `--isolation` override consistently with `/solve`.

## 7. Tests added

- [`tests/test-args-overrides.mjs`](../../../tests/test-args-overrides.mjs) —
  unit tests for the extracted `mergeArgsWithOverrides` (imports the real
  module, not a replica).
- [`tests/test-telegram-fix-command.mjs`](../../../tests/test-telegram-fix-command.mjs) —
  new cases proving `/fix` applies solve overrides, that overrides win over a
  conflicting user flag, that an `--isolation` override is honored, that a
  per-command `--isolation` still applies, that an invalid override isolation is
  rejected, and that the info block shows/omits the locked-options line.
