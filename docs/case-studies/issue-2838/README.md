# Case study: issue #2838, memory checks read the host inside a container

Issue: [#2838](https://github.com/link-assistant/hive-mind/issues/2838), "Memory preflight reads host /proc/meminfo inside docker isolation; Claude gets no container memory budget (#2745 was Codex-only); hive starts 2 workers in a 2.92 GiB cgroup". Related: [#2745](https://github.com/link-assistant/hive-mind/issues/2745) (Codex memory budget), [#2498](https://github.com/link-assistant/hive-mind/issues/2498) (cgroup reader), [#2803](https://github.com/link-assistant/hive-mind/issues/2803), [#3125](../issue-3125/README.md) (Docker task memory limits).

## Data

| File                                       | What it is                                     |
| ------------------------------------------ | ---------------------------------------------- |
| [`data/issue-2838.md`](data/issue-2838.md) | The issue body as it was when this was written |

## Timeline

| When            | Event                                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.34.3          | #2745/#2746 add `buildCodexMemoryBudgetPrompt`: Codex is told the cgroup memory limit, no other tool is                                                                                                                                                                       |
| 2.34.0 incident | `hive https://github.com/link-assistant/router --tool codex --all-issues --once` starts 2 workers in a 2.92 GiB container (`Memory = MemorySwap = 3135373312`). Both run cargo/rustc builds                                                                                   |
| same run        | The OOM killer fires 36 times (`memory.events oom=251`). Worker 1's codex is SIGKILLed (exit 137), router#719 fails, and hive exits 1                                                                                                                                         |
| same run        | The preflight says `🧠 Memory check: 11117MB available, swap: 4095MB … total: 15212MB ✅` while the same log reports `Container memory (cgroup v2): … of 2.9 GB limit`                                                                                                        |
| #2803 incident  | `fix https://github.com/link-assistant/web-capture --ci-cd`: after a first OOM kill of `cargo test`, Claude runs `free -g` (host: 11 GB total, 7 GB available), retries `cargo test -j 2` in the background next to a subagent, and the `claude` process itself is OOM-killed |
| 2.35.0          | Unchanged: `checkMemory` (`src/memory-check.mjs:184-242` then) and the Claude prompt still have no cgroup data                                                                                                                                                                |

## Requirements

| #   | Requirement                                                                                                                                                                                                            | Status                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| R1  | In a cgroup, the preflight uses `memory.max` / `memory.current` / `memory.swap.max`: available = min(host available, limit − current); swap is 0 when the cgroup may not swap; the output names the limit that applied | Done                                                           |
| R2  | The "System resources" lines use the cgroup values too                                                                                                                                                                 | Done                                                           |
| R3  | Reuse the cgroup reader from `solve.resource-diagnostics.lib.mjs` (#2498)                                                                                                                                              | Done; it now also reads the swap limit                         |
| R4  | Every tool, Claude included, gets the memory budget Codex gets: the real limit, "`free`/`top` show the host", sequential low `-j` builds, no builds next to subagents                                                  | Done for claude, codex, agent, gemini, opencode and qwen       |
| R5  | Optional: after a mid-session `oom_kill` increase, warn in the next turn                                                                                                                                               | Not done: the live first-OOM report is owned by the #2809 work |
| R6  | `hive` caps or warns about `--concurrency` when cgroup limit / workers is below a configurable per-worker minimum                                                                                                      | Done: caps and warns                                           |
| R7  | Case study                                                                                                                                                                                                             | This document                                                  |

## Root causes

1. **`/proc/meminfo` is not namespaced.** Inside a container it describes the host, but the OOM killer acts on the container's cgroup `memory.max`. `checkRAM` and `getResourceSnapshot` read only `/proc/meminfo` and host swap, so a 2.92 GiB container with no swap passed a check against 15 GB.
2. **The memory budget was a Codex feature.** `buildCodexMemoryBudgetPrompt` lived in `codex.process-exit.lib.mjs` and was used only in `codex.lib.mjs`. The other prompt builders had a generic memory line at most. An agent that ran `free` saw host numbers and acted on them.
3. **`hive` did not look at memory before starting workers.** `--concurrency` defaults to 2, and all workers share one cgroup limit. Two workers in 2.92 GiB left about 1.5 GiB per solve, less than one Rust build needs.

## Solutions

- **Cgroup reader** (`src/solve.resource-diagnostics.lib.mjs:94-134`): `readCgroupMemory` now also returns `swapLimitBytes` and `swapCurrentBytes`. On v2 they come from `memory.swap.max` and `memory.swap.current`; on v1 from `memsw.limit − limit`. `0` means the cgroup may not swap even when the host has swap.
- **Effective memory** (new `src/cgroup-memory-budget.lib.mjs`):
  - `computeEffectiveMemory` (`:41`) takes the smaller of host available and cgroup headroom, caps swap by the cgroup swap limit, and records which one limited the value;
  - `readEffectiveMemory` (`:104`) reads `/proc/meminfo` and the cgroup through one injectable reader;
  - `describeMemoryLimit` and `formatMemorySummary` (`:89`, `:97`) write the text.
- **Preflight** (`src/memory-check.mjs:183-212`): `checkRAM` uses the effective values and logs the limit source, for example `cgroup v2 memory.max`. Inside a cgroup it no longer suggests adding a host swap file, which would not help.
- **"System resources" lines** (`src/memory-check.mjs:230-262`): `getResourceSnapshot` puts the cgroup-aware summary first. Callers log `memory.split('\n')[1]`, so that line is the one they show. The raw host lines follow it.
- **Prompts** (new `src/memory-budget-prompt.lib.mjs`):
  - the Codex text moved here as `buildMemoryBudgetPrompt` and gained the "`free`, `top` and `/proc/meminfo` show the host" and "not at the same time as subagents" sentences;
  - `buildCodexMemoryBudgetPrompt` is still exported from `codex.process-exit.lib.mjs:24` and used at `codex.lib.mjs:693`;
  - `getMemoryBudgetSubPrompt` adds an "Execution resource budget" section to the system prompts of claude (`src/claude.prompts.lib.mjs:360`), agent (`src/agent.prompts.lib.mjs:278`), gemini (`src/gemini.prompts.lib.mjs:249`), opencode (`src/opencode.prompts.lib.mjs:278`) and qwen (`src/qwen.prompts.lib.mjs:264`);
  - without a finite cgroup limit the section is empty.
- **hive concurrency** (new `src/hive-concurrency-memory.lib.mjs`, called from `src/hive.startup-checks.lib.mjs:34` before any worker starts):
  - `--min-memory-per-worker` (`src/hive.config.lib.mjs:133`) or `HIVE_MIND_MIN_MEMORY_PER_WORKER` sets the minimum; the default is 2048 MB and `0` turns the cap off;
  - when the cgroup limit divided by `--concurrency` is below the minimum, concurrency drops to `max(1, floor(limit / minimum))` and a warning names the numbers;
  - a separate warning appears when even one worker gets less than the minimum.

  In the incident, 2 workers in 2990 MB become 1.

- **Docs:** `docs/CONFIGURATION.md` and its translations list `--min-memory-per-worker`.

## Tests

| Test                                                  | Covers                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/issue-2838-cgroup-memory-budget.test.mjs` (7)  | v2/v1 swap reading, cgroup headroom vs host, no limit, swap cap, host lower than headroom, the injectable reader, `checkRAM` and `getResourceSnapshot` output |
| `tests/issue-2838-memory-budget-prompt.test.mjs` (6)  | The shared guidance text, and the system prompt of claude, agent, gemini, opencode and qwen carrying the budget                                               |
| `tests/issue-2838-hive-concurrency.test.mjs` (6)      | Option/env/default resolution, the incident (2 → 1), no cap when memory is enough, below-one-worker warning, `runStartupChecks` order                         |
| `tests/issue-2498-cgroup-memory-diagnostics.test.mjs` | Existing cgroup diagnostics, updated for the swap fields                                                                                                      |

## Remaining limits

- R5 (warn the agent after a mid-session OOM kill) is part of the #2809 work.
- The prompt states the limit at the start of a session. It does not update during the session.
- `hive` checks once at startup. A cgroup limit changed later with `docker update` is not seen until the next start.
- The cap applies to `hive` workers in one cgroup. Telegram Docker tasks each have their own cgroup and are limited by #3125 and the queue's RAM gate.
