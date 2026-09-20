# Formal AI 草稿 (languages: [en](FORMAL-AI-DRAFTS.md) • zh • [hi](FORMAL-AI-DRAFTS.hi.md) • [ru](FORMAL-AI-DRAFTS.ru.md))

本仓库中新开的每一个 issue，都会在几分钟内获得 Formal AI 的一次尝试，落在一条无人依赖的分支上。尝试错了不花什么代价；尝试对了就省下了第一个提交。失败的尝试同样不是浪费：它在公开处失败，并附着自己的会话证据，而这次失败正是下一次改进元算法所用的输入。

这是对 [issue #2233](https://github.com/link-assistant/hive-mind/issues/2233) 的回应。

## 运行的是什么

`.github/workflows/formal-ai-draft.yml` 由 `issues: opened` 触发——而不是由人工挑选的标签触发，因为要的是每天的证据数量，而不是由人来判定哪些 issue 值得一试。它在已发布的 `konard/hive-mind` 镜像中运行一条命令：

```bash
solve <issue-url> \
  --tool agent \
  --model formal-ai \
  --attach-logs \
  --verbose \
  --attribution formal-ai \
  --no-auto-restart-until-mergeable \
  --log-dir /home/box/logs
```

这正是 Hive Mind 自己的路径，因此这些草稿是一项持续且无法伪造的测量：`solve --model formal-ai` 在拥有 `solve` 的这个仓库的真实任务上，是否正在变好。

由此产生的提交带有四个 Formal AI trailer 以及证据包（[#2229](https://github.com/link-assistant/hive-mind/issues/2229)、[#2230](https://github.com/link-assistant/hive-mind/pull/2230)、v2.24.0）：

```
Formal-AI-Session: ses_…
Formal-AI-Model: formal-ai
Formal-AI-Evidence: dev/log/self-authored/issue-<n>/evidence
Formal-AI-Pull-Request: https://github.com/link-assistant/hive-mind/pull/<n>
```

分支上的每一个提交都由 `github-actions[bot]` 署名。身份是通过 `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` 设置的，而不是通过配置文件，因此无论挂载的是谁的 `HOME`，它在容器内都成立（`experiments/issue-2233/probe-git-identity.sh` 测量了这一点）。

有三个标志是刻意选定的，而非沿用默认：

| 标志                                | 原因                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--attribution formal-ai`           | trailer 和证据包正是这件事的意义所在，因此强制开启，而不是交给 `auto` 去决定。                                                                   |
| `--no-auto-restart-until-mergeable` | 默认是开启的。若保持开启，一次运行会盯着 pull request 的检查并不断重启模型直到全绿，最长可达 24 小时。下面的失败策略规定：那是_下一次_运行的事。 |
| `--log-dir`                         | 会话日志通过 bind mount 带出容器，并作为工作流产物上传，因此即使根本没有开出 pull request 也能读到它。                                           |

`--auto-merge` 和 `--auto-close-pull-request-on-fail` 永不传入。两者默认都是关闭的；`tests/formal-ai-draft-2233.test.mjs` 断言它们始终缺席，因为打开其中任何一个都会悄悄破坏失败策略。

## 失败策略

这是动手改草稿之前该读的部分。

1. **失败的草稿保持开启且保持红色。** 不去修它，也不去回滚它。它等待后来的某次运行成功。红色本身就是测量结果；用手把它变绿就毁掉了这次测量。
2. **草稿绝不被人工修正后合并。** 会话结束后工作流会把 pull request 重新置为草稿（solve 在会话末尾会把它标记为 ready-for-review，见 [#2123](https://github.com/link-assistant/hive-mind/issues/2123)/[#2182](https://github.com/link-assistant/hive-mind/issues/2182)），而 GitHub 拒绝合并草稿。如果某个草稿恰好包含正确的改动，正确的做法是在 issue 中记下这一点，并让一次正常的运行产出一个正常的 pull request——而不是采纳这条草稿分支。
3. **糟糕的草稿被关闭，缺陷记在元算法头上。** 不在分支上打补丁。新 issue 里要回答的问题是"算法为什么会产出这个"，而不是"我怎么把这个 diff 改对"。在新 issue 中链接已关闭的草稿及其会话日志。
4. **草稿分支上永远不会落下人类提交。** 人类提交会让这条分支不再能作为证据：再也说不清模型究竟产出了什么。如果一条分支需要人类提交，那它就该是另一条分支。

草稿可通过 `formal-ai-draft` 标签以及分支名 `issue-<number>-<suffix>` 识别。

## 设置

| 名称                    | 类型     | 必需 | 用途                                                                         |
| ----------------------- | -------- | ---- | ---------------------------------------------------------------------------- |
| `FORMAL_AI_DRAFT_TOKEN` | Secret   | 是   | 开出分支和 pull request，并读取 issue。                                      |
| `FORMAL_AI_DRAFT_IMAGE` | 仓库变量 | 否   | 覆盖镜像。默认为 `konard/hive-mind:latest`；固定一个发布标签可让草稿可复现。 |

`FORMAL_AI_DRAFT_TOKEN` 必须是个人访问令牌，而不是 `GITHUB_TOKEN`。用 `GITHUB_TOKEN` 开出的 pull request 不会触发 `pull_request` 工作流，因此它的检查永远不会运行——而一个无法变红的草稿，也就无法"保持开启且保持红色，直到后来的某次运行成功"。它需要 `repo` 权限范围（细粒度令牌上为 `contents`、`pull_requests` 与 `issues` 的写权限）。

没有这个 secret 时，工作流会**跳过**而不是失败，并在 job 日志中打印原因。这让 fork 和未配置的克隆保持绿色。

## 如何退出与重跑

- 在 issue 模板中加上 `no-formal-ai-draft` 标签，或在开出 issue 之前给它打上该标签，即可抑制这次尝试。
- 由机器人开出的 issue 会被跳过：两套自动化互相投喂产生的是噪声，不是证据。
- 要对某个 issue 重新尝试，请手动运行工作流（`Actions → Formal AI Draft → Run workflow`）并填入 issue 编号。手动重放会被当作一次全新的 `opened` 事件。

## 如何读一个失败的草稿

1. 会话日志由 `--attach-logs` 附加到 pull request 上。
2. 如果没有开出 pull request，同一份日志是该工作流运行上的 `formal-ai-draft-session-<issue>` 产物，保留 30 天。
3. 分支上的 `dev/log/self-authored/issue-<n>/evidence` 保存着 `agent-stream.jsonl` 和 `session-id.txt`——那是模型自己对所做之事的记录，而不是 Hive Mind 对它的概述。

## 当 formal-ai 发布其 composite action 之后

[Issue #2233](https://github.com/link-assistant/hive-mind/issues/2233) 要求安装 `link-assistant/formal-ai` 正从其 `self-authored-pull-request.yml` 中重新打包出来的那个可复用 action。该 action 尚未发布——撰写本文时的证据见 [`docs/case-studies/issue-2233/`](case-studies/issue-2233/README.md)。`uses:` 不接受表达式，因此没有办法写出一个在该 action 出现当天就自动采用它的工作流。

替换只是一步。把 `.github/workflows/formal-ai-draft.yml` 中的 `Open the Formal AI draft` 步骤换成一个 `uses: link-assistant/formal-ai@<tag>` 步骤，并把今天由脚本组装的同一批输入交给它。其余的一切——触发条件、跳过判定、concurrency 分组、失败策略、产物——都与由谁来执行这次尝试无关。请保留 `scripts/formal-ai-draft.lib.mjs` 及其测试：_是否_尝试这一判定属于 Hive Mind，而不属于那个 action。
