# Integration alternatives and improvements

## Decision

Keep the current native-client architecture and add a small Formal AI request adapter plus a terminal-state adapter. Do not add a new JavaScript AI framework for this issue.

The six native coding clients already provide the expensive integration surface: tool execution, streaming, resume, model configuration, sandboxes, and provider-specific authentication. Replacing them with a direct SDK loop would duplicate those behaviors and regress the fixes from issues #2119, #2130, #2146, and #2154. A library also cannot recover role provenance after the application has already concatenated policy and task text.

## Components evaluated

### Native system/user roles

The strongest existing primitive is the role boundary already supported by model APIs. OpenAI's official text-generation guidance assigns application rules to developer/system messages and user inputs to user messages, with higher-priority instructions preceding user turns. Anthropic's Messages API likewise accepts system content separately from input messages. Gemini supports System Instructions and recommends clearly separating context from the task.

Sources:

- [OpenAI text generation guide](https://developers.openai.com/api/docs/guides/text)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Gemini prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)

Hive Mind should preserve those roles for native models. For Formal AI, however, Hive Mind's workflow policy describes how a general-purpose model should operate and duplicates policy Formal AI owns. Omitting it is stronger than translating it into another role. The bounded task stays in a small code module with regression tests, consistent with OpenAI's recommendation to manage reusable production prompts as code with explicit inputs.

### Direct Responses-compatible SDK integration

Formal AI configures Codex with a custom provider and currently exposes a Responses-compatible endpoint. Codex's official configuration reference supports custom providers through `base_url` and identifies the Responses API as the supported wire API for custom providers.

- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

Hive Mind could call that endpoint directly with an OpenAI-compatible SDK. This would make request roles explicit at the HTTP boundary, but it would also make Hive Mind responsible for an agent loop, tool schema, tool execution, approvals, streaming recovery, and client-specific session behavior. It does not solve the upstream absence of a repository executor. It is therefore a poor trade for this bug.

### MCP structured tool results

The Model Context Protocol supports `structuredContent` and optional output schemas for tool results. If Formal AI were exposed as an MCP tool or returned an equivalent typed envelope, it could publish a terminal status such as:

```json
{
  "status": "planned_not_executed",
  "executed": false,
  "artifacts": [".formal-ai/general-change-plan.lino"]
}
```

Hive Mind could then classify the outcome without matching response text.

- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

MCP is a useful future direction, not a dependency to add now. Formal AI currently participates as the model provider behind native clients, so those clients expose ordinary model output rather than an MCP result object.

## Immediate Hive Mind plan

1. Preserve a single provider-specific prompt builder.
2. Keep canonical identifiers in the request; keep workspace paths, caller workflow, and copied feedback out.
3. Apply it to all six prompt modules and Agent Commander through Agent.
4. Classify explicit non-execution at both tool-execution chokepoints.
5. Preserve all existing diff, test, CI, and mergeability verification for future successful runs.
6. Keep the real-client experiment reusable through `HIVE_MIND_FORMAL_AI_PATH` so a later upstream release can be tested against the same pair of requests; the checked-in current-main replay proves that path works independently of the installed production binary.

## Requested Formal AI improvements

### 1. Implement repository-work execution

The repository planner should progress beyond its own plan artifact:

1. fetch/read the issue and repository context through available tools;
2. derive bounded file and command steps;
3. edit only repository-relative targets;
4. run the requested or inferred verification;
5. inspect the resulting diff and requested artifacts;
6. report `executed` only when observable evidence supports it;
7. retain `planned_not_executed` for genuinely unavailable capabilities.

The upstream regression should invert the current issue-904 assertion for a minimal repository task: the requested file and workflow exist, the program emits the expected text, and only then may the response claim completion.

### 2. Preserve caller/task provenance in intent routing

Shell intent detection should operate on the latest user-authored task after caller context is removed, never on system/developer policy or an earlier prefixed harness. When a single user string contains an unmarked harness plus an explicit objective delimiter, the latest task-bearing objective should win.

Suggested regression matrix:

- system policy mentions `sudo`; user requests a repository implementation;
- a flattened caller preamble mentions “working directory”; a later `Issue to solve:` line names a repository task;
- PR feedback contains a command snippet, but the user asks to resolve all review feedback;
- a user explicitly asks to run `pwd`, which must continue to work;
- a user explicitly asks to implement a repository issue, which must never degrade to `pwd` or bare `sudo`.

### 3. Return a typed terminal status

The Responses-compatible stream should expose the execution terminal state in machine-readable metadata when possible. At minimum, Formal AI should keep the stable `planned_not_executed` token. A typed `executed`, `verified`, `artifacts`, and `failure_code` envelope would let every caller distinguish protocol success from task success without localized text parsing.

## Longer-term Hive Mind improvements

- Prefer a typed upstream terminal status when one becomes available; retain text recognition only for older supported versions.
- Add a compatibility probe to the Formal AI version preflight that asks for a harmless repository-work capability declaration.
- Record prompt class and terminal status in structured logs without recording the full potentially sensitive prompt.
- Re-run the checked-in boundary experiment when the pinned minimum Formal AI version changes.
- Remove the special non-execution failure only after a real three-client repository matrix produces requested files and passing CI.
