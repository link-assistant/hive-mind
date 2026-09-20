# Case Study: Issue #1593 — CI/CD broken by concurrent PR merge race condition

## Problem Statement

The CI/CD pipeline on the `main` branch failed because `src/solve.auto-merge.lib.mjs` had 1545 lines, exceeding the 1500-line limit enforced by `check-file-line-limits`. Both PRs that contributed to this passed their own CI checks individually.

Failed run: https://github.com/link-assistant/hive-mind/actions/runs/24274201449/job/70884900739

## Timeline of Events

| Time (UTC) | Event                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| 03:32:59   | PR #1585 CI run starts (run 24273715376)                                               |
| 03:38:05   | PR #1585 `simulate-fresh-merge` merges with main (main had 1 new commit, not PR #1577) |
| 03:38:06   | PR #1585 `check-file-line-limits` passes (file was under 1500 after simulated merge)   |
| 03:49:20   | **PR #1577 merges to main** — file goes from 1433 → 1487 lines                         |
| 03:58:08   | **PR #1585 merges to main** — file goes from 1487 → 1545 lines                         |
| 04:01:57   | Post-merge CI on main runs `check-file-line-limits` — **FAILS** (1545 > 1500)          |

## Root Cause Analysis

### The concurrent PR merge race condition

Two PRs independently modified `src/solve.auto-merge.lib.mjs`:

1. **PR #1577** (`issue-1570-8089f847a91c`): "fix: always post GitHub comment when usage limit reached in auto-restart mode" — added 54 lines (1433 → 1487)
2. **PR #1585** (`issue-1584-b1863ba06b72`): "fix: narrow Ready to merge duplicate check to current session scope" — added 58 lines (1487 → 1545 after merge)

Each PR individually kept the file under the 1500-line limit. The `simulate-fresh-merge.sh` script correctly merged with the latest `main` during each PR's CI run, but:

- When PR #1585's CI ran at 03:32, PR #1577 **had not yet merged** (it merged at 03:49)
- So the simulated merge for PR #1585 did NOT include PR #1577's additions
- PR #1585's CI saw the file at ~1491 lines (its own changes on top of the pre-#1577 main)
- After both merged, the combined file was 1545 lines

### Why CI couldn't prevent this

This is a **fundamental limitation** of any PR-based CI system. The `simulate-fresh-merge` approach only protects against **sequential** changes (PR merged after another PR that changed the same file). It cannot protect against **concurrent** changes where two in-flight PRs both modify the same file because:

1. Neither PR knows about the other's changes until one merges
2. GitHub's merge queue feature could help, but it requires all PRs to be queued sequentially
3. Branch protection rules can require up-to-date branches, but this only forces rebasing — it doesn't prevent two PRs from being simultaneously up-to-date

### Contributing factors

- The file was already at 1433 lines before either PR — dangerously close to the 1500-line limit
- Both PRs merged within a 9-minute window, leaving no time for the second PR to detect the first's impact
- No warning mechanism existed to flag files approaching the limit

## Solution

### Immediate fix

Extracted three helper functions (`checkForExistingComment`, `checkForNonBotComments`, `getMergeBlockers` — totaling ~510 lines) from `solve.auto-merge.lib.mjs` into a new `solve.auto-merge-helpers.lib.mjs` file:

- Main file: 1545 → 1039 lines
- New helper file: 552 lines

### Preventive measure

Added a **warning threshold** at 1350 lines to `scripts/check-file-line-limits.sh`. Files exceeding 1350 lines generate GitHub Actions `::warning` annotations visible in PR check summaries, giving contributors early notice to extract code before hitting the hard limit of 1500.

The 150-line buffer (1500 - 1350 = 150) provides headroom for concurrent PRs that each add moderate amounts of code to the same file.

## Key Insight

The race condition is inherent to concurrent development workflows. Rather than trying to prevent it (which would require serializing all PRs — impractical), the better approach is:

1. **Detection**: Warning thresholds that flag risky files before they reach the hard limit
2. **Headroom**: Keeping files well under the limit so concurrent additions have room
3. **Quick recovery**: When it does happen, the fix is straightforward (extract code to a new file)

## Files Changed

| File                                   | Change                            |
| -------------------------------------- | --------------------------------- |
| `src/solve.auto-merge.lib.mjs`         | Extracted 3 helper functions      |
| `src/solve.auto-merge-helpers.lib.mjs` | New file with extracted functions |
| `scripts/check-file-line-limits.sh`    | Added 1350-line warning threshold |

## Related Issues

- Issue #1570 (PR #1577): Added code to the file that brought it closer to the limit
- Issue #1584 (PR #1585): Added code that pushed the file over the limit
- Issue #1141: Original case study on why `simulate-fresh-merge` is needed (stale merge preview)
