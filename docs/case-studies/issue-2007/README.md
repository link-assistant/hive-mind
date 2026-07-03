# Issue 2007 Case Study: Live Issue/PR Event Input

## Summary

Issue #2007 asks whether Hive Mind already has an option that can feed issue
and pull request events into the running AI agent, instead of waiting for the
agent to rediscover those events or restarting the session.

The testable option exists today: `--auto-input-until-mergeable`.

Current support is intentionally narrower than the ideal request:

- `--tool claude` has real direct JSON input streaming. Hive Mind starts
  Claude with `--input-format stream-json`, keeps stdin attached, and writes
  user-feedback frames into the live process.
- `--tool codex` does not have live event input wired through solve today. The
  current runner uses `codex exec`, where stdin is one-shot prompt/context at
  process start. Official Codex app-server has the right shape for future work:
  a bidirectional JSON-RPC protocol with `turn/start` and `turn/steer`.
- Other tools keep the existing restart/resume fallback until their solve
  runners have a verified mid-session input contract.

This PR makes that boundary executable in `src/live-input-capabilities.lib.mjs`,
improves the warning shown for unsupported tools, and extends the Claude
comment poller so live input covers issue comments, pull request comments, and
inline pull request review comments.

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
| R3  | If the option is missing, implement an experimental option.                                       | Not missing for Claude; the existing experimental option is clarified and covered by tests.                |
| R4  | Notify the agent about issue title, issue description, issue comments, and pull request comments. | Done for Claude live input.                                                                                |
| R5  | Do not treat pull request description updates as user feedback.                                   | Done in the issue #2007 capability list; PR description remains AI-owned.                                  |
| R6  | Use direct JSON input streaming to Claude, Codex, and other tools where possible.                 | Claude is supported. Codex and other tools warn and fall back until a verified live runner is implemented. |
| R7  | Collect issue data and do a case study with online research, requirements, and solution plans.    | Done in this folder.                                                                                       |

## Event Coverage

The issue-required user-feedback sources are:

- issue title updates
- issue description updates
- issue comments
- pull request comments

For `--tool claude --auto-input-until-mergeable`, Hive Mind now handles those
through the existing bidirectional handler:

- PR conversation comments: `repos/{owner}/{repo}/issues/{prNumber}/comments`
- PR inline review comments: `repos/{owner}/{repo}/pulls/{prNumber}/comments`
- linked issue comments: `repos/{owner}/{repo}/issues/{issueNumber}/comments`
- issue title/body metadata diffs: `fetchMetadataSnapshot('issue', issueNumber)`

The handler also retains the broader issue #1708 status stream for CI,
uncommitted changes, and PR metadata. Pull request description updates are not
part of the issue #2007 required event list because the issue explicitly says
the PR description is the AI agent's responsibility.

## Existing Implementation

The relevant code paths are:

- `src/solve.config.lib.mjs` defines `--auto-input-until-mergeable`,
  `--accept-incomming-comments-as-input`, `--stream-comments-to-input`, and
  `--queue-comments-to-input`.
- `src/bidirectional-interactive.lib.mjs` builds Claude stream-json user frames,
  polls comments/metadata/status, queues frames while Claude is busy, and flushes
  them into stdin when Claude becomes idle.
- `src/claude.lib.mjs` starts Claude with stdin as a pipe and
  `--input-format stream-json` when incoming-comment input is enabled.
- `src/live-input-capabilities.lib.mjs` records which tools are supported today
  and why Codex is not yet live-input capable through the current solve runner.

The most important composition rule is:

`--auto-input-until-mergeable` implies
`--accept-incomming-comments-as-input` plus `--queue-comments-to-input`.

It does not imply `--interactive-mode` or `--bidirectional-interactive-mode`.
Those flags post tool output back to PR comments and are a separate opt-in.

## How to Test

Use a real issue/PR pair and run solve with Claude:

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

Codex can be tested for the fallback boundary:

```bash
solve https://github.com/OWNER/REPO/issues/NUMBER \
  --tool codex \
  --auto-input-until-mergeable \
  --verbose
```

Expected Codex behavior today:

- Hive Mind warns that live input is only supported for Claude.
- The warning names the current `codex exec` limitation.
- The warning points to Codex app-server `turn/steer` as the future protocol.
- Incoming-comment live input is disabled and the existing restart/resume loop
  remains the fallback.

Local regression coverage:

```bash
node tests/test-issue-2007-live-input-capabilities.mjs
node tests/test-auto-input-until-mergeable-1708.mjs
node tests/test-bidirectional-interactive.mjs
```

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
accept mid-session JSON input.

### Other Tools

Agent, OpenCode, Gemini, and Qwen use prompt-driven solve runners in this repo.
This case study did not find a verified mid-session JSON input contract wired
through those runners. They should keep the restart/resume fallback until a
tool-specific long-lived stdin, JSON-RPC, or SDK input channel is verified.

## Solution Plan By Requirement

R1/R2: document and test the existing option.

- Keep `--auto-input-until-mergeable` disabled by default.
- Clarify the help text so users know Claude is the currently supported live
  input runner.
- Add a capability matrix and regression test that makes the support boundary
  explicit.

R4: make event coverage match the issue.

- Extend the Claude poller from PR conversation comments only to PR
  conversation comments, PR inline review comments, and linked issue comments.
- Keep issue title and issue description update detection through the metadata
  poller.
- Do not add pull request description to the required issue #2007 feedback
  source list.

R6: plan Codex correctly.

- Add a future Codex app-server runner that starts `codex app-server`.
- Send `initialize`, `initialized`, `thread/start`, and `turn/start` for the
  initial prompt.
- Track the active `threadId` and `turnId` from notifications.
- Translate issue/PR events into `turn/steer` requests with text input.
- Map app-server notifications back into the existing Codex output parser and
  interactive PR-comment machinery.
- Implement approval handling for app-server command/file-change requests.
- Fall back to the existing `codex exec` runner if app-server startup or
  steering fails.

That follow-up is larger than this issue's "double check and explain" scope
because it changes the Codex execution protocol, result parsing, approval
handling, and failure semantics.
