# Case Study — Issue #1869: Reached limit is incorrect for `--tool codex`

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1869
- **Type**: bug
- **Pull Request**: https://github.com/link-assistant/hive-mind/pull/1873
- **Affected tool**: OpenAI Codex (`--tool codex`)
- **Symptom surfaced on**: https://github.com/link-foundation/command-stream/pull/137#issuecomment-4653599446

---

## 1. Summary

When Codex reports that the **weekly** usage limit has been exhausted, hive-mind
displays (and acts on) a **5-hour-session** reset time instead. The user is told
the limit resets in a few hours when it actually resets ~2 days later. Because
auto-resume schedules itself from this parsed reset time, the session would also
**auto-resume far too early**, hit the still-active weekly limit again, and waste
a cycle (potentially repeatedly).

The root cause is a parsing gap in the central reset-time extractor: it did not
understand Codex's calendar-date format (`Jun 11th, 2026 12:27 AM`), so it fell
through to a generic "bare time" pattern and kept only `12:27 AM`, discarding the
month, day, and year.

---

## 2. Timeline / sequence of events

Reconstructed from the execution log
(`data/solution-draft-log-pr-1780953170975.txt`) and the posted GitHub comment
(`data/upstream-comment-4653599446.json`).

| Time (UTC)              | Event                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-08 21:12:33     | `solve.mjs --tool codex` runs against `link-foundation/command-stream` PR #137.                                                                                                              |
| 2026-06-08 21:12:49.354 | Codex emits `{"type":"error","message":"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at **Jun 11th, 2026 12:27 AM**."}` |
| 2026-06-08 21:12:49.370 | Codex emits matching `{"type":"turn.failed", ...}` with the same message.                                                                                                                    |
| 2026-06-08 21:12:49.399 | hive-mind records: `Codex JSON events: ... error=1, turn.failed=1`.                                                                                                                          |
| 2026-06-08 21:12:49.56  | hive-mind prints `⏳ Usage Limit Reached!` and **`The limit will reset at: 12:27 AM`** — the date was already lost here.                                                                     |
| 2026-06-08 21:12:49.58+ | Log uploaded; GitHub comment posted with **`Reset Time: in 3h 14m (Jun 9, 12:27 AM UTC)`** and **Auto-resume enabled**.                                                                      |

The Codex CLI's own panel (quoted in the issue) confirms the true state:

```
Current week (all models)  100% ⚠️
Resets in 2d 3h 3m (Jun 11, 12:27am UTC)
```

So Codex provided correct information (`Jun 11th, 2026 12:27 AM`); **hive-mind's
parser threw the date away.**

---

## 3. Requirements extracted from the issue

1. **R1 — Correct limit reporting**: When the weekly limit is hit, do not report
   the 5-hour reset time. Show the real reset moment.
2. **R2 — Correct auto-resume decision**: Auto-resume must schedule from the real
   reset time, not the truncated one (premature resume is "even worse").
3. **R3 — Compile all related data** into `./docs/case-studies/issue-1869/`.
4. **R4 — Deep case-study analysis**: timeline, requirement list, root causes,
   proposed solutions, and a survey of existing components/libraries.
5. **R5 — If root cause is undiscoverable, add debug/verbose output** to enable a
   later iteration. (Root cause _was_ found; verbose tracing added anyway for
   future regressions.)
6. **R6 — File issues on related external repos** with repro + workaround + fix
   suggestion, if the bug belongs there.
7. **R7 — Apply the fix everywhere** the same problem can occur (not just one
   call site).
