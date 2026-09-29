# 与模型相关的行为

每个模型——无论是 Formal AI 还是 LLM，使用任何 `--tool`——在提示词、系统提示词、重启反馈、draft/ready 状态切换、循环中断器、失败分类和 pull request 正文上都走同一条代码路径（[#2319](https://github.com/link-assistant/hive-mind/issues/2319)）。对任何模型来说，diff 为空的会话都算作失败会话：pull request 保持草稿状态，重启循环会带着反馈重试。

仍然与模型相关的行为仅限于下表。`git grep -c isFormalAiModel -- src` 列出的正是这些文件。

| 行为           | 位置                                                                                                                                  | 为什么不能通用                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 端点与凭据接线 | `formal-ai.lib.mjs`、`formal-ai-sidecar.lib.mjs`、`solve.validation.lib.mjs`、`agent.lib.mjs`（agent 最低版本）                       | Formal AI 由 `formal-ai serve` 提供，而不是由工具的供应商提供：每个工具都必须指向该端点，供应商登录无法修复认证失败。                                                        |
| 工具兼容性     | `models/index.mjs`、`formal-ai-model.lib.mjs`                                                                                         | Formal AI 是任何工具都能运行的同一个模型；供应商模型只能在各自的工具中运行。                                                                                                 |
| 版本与来源行   | `session-runtime-provenance.lib.mjs`                                                                                                  | 会话日志像记录工具版本一样记录 Formal AI 后端版本，以便把失败归因到具体版本。                                                                                                |
| 署名 trailer   | `formal-ai-attribution.lib.mjs`                                                                                                       | `--attribution auto` 会为 Formal AI 运行开启 Formal AI 提交 trailer 和证据（[#2230](https://github.com/link-assistant/hive-mind/issues/2230)）。                             |
| 定价数据       | `formal-ai-pricing.lib.mjs`、`agent.lib.mjs`、`codex.lib.mjs`、`gemini.lib.mjs`、`qwen.lib.mjs`、`anthropic-cost-accumulator.lib.mjs` | Formal AI 免费。工具报告的费用是供应商为一个并未运行的模型给出的价格，因此会被忽略。公开估算只显示一次（[#2318](https://github.com/link-assistant/hive-mind/issues/2318)）。 |

## 已移除的分歧

| 以前的 Formal AI 路径                                      | 现在                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 替换的提示词和空的系统提示词（`formal-ai-prompt.lib.mjs`） | 与所有模型相同的提示词（[#2313](https://github.com/link-assistant/hive-mind/issues/2313)）                                                   |
| Formal AI 跳过 Playwright MCP                              | 所有模型使用相同的默认值。重复工具调用中断器会为任何适配器停止浏览器循环（[#2316](https://github.com/link-assistant/hive-mind/issues/2316)） |
| `classifyFormalAiToolResult` 改写 `planned_not_executed`   | 通用约定：diff 为空时 PR 保持草稿，并带着反馈重启（[#2312](https://github.com/link-assistant/hive-mind/issues/2312)）                        |
| 仅限 Formal AI 的重复调用中断器                            | 所有适配器共用一个中断器（[#2316](https://github.com/link-assistant/hive-mind/issues/2316)）                                                 |

## 端到端检查

`.github/workflows/e2e-hello-world-matrix.yml`（手动 `workflow_dispatch`）会在新的 Hello World 任务上运行 `solve`：在 `--tool claude`、`agent` 和 `codex` 下各使用 `--model formal-ai`，另加一个 LLM 模型作为对照。每一行都会检查以下全部内容：

- pull request 已可供审查；
- diff 只包含程序、workflow 和测试脚本；
- 程序恰好输出 `Hello, World!`；
- workflow 为绿色；
- 正文已重新生成；
- 没有 `🛑 Automation stopped` 评论。

这些断言位于 `scripts/e2e-hello-world.lib.mjs`，并由 `tests/e2e-hello-world-matrix-2319.test.mjs` 进行单元测试。

该 workflow 需要密钥 `E2E_GITHUB_TOKEN`，它必须是测试用户的令牌，并且能够创建仓库。运行后请用 `cleanup-test-repos.yml` 删除创建的仓库。
