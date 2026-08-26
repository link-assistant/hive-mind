# Issue #2178: The repository is the only memory a task keeps

## Summary

Every agentic CLI hive-mind drives has grown a private cross-session memory, and Claude Code has grown a permission classifier that costs a model call per tool use. Neither fits how hive-mind works: a task is a disposable container that opens one pull request and is destroyed, with unrestricted access inside. Anything an agent "remembers" between tasks is inference nobody asked for, applied to a repository nobody reviewed it against.

This case study records what each tool actually ships today, which knob turns it off, and how that knob was verified — because the knob names are the part most likely to rot.

## Problem statement

From the issue:

> Our system does not have any memory between tasks execution in the repository context, so the only memory is the repository itself, and it should be kept this way.
>
> Usage of Claude Code memory feature or any other tool's memory will effectively waste AI inference resources.
>
> The same goes for auto mode classifier, as we don't use auto mode, but instead unrestricted access to docker of each task.

Three costs, in order of how much they matter:

1. **Inference spent outside the task.** Gemini CLI's auto-memory is not a file read — it is a second agent (`confucius`, the "Skill Extractor") that runs a Flash model over an index of past sessions for up to 30 turns and writes skill and memory files. Claude Code's memory directory is loaded into the system prompt of every session that has one.
2. **Facts crossing repositories without review.** A memory written while solving an issue in repository A is read while solving an unrelated issue in repository B. Nothing in the pull-request flow shows a reviewer that this happened, and nothing lets them revert it.
3. **Irreproducibility.** The same prompt against the same commit behaves differently depending on what the tool happened to remember. That is the opposite of what a task queue needs.

The classifier is the same argument in a smaller form: hive-mind tasks already run `--dangerously-skip-permissions` (claude), `--dangerously-bypass-approvals-and-sandbox` (codex) and `--approval-mode yolo` (gemini/qwen), so a classifier deciding whether an action is safe is answering a question that has already been answered.

## What each tool actually ships

Verified by reading the installed binaries and bundles, not the documentation. Versions are the ones present when this was written; the CLI-reported version is in parentheses.

| Tool                  | Cross-session memory today                                                                                                                                                                    | Verified how                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code (2.1.246) | Per-project memory directory, team stores via `CLAUDE_MEMORY_STORES`, and a separately-gated organization memory sync                                                                         | `strings` on the shipped binary: the gate reads `env.CLAUDE_CODE_DISABLE_AUTO_MEMORY` and, failing that, `settings.autoMemoryEnabled === false`; the team-store branch sits inside the same disabled path; org memory has its own `CLAUDE_CODE_DISABLE_ORG_MEMORY` check |
| Codex CLI (0.148.0)   | `~/.codex/memories` plus `memories_1.sqlite`, behind the `memories` feature flag, and `external_agent_memory_import` for pulling another agent's memory in                                    | `codex features list` — `memories` is stage `stable`, `external_agent_memory_import` is under development; both were `false` on the machine checked, but `stable` means a rollout can flip it                                                                            |
| Gemini CLI (0.51.0)   | `experimental.autoMemory` starts a background `SkillExtractionAgent` over `chats/`, writing a skills directory and a project `MEMORY.md` index. `save_memory` was **removed** in this version | Bundle chunks: `startAutoMemoryIfEnabled` → `config.isAutoMemoryEnabled()` → `experimentalAutoMemory` ← `settings.experimental?.autoMemory`; the system prompt now states "There is no `save_memory` tool"                                                               |
| Qwen Code (0.7.1)     | Still ships the `save_memory` tool it inherited from an earlier Gemini CLI                                                                                                                    | `cli.js` contains the tool definition (`name: "save_memory"`) and the settings mapping `excludeTools: "tools.exclude"`                                                                                                                                                   |
| OpenCode (1.18.5)     | None found                                                                                                                                                                                    | No `save_memory`, no memory tool, no memory-related `OPENCODE_*` variable in the binary's strings                                                                                                                                                                        |
| `agent`               | None found                                                                                                                                                                                    | Same shape as OpenCode; nothing to disable                                                                                                                                                                                                                               |

The two "none found" rows are recorded rather than omitted. "We looked and there was nothing" and "nobody looked" are different states, and only the first one stays true without someone re-checking — so `TOOLS_WITHOUT_MEMORY_FEATURE` names them and a test asserts the list.

## The auto-mode classifier

Claude Code decides whether auto mode is available in a fixed order, and the settings check comes first:

- `permissions.disableAutoMode === "disable"` (or the top-level `disableAutoMode`) → **"auto mode disabled by settings"**
- circuit breaker for the account's plan
- `CLAUDE_CODE_ENABLE_AUTO_MODE=1` opt-in for third-party providers
- per-model availability

`"disable"` is the only value the setting accepts. Because it is checked before the provider and model gates, it holds on Bedrock/Vertex/Foundry and on every model — which the environment-variable route does not. That is why the settings key is what hive-mind sets, and `CLAUDE_CODE_ENABLE_AUTO_MODE` is left alone: an opt-in nobody opts into is not a control.

`permissions.defaultMode: "bypassPermissions"` was already in the quiet config and stays. It is what makes the classifier unnecessary; `disableAutoMode` is what makes it unreachable.

## What was implemented

A single module, `src/agent-memory-policy.lib.mjs`, owns every knob, so `solve` and the Docker image baseline cannot disagree about what "off" means:

| Tool            | Applied as                                                                                                                                    | Where                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| claude          | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_ORG_MEMORY=1`, `autoMemoryEnabled: false`, `permissions.disableAutoMode: "disable"` | `src/claude-quiet-config.lib.mjs` (so `configure-claude` seeds them into the image) and the `ENV` block of all three Dockerfiles |
| codex           | `-c features.memories=false -c features.external_agent_memory_import=false`                                                                   | appended to `codex exec` in `src/codex.lib.mjs` and to `extraArgs` in `src/agent-commander.lib.mjs`                              |
| gemini, qwen    | `tools.exclude: ["save_memory"]`, `experimental.autoMemory: false` merged into `~/.gemini/settings.json` / `~/.qwen/settings.json`            | `src/gemini.lib.mjs`, `src/qwen.lib.mjs`, before the CLI is launched                                                             |
| opencode, agent | nothing to do                                                                                                                                 | recorded in `TOOLS_WITHOUT_MEMORY_FEATURE`                                                                                       |

`--agent-memory-disabled` defaults to `true`; `--no-agent-memory-disabled` is the only way out, and when it is used the policy adds _no_ arguments rather than arguments set to `true` — an opt-out should leave the command line as it was.

The flag governs codex, gemini and qwen, whose memory is configured per run. It deliberately does **not** reach claude: those switches are `ENV` lines in the image and settings written by `configure-claude`, and neither of those sees a `solve` argv. Pretending the flag controlled them would be offering a control that is not there, so the flag description and the options table say plainly that the claude switches stay off regardless.

### Why settings files rather than command-line flags for gemini/qwen

Gemini CLI 0.51 has no `--exclude-tools`; the flag was replaced by the policy engine and the `tools.exclude` setting. Qwen still accepts `--exclude-tools`. Passing a flag one of them does not know would make the run fail at argument parsing, so both go through the settings file, which each CLI merges and neither rejects for unknown keys. The merge unions arrays, so an operator's own exclusions survive.

## What this does not do

- **It does not delete anything already remembered.** A `~/.codex/memories` directory or a Claude memory directory that predates this change is left on disk; the policy stops it being read and written, not existing. Deleting an operator's files is not something a task flag should do.
- **It was not verified end-to-end against a running CLI.** The knob names come from the shipped binaries and from `codex features list`; the tests assert the wiring, not the effect. Confirming that a routed `gemini` run really starts no extraction agent needs a live run with `--debug` and a look at the `[MemoryService]` log lines.
- **It does not touch Codex's `guardian_approval`.** That is a stable, on-by-default feature that looks classifier-shaped, but `--dangerously-bypass-approvals-and-sandbox` already governs the approval path, and turning off a safety feature that is not costing us anything was out of scope for this issue.

## Timeline

| Date       | Event                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-25 | Issue #2178 filed: memory and the auto-mode classifier both waste inference in a system whose only memory should be the repository.                                                                                                                                 |
| 2026-08-26 | Tool binaries inspected (claude-code 2.1.246, codex-cli 0.148.0, gemini-cli 0.51.0, qwen-code 0.7.1, opencode 1.18.5); `save_memory` found gone from Gemini and still present in Qwen; Gemini's background extraction agent found behind `experimental.autoMemory`. |
| 2026-08-26 | `src/agent-memory-policy.lib.mjs` added as the single source of truth; `--agent-memory-disabled` added, defaulting to true; `permissions.disableAutoMode` added to the quiet config and `CLAUDE_CODE_DISABLE_ORG_MEMORY` to the three Dockerfiles.                  |