8. **R8 — Single PR (#1873)** carrying the whole solution.

---

## 4. Root-cause analysis

### R1 / R2 — single shared root cause

`extractResetTime()` in `src/usage-limit.lib.mjs` matched reset times with an
ordered list of regex patterns. The date-aware pattern (`Pattern 0`) was anchored
to the literal keyword `resets` and a year-less shape:

```js
// before
const resetsWithDateRegex = new RegExp(`resets\\s+(${monthPattern})\\s+(\\d{1,2}),?\\s+([0-9]{1,2})...`);
```

Codex's message is **`try again at Jun 11th, 2026 12:27 AM`** — it has:

- no `resets` keyword (uses `try again at`),
- an **ordinal** day (`11th`), and
- an explicit **year** (`2026`).

None of those were handled, so `Pattern 0` failed and control fell through to
`Pattern 8` (standalone `HH:MM AM` time), which returned only `12:27 AM`.
Downstream, `parseResetTime()` interpreted that bare time as _today/tomorrow_,
producing a same-day reset.

Because `limitResetTime` feeds **both** the GitHub comment **and** the
auto-resume scheduler, the one parsing bug caused both R1 (wrong display) and R2
(premature resume).

### Why it affects every tool, not just Codex

`extractResetTime` / `detectUsageLimit` are the **central** limit parser used by
Codex, Claude, Agent/OpenCode, etc. (`src/agent-commander.lib.mjs`,
`src/codex.lib.mjs`, …). Fixing it in one place satisfies R7 for all tools — any
provider that ever emits a `Month DDth, YYYY HH:MM AM/PM` reset now parses
correctly.

### R6 — no external bug

The Codex CLI reported the reset time **correctly**. The defect is entirely in
hive-mind's parsing. There is no external repository to file against. The
`command-stream` PR was merely the workload being solved when the limit hit.

---

## 5. The fix

`src/usage-limit.lib.mjs`:

- Replaced the `resets`-anchored, year-less date regex with a keyword-independent
  `Month Day[ordinal][, Year] Time` matcher that:
  - accepts ordinal suffixes (`st|nd|rd|th`),
  - accepts an optional 4-digit year,
  - keeps running **first** so a date+time is never truncated to a bare time.
- When a year is present, `extractResetTime` returns it
  (`Jun 11, 2026, 12:27 AM`).
- `parseResetTime` gained year-bearing dayjs formats (`MMM D, YYYY, h:mm A`,
  `MMMM D, YYYY, h:mm A`) tried first, and no longer bumps the year forward when
  one was explicitly given.

`src/codex.lib.mjs`:

- Added **verbose** tracing at both usage-limit detection sites that logs the raw
  Codex limit message plus the parsed reset time/timezone (R5), so any future
  mis-parse is diagnosable straight from the log.

`tests/test-usage-limit.mjs`:

- Regression tests for the exact Codex message, several ordinal/year variants,
  backward-compatibility of the year-less format, and an end-to-end assertion
  that the parsed reset anchors to `Jun 11`.

### Before / after

|        | Reset reported                                      |
| ------ | --------------------------------------------------- |
| Before | `in 3h 14m (Jun 9, 12:27 AM UTC)` ❌ (5-hour reset) |
| After  | `in 1d… (Jun 11, 12:27 AM UTC)` ✅ (weekly reset)   |

---

## 6. Existing components / libraries considered

- **dayjs** (already a dependency) + `customParseFormat`, `utc`, `timezone`
  plugins — used for the year-bearing parse formats. No new dependency needed.
- A natural-language date parser (e.g. `chrono-node`) was considered and
  rejected: it would be a heavyweight new dependency for a tightly-scoped,
  well-known set of provider message formats, and would reduce the determinism /
  testability the current pattern list provides.

---

## 7. Verification

```
node tests/test-usage-limit.mjs            # 78 passed, 0 failed
node tests/test-billing-limit-detection.mjs# 57 passed, 0 failed
node tests/test-auto-resume-limit-reset.mjs# all passed
node tests/test-limit-reset-config.mjs     # 12 passed, 0 failed
```

Manual reproduction of the exact message now yields
`Jun 11, 2026, 12:27 AM` → `in 1d… (Jun 11, 12:27 AM UTC)`.

---

## 8. Data files

- `data/solution-draft-log-pr-1780953170975.txt` — full Codex execution log
  (the original gist) where the mis-parse occurred.
- `data/upstream-comment-4653599446.json` — the GitHub comment showing the
  incorrect `Reset Time: in 3h 14m (Jun 9, …)`.
  </content>
  </invoke>
