# Model-specific behaviours

Every model — Formal AI or an LLM, under any `--tool` — goes through one code path for the prompt, the system prompt, restart feedback, draft/ready transitions, loop breakers, failure classification and the pull request body ([#2319](https://github.com/link-assistant/hive-mind/issues/2319)). A session whose diff is empty is a failed session for any model: the pull request stays in draft and the restart loop retries with feedback.

What is still model-specific is limited to the table below. `git grep -c isFormalAiModel -- src` lists exactly these files.

| Behaviour                      | Where                                                                                                                                 | Why it cannot be generic                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint and credential wiring | `formal-ai.lib.mjs`, `formal-ai-sidecar.lib.mjs`, `solve.validation.lib.mjs`, `agent.lib.mjs` (minimum agent version)                 | Formal AI is served by `formal-ai serve`, not by the tool's vendor: each tool must be pointed at that endpoint, and a vendor login cannot fix an auth failure.                                                              |
| Tool compatibility             | `models/index.mjs`, `formal-ai-model.lib.mjs`                                                                                         | Formal AI is one model that every tool can run; vendor models run only under their own tools.                                                                                                                               |
| Version and provenance line    | `session-runtime-provenance.lib.mjs`                                                                                                  | The session log records the Formal AI backend version the way it records the tool version, so a failure can be attributed to a release.                                                                                     |
| Attribution trailers           | `formal-ai-attribution.lib.mjs`                                                                                                       | `--attribution auto` turns the Formal AI commit trailers and evidence on for Formal AI runs ([#2230](https://github.com/link-assistant/hive-mind/issues/2230)).                                                             |
| Pricing data                   | `formal-ai-pricing.lib.mjs`, `agent.lib.mjs`, `codex.lib.mjs`, `gemini.lib.mjs`, `qwen.lib.mjs`, `anthropic-cost-accumulator.lib.mjs` | Formal AI is free. The cost that a tool reports is the vendor's price for a model that did not run, so it is ignored. The public estimate is shown once ([#2318](https://github.com/link-assistant/hive-mind/issues/2318)). |

## Removed divergences

| Former Formal AI path                                                   | Now                                                                                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replacement prompt and empty system prompt (`formal-ai-prompt.lib.mjs`) | Same prompt as every model ([#2313](https://github.com/link-assistant/hive-mind/issues/2313))                                                                        |
| Playwright MCP skipped for Formal AI                                    | Same default for every model. The repeated-tool-call breaker stops a browser loop for any adapter ([#2316](https://github.com/link-assistant/hive-mind/issues/2316)) |
| `classifyFormalAiToolResult` rewriting `planned_not_executed`           | Generic contract: an empty diff keeps the PR in draft and restarts with feedback ([#2312](https://github.com/link-assistant/hive-mind/issues/2312))                  |
| Formal AI-only repeated-call breaker                                    | One breaker for every adapter ([#2316](https://github.com/link-assistant/hive-mind/issues/2316))                                                                     |

## The end-to-end check

`.github/workflows/e2e-hello-world-matrix.yml` (manual `workflow_dispatch`) runs `solve` against a fresh Hello World task with `--model formal-ai` under `--tool claude`, `agent` and `codex`, plus one LLM model as the control. For every row it checks all of the following:

- the pull request is ready for review;
- the diff is only the program, the workflow and a test script;
- the program prints exactly `Hello, World!`;
- the workflow is green;
- the body contains the agent's completed description;
- there is no `🛑 Automation stopped` comment.

The assertions live in `scripts/e2e-hello-world.lib.mjs` and are unit-tested by `tests/e2e-hello-world-matrix-2319.test.mjs`.

The workflow needs the secret `E2E_GITHUB_TOKEN`, which must be a token of the test user that can create repositories. Remove the created repositories afterwards with `cleanup-test-repos.yml`.
