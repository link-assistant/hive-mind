# 自动合并前的 issue 完整性检查

只有当 issue 及所有必需 sub-issues 的每一项需求都在同一个 pull request 中实现并验证后，issue 范围的求解才算完成（issue #2406）。CI 通过、部分实现或变通方案都不算完成。

## 提示词与目标

全部六个工具（claude、codex、opencode、agent、gemini、qwen）的系统提示词、初始提示词和继续提示词都包含这一完整交付目标，`--minimal-restart-context` 使用的简短 claude 提示词也包含它。提示词要求工具在存在原生目标 API 时通过它设定目标，不存在时则维护一份持久的检查清单。

无论直接运行还是通过 agent-commander 运行，Codex 始终带有 `-c features.goals=true`。`--auxiliary-model-calls-disabled` 现在只关闭 `features.personality`：目标承载的是任务本身，不属于辅助调用。

## 需求报告是实验性功能，默认关闭

下文关于需求报告的所有内容都需要显式启用（issue #3469）。向 `solve` 传入 `--requirements-report`，或为没有命令行的进程（例如 Telegram 合并队列）设置 `HIVE_MIND_REQUIREMENTS_REPORT=true`。未启用时：

- 提示词不会提及报告、快照命令或合并检查，因此不会为它们消耗 token。上文的完整交付目标和关闭引用规则保持不变。
- 求解结束后不会进行完成性重启。
- 合并检查只检查每个必需 issue 的关闭引用（issue #2335），并且仍然通过 `--match-head-commit` 固定合并的提交。

此功能被关闭的原因是合并检查拦下了一个已完成的 pull request：hive-mind 自己清理 `.gitkeep` 的提交在报告写好之后移动了 head，报告因此不再对应当前提交（[案例分析](case-studies/issue-3469/README.md)）。

## 生成需求报告

最终推送后，根据当前 issue、所有 issue 评论以及 pull request 的所有评论、行内评论和评审生成模板：

```bash
node /path/to/hive-mind/src/issue-requirements-snapshot.mjs OWNER/REPO ISSUE_NUMBER PR_NUMBER
```

工具提示词会给出已安装脚本的绝对路径。该命令只读取 GitHub 并打印模板，每个条目初始状态均为 `pending`。请补充清单提取器无法识别的文字性需求。为每项需求记录可审查的证据，只有在完成后才将状态改为 `done`。无法完成的需求标记为 `blocked`，并附上阻塞证据。将完整报告连同标记一起粘贴到 pull request 描述中：

```text
<!-- hive-mind:requirements:start -->
...生成的 JSON 报告...
<!-- hive-mind:requirements:end -->
```

出现新提交或新的 issue、评审反馈后，请重新生成报告。hive-mind 改写占位描述时会保留已有报告。

## 允许合并的条件

`--auto-merge`、合并队列和求解后检查共用的合并函数要求：

- 每个必需 issue 都有正向关闭引用（现有的链接检查）。
- 恰好一份有效报告，且恰好覆盖必需的 issues。
- 当前 pull request 的 head SHA，以及与当前 issue 和反馈一致的来源摘要。
- 每条明确的验收标准状态为 `done` 且证据非空。

每次 GitHub 读取都必须成功；无法读取或格式错误的响应会阻止合并。合并命令还会传入 `--match-head-commit`，防止并发推送未经检查就被合并。没有关联 issue 的 pull request 照旧合并。

## 完成性重启

启用 `--requirements-report` 时，求解结束后 hive-mind 会重启工具，直到报告通过检查。默认重启三次；`--ensure-all-sub-issues-addressed=N` 可设置上限。遇到使用额度上限、工具或验证反复失败，或只剩 `blocked` 需求时，重启会提前停止。此时 pull request 保持未合并，合并受阻评论会列出剩余工作，而不是建议手动合并。

## 局限

报告是证据清单，并不能证明任意文字需求已经满足，证据仍需人工审查。仓库管理员可以在 hive-mind 之外进行合并。
