# Technical analysis

## Request path across native clients

Hive Mind owns the native client invocation while Formal AI owns the local Responses-compatible model endpoint. That split is intentional: the native CLIs retain their tool loops, approval/sandbox controls, streaming formats, resume behavior, and provider-specific configuration.

Before this change, every prompt module built the same large Hive Mind workflow policy plus a task prompt. Their transports differ:

| Client      | Hive Mind transport                         | Risk before the fix                                                         |
| ----------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Agent       | `systemPrompt + "\n\n" + prompt` over stdin | Both blocks become one user request                                         |
| Codex       | `systemPrompt + "\n\n" + prompt` over stdin | Both blocks become one user request                                         |
| Gemini      | `systemPrompt + "\n\n" + prompt` over stdin | Both blocks become one user request                                         |
| OpenCode    | `systemPrompt + "\n\n" + prompt` over stdin | Both blocks become one user request                                         |
| Claude Code | prompt plus `--append-system-prompt`        | Roles remain distinct, but unnecessary caller policy stays in model context |
| Qwen Code   | `--prompt` plus `--append-system-prompt`    | Roles remain distinct, but unnecessary caller policy stays in model context |

Agent Commander delegates through the Agent implementation and inherits the same boundary.

The old workflow policy was written for general-purpose native coding models. It necessarily mentions commands, working directories, package installation, `sudo`, logs, and procedural steps. Those are rules for the **caller**, not the repository task. Formal AI 0.339.1 performs deterministic semantic routing before a general repository plan; it can therefore select one incidental shell cue as the request.

The new [`src/formal-ai-prompt.lib.mjs`](../../../src/formal-ai-prompt.lib.mjs) is a provider adapter, not a second workflow policy. It contains only:

- the canonical issue URL;
- the prepared branch, when known;
- the canonical PR URL, when known;
- a reference to feedback on that PR, without copying feedback text;
- the requirement to implement and verify before claiming completion.

Every prompt module checks the same adapter before constructing its native-model prompt. Every system-prompt builder returns an empty string for a Formal AI model ID. This preserves native behavior and prevents drift between clients.

## Why copied review text is excluded

PR feedback is user-controlled and often contains diagnostic commands. Copying it verbatim into a deterministic intent-classification request recreates the same confusion after the initial run. The bounded prompt instead tells Formal AI to review the canonical PR. A repository-capable implementation can retrieve the feedback through its own GitHub-aware work loop; current Formal AI cannot act on it anyway.

This is not prompt-injection filtering. Hive Mind does not guess which words are safe. It preserves provenance by sending identifiers and intent, while leaving repository data at its canonical source.

## Upstream source audit

