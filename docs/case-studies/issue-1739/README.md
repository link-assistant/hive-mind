# Case Study: `claude` Tool Solution Stuck in Background-Polling Loop (Issue #1739)

**Date**: 2026-05-01
**Issue**: [#1739](https://github.com/link-assistant/hive-mind/issues/1739)
**Related PR**: [#1740](https://github.com/link-assistant/hive-mind/pull/1740)
**Source log**: [original gist](https://gist.githubusercontent.com/konard/d8c2366ab072ada256e39c4021a13149/raw/b8398ed50cc9c59db3a10b07c7310912379905f5/425b92ce-9a70-4990-9b7c-0f21f61dbc0b.log) → `logs/original.log`
**Status**: Analysis complete; root cause identified; mitigations proposed

---

## Executive Summary

A `solve` invocation against PR `link-foundation/meta-sovereign#2` using `--tool claude --model opus` ran for almost three hours of wall-clock time before the user manually pressed CTRL+C. The session did not crash; instead the process appeared "alive" while making no progress.

The root cause is a passive-watch interaction between the LLM, the Claude Code CLI, and the `solve` harness:

1. Claude (the model) decided to monitor a CI run by emitting a `Bash` `tool_use` with the command `until [ "$(gh run view ... --json status -q .status)" = "completed" ]; do sleep 20; done; gh run view ... 2>&1` and `run_in_background: true`.
2. Wrapping the polling loop in `run_in_background: true` bypasses Claude Code's anti-`sleep 30` Bash guard (which only catches the foreground `sleep N && cmd` pattern). The same guard fired on a _different_ command later in the run — confirming the inconsistency.
3. After launching the background task, Claude returned a single passive sentence — _"Wait for the watch command to finish — I'll be notified when the background bash task completes."_ — and the assistant turn ended with `stop_reason: end_turn` and `terminal_reason: completed` (line 55460–55516 of `logs/original.log`).
4. The Claude Code CLI treated the turn as legitimately complete, drained its 30-second close timeout, and exited (`exit code 143` from the SIGTERM force-kill — Issue #1280 path).
5. The `solve` harness then noticed an uncommitted `?? deno.lock` and triggered `🔄 AUTO-RESTART`. The restarted session immediately resumed the same passive monitoring pattern — until eventually a different polling shape (`sleep 30 && gh run list ...`) hit the foreground guard and kicked the model back into a different (but equally unproductive) loop.
6. Three hours later, the user pressed CTRL+C. Final cost: **$12.87**, **242 turns** in the first session alone.

The single most important observation is that **the model can spend a turn launching an unbounded background poller, end the turn with passive text, and the harness has no signal that the session is "stuck-by-design"**. A `result` event with `terminal_reason: completed` means "model finished its turn", not "work is complete". Auto-restart compounds the problem.

This is essentially a more subtle relative of [#882](../issue-882-tool-agent-infinite-loop/README.md), [#895](../issue-895-agent-infinite-restart-loop/README.md), and [#1280](../issue-1280/ANALYSIS.md): an interaction loop between the LLM and the harness that no single component recognises as pathological.

---

## Documents in This Case Study

| File                   | Purpose                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `README.md`            | Executive summary (this file)                                                                        |
| `timeline.md`          | Reconstructed sequence of events with timestamps, line numbers and quoted log fragments              |
| `requirements.md`      | Each requirement extracted from issue #1739 with mapping to the docs that satisfy it                 |
| `root-causes.md`       | Detailed root cause analysis of every contributing factor                                            |
| `solution-plan.md`     | Concrete, prioritised remediation plan (harness, prompt, upstream Claude Code) with effort estimates |
| `external-research.md` | Findings from related upstream issues, libraries, and prior art that solve similar problems          |
| `logs/original.log`    | Raw 4.39 MB / 73 270-line log captured from the failing session                                      |

---

## Quick Verdict

| Aspect                                      | Status                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session crashed?                            | No                                                                                                                                                         |
| Session made progress after the watch loop? | No — final assistant message was 100% passive text                                                                                                         |
| Was the model "thinking" while stuck?       | No — `num_turns: 242` and `total_cost_usd: 12.87`, but the _last 41 minutes_ were waiting on a background bash task that the _outer process_ could not see |
| Auto-restart helped?                        | No — it relaunched the same antipattern                                                                                                                    |
| User had to intervene?                      | Yes (CTRL+C after ~2 h 54 min)                                                                                                                             |
| Reproducible?                               | Yes — any prompt that asks Claude to "wait for CI to finish" without a hard upper bound triggers it                                                        |
| Fixable in this repo alone?                 | Partially — full fix requires upstream behaviour from `anthropics/claude-code`                                                                             |
