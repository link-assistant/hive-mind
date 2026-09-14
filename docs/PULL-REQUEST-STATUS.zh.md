# Pull request 状态 (languages: [en](PULL-REQUEST-STATUS.md) • zh • [hi](PULL-REQUEST-STATUS.hi.md) • [ru](PULL-REQUEST-STATUS.ru.md))

Hive Mind 创建的 pull request 有三种状态，只有最后一种表示"可以合并了"。

| 状态                              | 含义                                                       | 你应该做什么                  |
| --------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| **草稿 (Draft)**                  | Hive Mind 仍在工作：会话正在运行，或者 CI/CD 尚未全绿。    | 等待。                        |
| **准备好评审 (Ready for review)** | Hive Mind 已验证可合并状态 —— 在可合并模式下，这就是信号。 | 评审。                        |
| **`✅ Ready to merge`** 评论      | 所有 CI/CD 检查通过，且没有合并冲突。                      | 合并，或交给 `--auto-merge`。 |

pull request 正文中带有 **🚦 How to read this pull request status** 提示，说明下列哪种模式处于活动状态；工作会话评论会用一行重复同样的信息。如果你只看一处，就看这条提示：它指明了你需要等待的信号。

> 为什么这很重要：在 [`Time0utXC/digitalstructures.pro#4`](https://github.com/Time0utXC/digitalstructures.pro/pull/4) 中，pull request 在 AI 仍在处理时就被合并了。进行中的工作 —— 以及为此消耗的 AI 资源 —— 都丢失了。参见 [issue #2246](https://github.com/link-assistant/hive-mind/issues/2246)。

## 各种模式

### `--auto-restart-until-mergeable`（默认）

Hive Mind 会持续工作，直到 pull request 可以合并：**所有** CI/CD 检查通过 —— 包括那些看起来与该 issue 无关的检查 —— 并且分支与其基础分支没有冲突。在整个过程中，pull request 保持草稿状态。可合并状态验证通过后，Hive Mind 会自行将其撤出草稿，并发布 `## ✅ Ready to merge` 评论。这条评论就是你的绿灯；合并动作由你执行。

### `--auto-merge`

同上，之后 Hive Mind 会替你合并这个 pull request。该选项隐含 `--auto-restart-until-mergeable`。

### `--no-auto-restart-until-mergeable`

只有一次工作会话，之后不再监控 CI/CD。会话运行期间 pull request 是草稿，会话结束时被标记为准备好评审 —— **此时 CI/CD 可能仍在运行或处于失败状态**，并且不会发布 `✅ Ready to merge` 评论。在这里，"准备好评审"就是字面意思：请去评审它。

## 谁掌管草稿标志

是 Hive Mind，而不是 AI 工作者。

- pull request 使用 `gh pr create --draft` 创建，之后会**回读**状态 —— 不允许草稿 pull request 的仓库会静默忽略该标志，因此如果它以准备好评审的状态创建出来，就会被显式转换为草稿。
- 每个工作会话开始时都会把 pull request 转为草稿。
- 在可合并模式下，转为准备好评审的操作会被**暂缓**，直到可合并状态得到验证。如果 AI 工作者或人在运行过程中把 pull request 撤出草稿，Hive Mind 会把它放回去，并记录 `⏸️ PR stays draft`。在 shell 中直接执行的 `gh pr ready` 不会经过 Hive Mind，因此监控循环在每次检查时都会重新确认草稿状态。
- 已完成的运行绝不会把 pull request 留在草稿状态。在每一条退出路径上 —— 正常结束、`CTRL+C` 或致命错误 —— 暂缓都会被解除，pull request 会被标记为准备好评审。

工具提示词在「Preparing pull request」一节中用一行把同样的内容告诉 AI 工作者：

```
   - When you finish implementation, make all CI/CD checks pass, even unrelated ones, and leave the draft, ready and ready to merge states to the Hive Mind system.
```

这一行取决于模式。使用 `--no-auto-restart-until-mergeable` 时没有监控循环，也没有暂缓机制 —— 会话结束就是工作结束 —— 因此提示词保留原先的 `use gh pr ready <number>`。在可合并模式下，同一节还会去掉旧的 `check that all CI checks are passing if they exist before you finish` 条目：上面那一行的要求已经更严格，而系统提示词在每一轮对话中都要付费。所有候选写法以及选定规则见 [`src/pr-lifecycle.prompts.lib.mjs`](../src/pr-lifecycle.prompts.lib.mjs) —— 运行 `node experiments/issue-2246-render-prompt.mjs --variants` 可以打印它们及其长度。

## 当状态出乎意料时

| 你看到的                                    | 含义                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 草稿，且最后一条评论是会话结束评论          | 一次会话已结束；在可合并模式下 Hive Mind 正在监控 CI/CD。评论中已说明这一点。                                   |
| 准备好评审，但没有 `✅ Ready to merge` 评论 | 要么运行处于 `--no-auto-restart-until-mergeable` 模式，要么监控已停止 —— 停止评论会解释原因（超时、计费限制）。 |
| 日志中出现 `⏸️ PR stays draft`              | 在暂缓生效期间有人请求转为准备好评审；草稿状态被重新设置。                                                      |
| `✅ Ready to merge` 之后又有新提交          | 有人在验证之后推送了代码。下一次监控检查会重新验证，pull request 可能重新进入工作状态。                         |

## 相关文档

- [CONFIGURATION.zh.md](./CONFIGURATION.zh.md#solve-options) —— 这里提到的所有选项
- [CI-CD-BEST-PRACTICES.zh.md](./CI-CD-BEST-PRACTICES.zh.md) —— "所有检查通过"对仓库提出的要求
