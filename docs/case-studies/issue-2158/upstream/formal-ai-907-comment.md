Post-#907 evidence shows the same caller-framing class through an unmarked Hive Mind preamble on Formal AI 0.339.1 and current main 0.345.0.

Hive Mind issue: https://github.com/link-assistant/hive-mind/issues/2158
Evidence/fix PR: https://github.com/link-assistant/hive-mind/pull/2159

Observed after Hive Mind's image, launch, and native-client configuration fixes:

- a Claude/Kotlin repository run executed `pwd` and stopped;
- five Codex/Rust attempts executed bare `sudo` and stopped;
- no requested repository file was created.

Minimal real-client reproduction:

1. Start `formal-ai serve --agent-mode` in an empty temporary repository.
2. Configure Codex against it with `formal-ai with --global --no-start-server --base-url <url> codex`.
3. Send this single user prompt:

```text
You are an AI issue solver.
When running sudo commands, run them in the background.
Your prepared working directory: /tmp/example

Issue to solve: https://github.com/example/example/issues/1
Your prepared branch: issue-1-example
Your prepared Pull Request: https://github.com/example/example/pull/2

Proceed.
```

The checked-in production-shaped experiment caused Codex to receive `/bin/bash -lc pwd`, exit 0, and report the workspace path. The repository objective was not planned or executed. I built current main at `98cb3c8` and reproduced the same command and zero exit. Both sanitized outputs are in PR #2159 under `experiments/issue-2158-formal-ai-prompt-boundary*-results.json`.

This differs from #907's tagged Gemini `<session_context>` block: Hive Mind's Agent/Codex/Gemini/OpenCode adapters historically concatenated their own workflow policy and objective into one unmarked user message. The current `strip_caller_context_blocks` logic cannot identify that prefix through client markup.

Current Hive Mind workaround:

- send Formal AI only a bounded repository objective with canonical issue, branch, and PR identifiers;
- omit native-model workflow policy, workspace paths, and copied feedback text;
- treat the separate upstream `planned_not_executed` state as a terminal failure.

Suggested extension to the #907 fix:

1. Prefer a later explicit task delimiter such as `Issue to solve:` over an earlier unmarked harness preamble.
2. Require an imperative user sentence before selecting privileged command intents; a policy sentence that merely mentions `sudo` must not authorize bare `sudo`.
3. Add regressions for an unmarked preamble containing “working directory” / `sudo`, followed by repository work.
4. Retain the existing positive regression where an explicit user request for `pwd` still selects `pwd`.

Could #907 be reopened for the unmarked-prefix variant, or linked to a follow-up that tracks it? The local boundary removes Hive Mind's ambiguity, but other hosts can still flatten caller policy into a user message.