The production evidence used Formal AI 0.339.1. The investigation also reviewed and built current upstream main at commit [`98cb3c8`](https://github.com/link-assistant/formal-ai/tree/98cb3c803a72161a880968647330358c65d9b83f), package version 0.345.0. The same real-client experiment reproduced both outcomes against that build: the old flattened request executed `pwd`, and the bounded request returned `planned_not_executed` without changing a requested artifact.

### Repository work is deliberately plan-only

Current main still defines `GeneralPlanMode::RepositoryWorkItem` as a plan that persists the referenced work item without fabricating a patch. In [`general_execution.rs`](https://github.com/link-assistant/formal-ai/blob/98cb3c803a72161a880968647330358c65d9b83f/src/agentic_coding/general_execution.rs), `finish_general_change` immediately returns `planned_not_executed` for that mode. [`tests/unit/issue_904.rs`](https://github.com/link-assistant/formal-ai/blob/98cb3c803a72161a880968647330358c65d9b83f/tests/unit/issue_904.rs) asserts this terminal state and asserts that repository work does not report execution.

That behavior is truthful and safer than the false completion fixed by Formal AI #904, but it is not an executor. The Hello World tasks require source files, comments, a workflow, a run, and an exact output assertion. None of those requested artifacts can be produced by a planner whose only write target is `.formal-ai/general-change-plan.lino`.

### Shell intent classification can precede repository planning

[`shell_command.rs`](https://github.com/link-assistant/formal-ai/blob/98cb3c803a72161a880968647330358c65d9b83f/src/agentic_coding/shell_command.rs) resolves seed-backed natural-language cues to concrete commands. Its documented example maps a request for the current working directory to `pwd`, matching the Kotlin and local Codex evidence. The 0.339.1 Rust run similarly selected bare `sudo` from caller instructions rather than the GitHub task.

Current main has useful caller-context stripping for known client markup in [`protocol/content.rs`](https://github.com/link-assistant/formal-ai/blob/98cb3c803a72161a880968647330358c65d9b83f/src/protocol/content.rs), added after Formal AI #907. It cannot reconstruct a role boundary after Hive Mind itself concatenates an unmarked workflow prefix and objective into one user string unless the later objective delimiter is recognized. The 0.345.0 replay confirms the gap still exists. The local adapter therefore removes the ambiguity at its source. The #907 follow-up asks for a regression with an unmarked caller-policy prefix and a later explicit repository objective.

## Terminal-state classification

Formal AI's response is carried through a native client. A process exit code answers only whether the client/server exchange completed, not whether repository work executed. The response text contains the stronger signal.

[`classifyFormalAiToolResult`](../../../src/formal-ai.lib.mjs) runs at two chokepoints:

1. immediately after the initial tool invocation in `solve.mjs`;
2. immediately after every shared restart invocation in `solve.restart-shared.lib.mjs`.

It is intentionally scoped:

- the selected model must be Formal AI;
- an already-failed result is left unchanged;
- evidence must include either the machine spelling `planned_not_executed` or the localized English phrase observed in production;
- unrelated pricing and usage metadata is preserved;
- the error code is stable: `FORMAL_AI_PLANNED_NOT_EXECUTED`.

The result enters Hive Mind's existing critical-error flow. It is not reclassified as an authentication, usage-limit, or mergeability failure, and it does not receive a special retry loop.

Text recognition is a compatibility measure because the current native-client streams expose the model's answer, not a Formal-AI-specific typed status. A structured status from upstream would be preferable; see [IMPROVEMENTS.md](./IMPROVEMENTS.md).

## Canonical PR URL correction

Continue mode can begin with an issue URL and discover its existing pull request. The former code then assigned `prUrl = issueUrl`, based on the outdated assumption that continue mode always starts from a PR URL. In the Kotlin trace, the request consequently labelled `/issues/1` as the prepared pull request.

[`buildGitHubPullRequestUrl`](../../../src/github-url-parser.lib.mjs) now validates owner, repository, and a positive integer PR number, then constructs GitHub's canonical `/pull/{number}` web URL. `solve.mjs` calls it only after discovery has supplied `prNumber`.

This is a general URL correctness fix. The Formal AI boundary makes it especially important because the smaller request deliberately relies on a few unambiguous canonical identifiers.

## Why the three clients differed

The divergent output does not imply three unrelated failures:

- Agent/Scala reached the repository-work planner and exposed RC-B directly.
- Claude/Kotlin first matched the working-directory shell cue, then later restarts reached RC-B.
- Codex/Rust repeatedly matched the `sudo` cue and never reached the repository planner.

The same full request contains multiple recognizable intents. Minor transport or transcript differences change which deterministic route wins. One shared caller boundary is therefore more reliable than per-client cue suppression.

## Failure semantics after the fix

`planned_not_executed` is non-retryable at Hive Mind's layer because the same version, request, and capabilities deterministically produce the same state. Retrying is useful only after an external state change, such as a Formal AI upgrade that supplies repository execution.

The classification does not forbid future execution. If a newer Formal AI implementation changes files and reports completion without the explicit non-execution marker, Hive Mind continues through its existing diff, test, CI, and mergeability checks. Those checks remain the final evidence of success.
