# Issue 2007 Case Study: Live Issue/PR Event Input

## Summary

Issue #2007 asks whether Hive Mind already has an option that feeds issue and
pull request events into the running AI agent, instead of waiting for the agent
to rediscover those events or restarting the session — and, if not, to
implement it for Claude, Codex, and other tools "in all ways possible" with a
universal fallback for every tool that lacks a live input channel.

The testable option exists today: `--auto-input-until-mergeable`.

After the reviewer feedback on PR #2008, live event input is now **available for
every tool**. Tools differ only in the delivery mode:

- **stream mode (Claude, Agent):** events are written into the live process.
  Hive Mind starts the tool with `--input-format stream-json`, keeps stdin
  attached, and writes user-feedback frames into the running process. Agent uses
  the live contract released in `@link-assistant/agent` 0.24.1.
- **fallback mode (Codex, opencode, gemini, qwen, and any unknown tool):**
  the universal restart/resume fallback. Hive Mind waits for the current AI turn
  to finish in the JSON output, stops the process, then resumes/restarts the AI
  session with the new issue/PR events as feedback via
  `--auto-restart-until-mergeable` (`watchUntilMergeable`). This works for every
  tool even without a live stdin channel.

Remaining missing native live-streaming features are reported upstream in
the [link-assistant/agent](https://github.com/link-assistant/agent) repository
so they can be implemented, after which a tool can graduate from `fallback` to
`stream`.

## Artifacts

- Raw issue data: `raw/issue-2007.json`
- Raw PR data: `raw/pr-2008.json`
- Research source list: `research/research-sources.json`
- Regression test: `tests/test-issue-2007-live-input-capabilities.mjs`

## Requirements

| ID  | Requirement                                                                                       | Status in this PR                                                                                          |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1  | Double check whether a separately enabled immediate/interactive input option exists.              | Done. The option is `--auto-input-until-mergeable`.                                                        |
| R2  | Explain how the existing option works so it can be tested.                                        | Done. See "How to test".                                                                                   |
| R3  | If the option is missing, implement an experimental option.                                       | Done. The experimental option now covers every tool (stream for Claude and Agent, fallback for the rest).  |
| R4  | Notify the agent about issue title, issue description, issue comments, and pull request comments. | Done for Claude and Agent (live) and for every other tool (restart/resume fallback).                       |
| R5  | Do not treat pull request description updates as user feedback.                                   | Done. PR description remains AI-owned and is not a required feedback source.                               |
| R6  | Use direct JSON input streaming to Claude, Codex, and other tools in all ways possible.           | Claude and Agent use live stream-json. Every other tool uses the universal restart/resume fallback.        |
| R7  | Implement a fallback for all tools without input streaming.                                       | Done. `watchUntilMergeable` waits for the JSON turn to finish, stops the process, and resumes the session. |
| R8  | Report missing live-input features to link-assistant/agent.                                       | Done. See "Upstream reports".                                                                              |
| R9  | Collect issue data and do a case study with online research, requirements, and solution plans.    | Done in this folder.                                                                                       |

## Event Coverage

The issue-required user-feedback sources are:

- issue title updates
- issue description updates
- issue comments
- pull request comments

### Stream mode (Claude and Agent)

For `--tool claude --auto-input-until-mergeable` and
`--tool agent --auto-input-until-mergeable`, Hive Mind handles those through the
bidirectional handler, writing NDJSON user frames into the live stream-json
process:

- PR conversation comments: `repos/{owner}/{repo}/issues/{prNumber}/comments`
- PR inline review comments: `repos/{owner}/{repo}/pulls/{prNumber}/comments`
- linked issue comments: `repos/{owner}/{repo}/issues/{issueNumber}/comments`
- issue title/body metadata diffs: `fetchMetadataSnapshot('issue', issueNumber)`

The handler also retains the broader issue #1708 status stream for CI,
uncommitted changes, and PR metadata.

### Fallback mode (every other tool)

For non-streaming tools, `--auto-input-until-mergeable` activates the
restart/resume loop in `src/solve.auto-merge.lib.mjs` (`watchUntilMergeable`).
Between AI sessions the loop detects and delivers the same events as feedback:

- new non-bot issue/PR comments (`checkForNonBotComments`)
- issue title/description edits (`checkForIssueMetadataChanges`, added for #2007)
- CI/CD failures, merge conflicts, and uncommitted changes (existing triggers)

When any of these appear, the loop stops the current session and resumes/restarts
the AI with a feedback prompt describing the change.

Pull request description updates are not part of the issue #2007 required event
list because the issue explicitly says the PR description is the AI agent's
responsibility.

## Existing Implementation

The relevant code paths are:

- `src/solve.config.lib.mjs` defines `--auto-input-until-mergeable`,
  `--auto-restart-until-mergeable`, `--accept-incomming-comments-as-input`,
  `--stream-comments-to-input`, and `--queue-comments-to-input`.
- `src/live-input-capabilities.lib.mjs` records the capability matrix: each
  tool's `mode` (`stream` or `fallback`), whether it is `available`, and the
  upstream `agentIssue` tracking any missing native live-streaming feature.
- `src/bidirectional-interactive.lib.mjs` builds Claude-compatible stream-json
  user frames and, in `validateBidirectionalModeConfig`, routes non-streaming
  tools to the restart/resume fallback instead of disabling the feature.
- `src/claude.lib.mjs` starts Claude with stdin as a pipe and
  `--input-format stream-json` when incoming-comment input is enabled.
- `src/agent.lib.mjs` starts Agent with stdin as a pipe and
  `--input-format stream-json --output-format stream-json` when incoming-comment
  input is enabled.
- `src/solve.auto-merge.lib.mjs` runs `watchUntilMergeable`, the universal
  fallback loop, and now also detects issue title/description edits.
- `src/solve.auto-merge-helpers.lib.mjs` adds `checkForIssueMetadataChanges`,
  the issue title/body diff used by the fallback loop.

The most important composition rule is:

For Claude and Agent, `--auto-input-until-mergeable` implies
`--accept-incomming-comments-as-input` plus `--queue-comments-to-input`.
For every fallback-mode tool, it keeps live streaming off and ensures
`--auto-restart-until-mergeable` is enabled (unless explicitly disabled).

It does not imply `--interactive-mode` or `--bidirectional-interactive-mode`.
Those flags post tool output back to PR comments and are a separate opt-in.

## How to Test

### Stream mode (Claude)

```bash
solve https://github.com/OWNER/REPO/issues/NUMBER \
  --tool claude \
  --auto-input-until-mergeable \
  --verbose
```

Expected startup behavior:

- The validator logs `Bidirectional Interactive Mode: ENABLED`.
- The delivery mode is `queue-comments-to-input`.
- Verbose logs show the handler monitoring issue/PR comments.

While Claude is still running, add feedback through each relevant surface:

```bash
gh issue comment ISSUE_NUMBER --repo OWNER/REPO --body "Issue-level feedback"
gh pr comment PR_NUMBER --repo OWNER/REPO --body "PR conversation feedback"
```

For inline review comments, use the GitHub review UI or the pulls comments API.
When the poller sees a new non-system comment, it formats a stream-json user
frame and writes it to Claude stdin immediately in stream mode or after the
current Claude turn in queue mode.

### Stream mode (Agent)

```bash
solve https://github.com/OWNER/REPO/issues/NUMBER \
  --tool agent \
  --auto-input-until-mergeable \
  --verbose
```

Expected startup behavior:

- The validator logs `Bidirectional Interactive Mode: ENABLED`.
- The raw command includes
  `agent --model ... --input-format stream-json --output-format stream-json`.
- The delivery mode is `queue-comments-to-input`.
- Verbose logs show the handler monitoring issue/PR comments.

While Agent is still running, add feedback through the same issue and pull
request comment surfaces. Agent 0.24.1 accepts the same user NDJSON frame shape
as Claude, emits `result`/`idle` turn-boundary events, and keeps the stdin pipe
available for additional user turns.

### Fallback mode (Codex and other tools)

```bash
solve https://github.com/OWNER/REPO/issues/NUMBER \
  --tool codex \
  --auto-input-until-mergeable \
  --verbose
```

Expected behavior:

- Hive Mind logs that live streaming input is not available for the tool and
  that it is using the restart/resume fallback.
- The log names the future live-streaming protocol (Codex app-server
  `turn/steer`) tracked upstream.
- `--auto-restart-until-mergeable` stays enabled, so after the current session
  finishes the loop resumes the AI with any new comments, issue title/description
  edits, CI failures, or conflicts.

To confirm the fallback delivers issue edits, edit the issue title or
description while the loop is between sessions and watch for a restart with the
`✏️ The issue ... was edited` feedback.

Local regression coverage:

```bash
node tests/test-issue-2007-live-input-capabilities.mjs
node tests/test-auto-input-until-mergeable-1708.mjs
node tests/test-bidirectional-interactive.mjs
node tests/test-codex-support.mjs
```

## Upstream Reports

Missing native live-streaming features are reported in
[link-assistant/agent](https://github.com/link-assistant/agent):

- link-assistant/agent#268 (completed): bidirectional NDJSON I/O via
  `--input-format stream-json` for the Agent CLI.
- link-assistant/agent#273 (completed): document session resume/steer semantics.
- link-assistant/agent#274 (merged, released in `@link-assistant/agent` 0.24.1):
  explicit live stream-json idle events plus resume, replay, and interrupt
  contract docs. This PR graduates Hive Mind's `agent` tool to stream mode.

Codex live streaming is tracked as a future runner using Codex app-server
`turn/steer` rather than the current one-shot `codex exec` stdin.

## Research Findings

### Claude

Anthropic's Claude Code CLI reference documents `--input-format` with
`stream-json` for print mode and `--replay-user-messages` requiring both
`--input-format stream-json` and `--output-format stream-json`. The Claude
Agent SDK docs describe streaming input mode as a persistent interactive
session that can take queued messages and maintain context across turns.

That matches Hive Mind's existing Claude implementation: stdin remains open and
new issue/PR event frames can be written as user messages.

### Codex

OpenAI's Codex non-interactive documentation describes `codex exec` as the
automation surface. It accepts a task prompt and can consume piped stdin as
additional context, and `--json` makes stdout a JSONL event stream. That is
useful for one-shot automation but does not provide a documented live stdin
channel for new user turns after the process starts.

OpenAI's Codex app-server documentation describes a bidirectional JSON-RPC
protocol. A client starts a thread, starts a turn, reads streamed notifications,
and can steer an active turn with `turn/steer`. Local schema generation with
`codex app-server generate-json-schema` confirms `TurnSteerParams` requires
`threadId`, `expectedTurnId`, and `input`.

The conclusion is that Codex live event input should be implemented through a
new app-server/SDK runner, not by pretending the current `codex exec` runner can
accept mid-session JSON input. Until then, the restart/resume fallback covers
Codex.

### Agent

The Agent CLI now ships bidirectional NDJSON stdin and explicit live idle events
in `@link-assistant/agent` 0.24.1. Hive Mind starts it with
`agent --input-format stream-json --output-format stream-json`, writes the
initial prompt as a user frame, keeps stdin attached for new issue/PR events,
and flushes queued frames when Agent emits `result`/`idle`.

### Other Tools

OpenCode, Gemini, and Qwen use prompt-driven solve runners in this repo. They
use the restart/resume fallback until a tool-specific live input channel is
verified and wired.

## Solution Plan By Requirement

R1/R2: document and test the existing option.

- Keep `--auto-input-until-mergeable` disabled by default.
- Clarify the help text so users know Claude and Agent stream live and every
  other tool uses the restart/resume fallback.
- Add a capability matrix and regression test that make both modes explicit.

R4/R7: make event coverage match the issue for every tool.

- Stream mode: the shared poller covers PR conversation comments, PR inline
  review comments, linked issue comments, and issue title/description diffs for
  Claude and Agent.
- Fallback mode: `watchUntilMergeable` covers new comments, issue
  title/description edits (`checkForIssueMetadataChanges`), CI failures, merge
  conflicts, and uncommitted changes, then resumes the session.
- Do not add pull request description to the required issue #2007 feedback
  source list.

R6/R8: implement live streaming where possible and report the gaps.

- Claude: live stream-json today.
- Agent live stream-json today via `@link-assistant/agent` 0.24.1
  (link-assistant/agent#268, #273, #274).
- Codex: future app-server `turn/steer` runner; fallback today.
- Other tools: fallback today, report gaps upstream before wiring live input.
