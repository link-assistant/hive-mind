# 模型：实时目录、`/models` 与 `hive-models` (languages: [en](MODELS.md) • zh • [hi](MODELS.hi.md) • [ru](MODELS.ru.md))

如果 Hive Mind 只认识发布时随附的那份清单，供应商今早刚发布的模型对你毫无用处。
本页说明 Hive Mind 如何得知**此刻**存在哪些模型、如何查询它们，以及整套机制所围绕
的那一条规则：**列出模型绝不能花掉你的令牌。**

> **⚠️ 实验性。** 实时来源是新增的（issue
> [#2202](https://github.com/link-assistant/hive-mind/issues/2202)）。内置目录并不新：
> 它就是 Hive Mind 一直用来校验 `--model` 的那份清单，并且在所有实时来源都不可达时
> 仍是最终答案。这里的任何东西都不会导致任务失败——出错的来源只会被记录并跳过。

## 查询可用模型

```bash
# 所有工具，使用缓存结果。
hive-models

# 只看 Codex。
hive-models --tool codex

# Claude，显示上下文窗口、价格与来源，并忽略缓存。
hive-models --tool claude --details --refresh

# 机器可读输出。
hive-models --json | jq '.tools.claude.liveOnly'
```

在 Telegram 中，同样的列表是 `/models`，并以宽容的形式接受相同参数——
`/models --tool codex`、`/models --tool=codex` 和 `/models codex` 含义相同，
因为聊天窗口不是 shell：

```
/models
/models codex --details
/models --all
```

不带参数的 `/models` 回答 `claude`；`--all` 会为每个工具各发一条消息。

## 如何阅读结果

```
Models for claude (default: opus)
3 bundled and live · 2 hot loaded · 14 bundled only

Bundled and live (3) — shipped with this installation and confirmed reachable now
  * claude-opus-5 (opus, opus-5) [1M ctx · 128K out · $5/$25 per Mtok · reasoning · text+image+pdf · 2026-07-24]
    claude-sonnet-5 (sonnet, sonnet-5)
    ...

Hot loaded (2) — a live source has them, this installation does not ship them
    claude-fable-5-2
    ...

Bundled only (14) — shipped, but no live source confirmed them
    ...

Sources, in the order they are trusted:
  - Link.Assistant Router: ok — 41 model(s)
  - Anthropic GET /v1/models: skipped — ANTHROPIC_API_KEY is not set
  - models.dev: ok — specifications for 3570 model(s)
  - Bundled with this installation: ok — 17 model(s)

Live answers are cached for 1h 0m; pass --refresh to ignore the cache.
```

这三个分组正是该命令的意义所在：

| 分组                 | 含义                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| **Bundled and live** | 本安装自带**且**有实时来源确认。可放心使用。                                         |
| **Hot loaded**       | 实时来源中存在，但本安装未自带。现在即可使用。                                       |
| **Bundled only**     | 本安装自带，但没有实时来源确认——可能已下线、改名，或你的账号无权使用。仍有可能可用。 |

`*` 标记该工具的默认模型。括号中的名称是可传给 `--model` 的别名。`--details`
会额外显示规格以及每个模型的来源。

当 `HIVE_MIND_MODELS_HOT_LOAD=0` 时，第三组仅标题为 **Bundled**：既然没有查询
任何实时来源，把这些模型称为“未确认”就是命令无法支撑的指控。

## 清单从何而来

来源按以下顺序查询，同一顺序也是两个来源描述同一模型时的优先级：

| #   | 来源                       | 提供   | 为何在此位置被信任                                                               |
| --- | -------------------------- | ------ | -------------------------------------------------------------------------------- |
| 1   | Link.Assistant Router      | 可用性 | 被路由的任务真正对话的网关。只有它能说明模型在*任务将要走的那条路径上*是否可达。 |
| 2   | `codex debug models`       | 可用性 | 已安装的 Codex 二进制文件从自身目录作答——没有网络请求，且对它接受什么最有权威。  |
| 3   | Anthropic `GET /v1/models` | 可用性 | 该 API 密钥有权访问的模型。                                                      |
| 4   | OpenAI `GET /v1/models`    | 可用性 | 形式相同，理由相同。                                                             |
| 5   | models.dev                 | 元数据 | 上下文窗口、价格、模态、发布日期。它**从不**向可用列表添加模型，只做标注。       |
| 6   | 随本安装自带               | 可用性 | `src/models/catalog.mjs`。始终存在；当其他一切都不可达时的答案。                 |

只有当路由器已经可达或可在本地启动时才会查询路由器来源；由运维方自行运行的路由器
（`HIVE_MIND_ROUTER_URL`）会被使用，但本命令绝不启动或停止它。参见
[路由器隔离](./ROUTER.zh.md)。

## 列出模型绝不花费令牌

Issue #2202 把这条写成硬性约束：_“模型提取绝不应触发任何令牌开销，否则此类方法
必须从我们的代码库中排除。”_ 这是**来源**的属性，因此在声明来源的地方强制执行，
而不是在每个调用点依赖信任（`src/model-catalogue-sources.lib.mjs`）。两道冗余的
防线：

1. **`assertTokenFreeSource`** 拒绝任何未显式声明 `billable: false` 的来源。
   来源不能因为遗漏而变成计费的。
2. **`assertTokenFreeUrl`** 拒绝任何路径为 completion 端点的 URL，无论它以何种
   描述符出现。把 `/v1/models` 写成 `/v1/messages` 的笔误会抛出异常而不是花钱。

这条规则的另一半，是对**未**实现内容的记录，好让“我们不这么做”成为可复核的陈述，
而不只是一处空白：

| 被拒绝的方法                            | 原因                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 驱动 Claude Code TUI 的 `/model` 选择器 | 启动 TUI 就会开启会话，而 Claude Code 在会话开始时会发送请求。这笔开销真实且不可见，还会记在别人的账单上。          |
| 驱动 Codex TUI 的 `/model` 选择器       | `codex debug models` 以 JSON 返回同一份目录且完全不发网络请求，TUI 只会白白增加成本与不稳定性。                     |
| 用 completion 端点探测某个 id 是否存在  | 哪怕只有一个令牌也是一次计费请求，而未知模型的 404 与无权访问的 404 无法区分。`assertTokenFreeUrl` 直接拒绝该 URL。 |
| 抓取厂商文档 HTML                       | 免费，但没有版本且依赖页面布局。models.dev 已在稳定的 JSON 契约后聚合了同样的规格。                                 |

## 缓存

实时结果按来源与工具分别缓存**至少一小时**，存放在 Hive Mind 的状态目录中。
`HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES` 只能*提高*这个下限：更短的生命周期意味着
更频繁地请求供应商，而这正是缓存要防止的事情。`--refresh`（以及
`/models --refresh`）只为本次运行忽略缓存，不会改变已保存的 TTL。

来源失败不是致命的，也不会污染缓存——会复用上一次的良好结果并标记为 `stale`，
同时在来源列表中打印失败原因，让你看清目录*为什么*是现在这个样子。

## 保持 CLI 为最新

过时的 `claude` 或 `codex` 二进制文件，通常正是全新模型名被拒绝的原因，因此驱动
它们的命令会先检查是否有新版本：`/solve`、`/hive`、`/task`、`/fix`（通过它启动的
`/solve` 子进程）、`hive-models` 与 `/models`。

这项检查刻意保守：

- **每 6 小时最多一次**，并带状态锁，以免并发运行互相冲突。
- **在其他任务运行期间推迟。** 绝不会在别人的 solve 正在运行时替换其 CLI。每次
  运行都会把*自己*的任务排除在这项判断之外——否则那套按进程命令行识别繁忙任务的
  机制，会找到正在发问的这次运行本身，从而永远推迟下去。
- **收窄**到该命令即将驱动的那个 CLI。查看 Codex 模型不会重装 Gemini。
- **绝不致命。** registry 不可用，你损失的只是这次更新。
- **完全跳过** `--dry-run` / `--only-prepare-command`，它们不应安装任何东西。

单次运行用 `--no-tool-update` 关闭，全局用 `HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE=0`。

## 配置

| 变量                                    | 含义                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `HIVE_MIND_MODELS_HOT_LOAD=0`           | 完全不查询实时来源；只列出内置目录                                          |
| `HIVE_MIND_MODELS_ROUTER=0`             | 只跳过路由器来源，保留其他实时来源                                          |
| `HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES` | 把缓存生命周期提高到 60 分钟下限之上                                        |
| `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`   | 启用对应供应商的列表端点。缺失不算错误——该来源会被跳过                      |
| `HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE=0`   | 绝不检查智能体 CLI 的新版本                                                 |
| `HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY`     | 以逗号分隔的 CLI 允许列表                                                   |
| `HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE`  | 以逗号分隔的 CLI 排除列表。命令自身的收窄与这些列表取**交集**，无法推翻排除 |

## 参见

- [路由器隔离](./ROUTER.zh.md) —— 第一个来源所读取的网关
- [配置](./CONFIGURATION.zh.md) —— 全部 `--model` 与 `--tool` 选项
- [免费模型](./FREE_MODELS.zh.md) —— 其中哪些运行起来不花钱
- [案例研究：issue #2202](./case-studies/issue-2202/README.md) —— 该设计背后的测量与推理
