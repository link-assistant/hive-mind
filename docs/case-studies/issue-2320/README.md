# Case study: issue #2320 — three `--model formal-ai` Hello World runs, three failures

On 2026-09-27 the same command was run against three Hello World repositories, once per tool:

```
solve <issue-url> --model formal-ai --tool <claude|agent|codex> --attach-logs --verbose --no-tool-check --disable-report-issue --language en
```

Runtime: `solve v2.32.0`, task image `konard/hive-mind-dind:2.32.0`, Formal AI serving backend `0.352.1` (local wrapper `0.351.0`), `@link-assistant/agent` 0.26.5.

None of the three pull requests ended ready for review:

- **Kotlin (`--tool claude`)** ended in draft. It had a committed build artefact, a stale body and `🛑 Automation stopped`.
- **Scala (`--tool agent`)** ended in draft with no change.
- **Rust (`--tool codex`)** ended in draft after 78 identical tool calls.

The umbrella issue split the defects into eight sub-issues (#2312–#2319). This pull request fixes all eight.

- [`evidence.md`](evidence.md) has the full timelines and verbatim log excerpts with `file:line` references.
- [`logs/`](logs) has the unmodified session logs, taken from the gists solve uploaded.

## Timeline (UTC, 2026-09-27)

| Time     | Run    | Event                                                                                                                        | Evidence                         |
| -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 15:02:20 | Kotlin | `solve … --tool claude` starts                                                                                               | kotlin-final.log:8               |
| 15:03:03 | Kotlin | Prompt 515 chars, **system prompt 0 chars** (Formal AI's own prompt dialect)                                                 | kotlin-final.log:173-184         |
| 15:03:40 | Kotlin | The model writes `Main.kt`, a workflow and a verify script, runs `kotlinc … -d Main.jar`, and commits and pushes three files | kotlin-final.log:1671-1819       |
| 15:03:46 | Kotlin | `?? Main.jar` → "Uncommitted changes detected!" → auto-restart                                                               | kotlin-final.log:2040-2052       |
| 15:04:17 | Kotlin | Restart 1 prompt is **byte-identical** to the main prompt; `Main.jar` is never named                                         | kotlin-final.log:2242-2256       |
| 15:04:57 | Kotlin | `git commit` answers "nothing added to commit" → classified as a failed session                                              | kotlin-final.log:3977-3988       |
| 15:05:59 | Kotlin | Restart 2 is identical → `no_progress_between_sessions`                                                                      | kotlin-final.log:5898, 5960-5963 |
| 15:06:22 | Kotlin | Critical-error auto-commit runs `git add -A` and **pushes `Main.jar` into the PR branch**                                    | kotlin-final.log:5969-5977       |
| 15:09:16 | Scala  | `XDG_CONFIG_HOME` is relocated for the Agent CLI config, which hides `~/.config/gh`                                          | scala-agent.log:199-200          |
| 15:09:17 | Scala  | The provider registry logs `opencode … found`, and the attribution guard disables attribution for a 100% Formal AI session   | scala-agent.log:546-578          |
| 15:09:20 | Scala  | `gh issue view` inside the agent → "gh auth login / GH_TOKEN", exit 4                                                        | scala-agent.log:1617-1620        |
| 15:09:24 | Scala  | Formal AI answers `planned_not_executed`; a Formal AI-only classifier turns this into an error                               | scala-agent.log:2627, 4211-4212  |
| 15:15:34 | Rust   | The first of **78 identical `gh issue view`** calls. No breaker exists for codex                                             | rust-codex.log:494 … 8834        |
| 15:19:42 | Rust   | 6,183,844 input tokens, no change; PR kept as draft                                                                          | rust-codex.log:9202-9267         |
| 15:20:00 | Rust   | The comment shows `6.2M / 200K (3092%)`, a cumulative total reported as a context fill                                       | PR comment 5857130507            |
| 15:22:39 | Rust   | Three "Draft restored" self-heals, then `🛑 Automation stopped` with `draft_pull_request`. The AI never ran again            | PR comment 5857152388            |

## Root causes and fixes

| Sub-issue | Root cause                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Test                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| #2312     | A draft the session left **on purpose** (empty diff) was treated like a draft that needed self-healing. `resolveDraftBlocker` "restored" it three times and then stopped with `draft_pull_request`, without running the AI again.                                                         | A deliberate draft restarts the AI, with the verdict as feedback. A failed session no longer ends the watch loop. At the end of the run each deliberate draft returns to its pre-run state.                                                                                                                                                                                                                                                                                         | `tests/deliberate-draft-restarts-ai-2312.test.mjs`                                                                               |
| #2313     | Formal AI had a private prompt dialect and an empty system prompt (`formal-ai-prompt.lib.mjs` and six `*.prompts.lib.mjs` branches). The restart feedback never named the untracked file. So every restart was byte-identical, and `no_progress_between_sessions` was guaranteed.         | The dialect is deleted, and every model gets the same prompts. One shared `buildUncommittedChangesFeedback` gives the exact `git status --porcelain` output with commit/ignore/delete instructions. `no_progress_between_sessions` fires only when a _changed_ input gave the same outcome. "nothing to commit" is benign.                                                                                                                                                          | `tests/restart-prompt-names-uncommitted-files-2313.test.mjs`                                                                     |
| #2314     | The Formal AI runtime relocated `XDG_CONFIG_HOME` to point the Agent CLI at its config. That moved gh's config too, and no `GH_TOKEN` was exported.                                                                                                                                       | Agent and OpenCode are pointed at their config through `LINK_ASSISTANT_AGENT_CONFIG_DIR` / `OPENCODE_CONFIG_DIR`. `GH_CONFIG_DIR` and `GH_TOKEN` are exported into the tool env. `gh auth status` is preflighted with that exact env, and the run fails fast with the cause attached. Tokens never reach a logged command line.                                                                                                                                                     | `tests/formal-ai-tool-env-keeps-gh-auth-2314.test.mjs`                                                                           |
| #2315     | The critical-error recovery ran `git add -A` in the PR branch and pushed, so `Main.jar` became part of the reviewable diff.                                                                                                                                                               | The work is snapshotted through a private index onto `recovery/<branch>`, and the PR branch, index and worktree are left untouched. Untracked binaries and build directories are never preserved. The failure comment names the recovery branch.                                                                                                                                                                                                                                    | `tests/critical-error-recovery-keeps-pr-branch-clean-2315.test.mjs`                                                              |
| #2316     | The repeated-tool-call breaker (#2247) was fed only by the claude stream. The budget line divided a cumulative input total by the context window.                                                                                                                                         | `tool-call-loop-guard.lib.mjs` normalises codex, agent, opencode, gemini and qwen streams into the shared breaker. It also trips on runs of identical _successful_ calls. A cumulative total is printed as a total. A replay of the Rust run stops at call 6, not 78.                                                                                                                                                                                                               | `tests/repeated-tool-call-all-tools-2316.test.mjs`, `experiments/replay-rust-codex-2316.mjs`                                     |
| #2317     | The attribution guard read `providerID` from **any** record, including the Agent CLI's provider-registry `found` logs.                                                                                                                                                                    | Identity is read only from generation records (`step_start`/`step_finish`, assistant message info). A replay of the Scala log keeps attribution enabled, and a hosted-provider generation still disables it.                                                                                                                                                                                                                                                                        | `tests/formal-ai-attribution-generation-identity-2317.test.mjs`                                                                  |
| #2318     | The PR body's Changes section was written once, from the diff at that moment ("1 file(s) modified" for a three-file commit). A free model's comment printed both `$0.00` and a list-price cost. The quoted title came from `--title "${updatedTitle}"` (fixed on 2026-07-30 by 46b2df22). | The Changes section is solve-owned (between `hive-mind:changes` markers), lists the paths, and is regenerated from `gh pr diff` after every session for every model. Older unmarked sections are recognised and replaced. Free models print one cost. Title quoting is pinned by a test.                                                                                                                                                                                            | `tests/pr-body-changes-regeneration-2318.test.mjs`, `experiments/pr-title-quoting-2318.mjs`                                      |
| #2319     | Formal AI had its own paths for the prompt, Playwright MCP, failure classification (`classifyFormalAiToolResult`) and the breaker. The failures came from those divergent paths. No test ran the real command end to end.                                                                 | The classifier and the Playwright MCP skip are removed. An empty diff is a failed session for any model (#2312). `isFormalAiModel` now appears in 13 src files, down from 21: wiring, provenance, attribution and pricing, each explained in [MODEL-SPECIFIC-BEHAVIOURS.md](../../MODEL-SPECIFIC-BEHAVIOURS.md). The manual [`e2e-hello-world-matrix.yml`](../../../.github/workflows/e2e-hello-world-matrix.yml) runs formal-ai under claude/agent/codex plus one LLM control row. | `tests/e2e-hello-world-matrix-2319.test.mjs` (the matrix assertions fail on the 2026-09-27 Kotlin PR and pass on a clean answer) |

## Why these failures reinforced each other

The Kotlin run shows how the defects compound:

1. The model did the task.
2. The one leftover file was never named (#2313), so every restart repeated the same session.
3. The identical sessions tripped the no-progress stop.
4. The stop triggered the recovery commit, which pushed the leftover into the PR (#2315).

The Rust run fails in a similar way:

1. Without a breaker, the model looped 78 times (#2316).
2. The empty diff correctly left the PR in draft.
3. The draft self-heal then treated that deliberate draft as damage and stopped the run (#2312).

In each case the Formal AI-specific path was where the chain started. That is why #2319 removes such paths instead of patching them.

## Not done here

The stray `Main.java`, `Main.class` and `Main.jar` commits on the `konard/test-hello-world-*` branches of the 2026-09-27 runs are still in those external repositories. Cleaning them up changes repositories outside this one, so it is left to the operator. Rerunning the tasks, or running `cleanup-test-repos.yml`, replaces them.
