# 路由器隔离（`--use-router`） (languages: [en](ROUTER.md) • zh • [hi](ROUTER.hi.md) • [ru](ROUTER.ru.md))

> **⚠️ 实验性功能。** 该选项可用，sidecar 也能正常工作，尚未覆盖的部分列在[尚未覆盖的范围](#尚未覆盖的范围)一节中——每次启用路由器的运行也都会自行打印这些内容。在依赖它做隔离之前请先阅读该节。

默认情况下，Docker 隔离的任务会直接拿到操作者本人的订阅：`~/.claude`、`~/.claude.json`、`~/.codex`、`~/.agents` 和 `~/.config/gh` 会被绑定挂载进容器。容器内的智能体因此持有原始的厂商 OAuth 凭据，可以无限制地消耗订阅，除了它自己愿意写下的内容之外不留任何记录。

`--use-router` 会撤销这些挂载。凭据只留在唯一的 `hive-mind-router` sidecar 容器中，每个任务获得自己的短期令牌，每一次模型请求都会落入属于该令牌的日志。

```bash
solve https://github.com/owner/repo/issues/42 --isolation docker --use-router
```

## 有何变化

|                | 默认              | 使用 `--use-router`                       |
| -------------- | ----------------- | ----------------------------------------- |
| 厂商凭据       | 绑定挂载进任务    | 仅挂载进 sidecar                          |
| 任务的模型端点 | api.anthropic.com | `http://link-assistant-router:8080`       |
| 任务持有的凭据 | 订阅本身          | 仅限该任务的 `la_sk_…` 令牌               |
| 令牌有效期     | —                 | 24 小时或 5000 次请求，任务结束时吊销     |
| 请求日志       | 无                | 每个令牌一份脱敏 JSONL 日志，吊销后仍保留 |
| 网络           | 任务自身的网络    | 任务另外接入内部网络 `hive-mind-router`   |

不加该选项则一切照旧。默认路径保持不变是有意为之：这是可选启用的隔离，而不是一次迁移。

## 工作原理

1. **Sidecar。** 第一个使用路由器的任务会在 `--internal` Docker 网络上启动 `ghcr.io/link-assistant/router:latest`，容器名为 `hive-mind-router`。网络是内部的，因此 sidecar 除 Docker 给它的通路外没有对外出口，宿主机上的任何进程也无法访问它。操作者的 `~/.claude`、`~/.codex`、`~/.gemini` 和 `~/.qwen` 挂载进去，并由 `CLAUDE_CODE_HOME`、`CODEX_HOME`、`GEMINI_HOME` 和 `QWEN_HOME` 指向。这是订阅唯一存在的地方（R3）。
2. **令牌。** Hive Mind 通过 `router token issue` 为每个任务签发一个令牌，会话 id 即令牌的 subject。令牌绝不在任务之间共享——正是这一点让每个任务的日志只属于它自己（R6）。
3. **任务。** 任务容器在自身网络之外再接入路由器网络，并获得指向 sidecar 的 `ANTHROPIC_BASE_URL`（OpenAI 兼容工具则是 `OPENAI_BASE_URL`）以及令牌。Claude Code 的*每一次*请求都经由 `ANTHROPIC_BASE_URL` 发出，包括智能体的子循环，因此没有任何路径能悄悄绕开代理。
4. **租约。** sidecar 以租约计数，而非布尔开关。只要还有任务持有租约它就运行，最后一个释放时才停止（R5）。停止操作绝不触碰数据卷。
5. **任务结束。** 租约被释放时，任务的 `~/.claude`、`~/.claude.json` 和 `~/.codex` 会先被复制进路由器数据卷的 `task-sessions/<sessionId>/`，然后才吊销令牌（R7）。`docker cp` 对已停止的容器同样有效，因此崩溃或被杀死的任务与正常退出的任务一样能被完整导出。

被杀死的机器人或重启的宿主机都无法让 sidecar 永远运行下去：Telegram 机器人每五分钟将租约与 Docker 核对一次，并停止没有任何存活任务在用的 sidecar。不足一小时的租约一律保留，因此仍在启动中的任务不会被釜底抽薪。

## 审计轨迹

整套安排的意义在于：事后你能回答"这个智能体到底做了什么？"。

- `requests/<token-hash>/requests.jsonl` —— 该令牌发出的每一次请求，已脱敏。
- `audit.jsonl` —— 令牌的签发、轮换与吊销。
- `task-sessions/<sessionId>/` —— 智能体自己的会话记录，在容器被回收前从中导出。

这些内容位于命名卷 `hive-mind-router-data` 中，**Hive Mind 的任何代码路径都不会删除它**。它比 sidecar 活得更久；停止或重建路由器都不会影响它。如何把它读回来——包括在没有路由器运行时——见[收集日志](./COLLECTING-LOGS.zh.md)：

```bash
node examples/collect-logs.mjs --out ./audit
```

## 配置

| 变量                                | 含义                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `HIVE_MIND_USE_ROUTER=1`            | 等同于传入 `--use-router`；机器人和嵌套的 `solve` 运行以此继承该决定          |
| `HIVE_MIND_ROUTER_URL`              | 使用已在运行的路由器而不启动 sidecar。必须是纯粹的 `http(s)://host[:port]` 源 |
| `HIVE_MIND_ROUTER_TOKEN`            | 该外部路由器的令牌。设置了 `HIVE_MIND_ROUTER_URL` 时必填                      |
| `HIVE_MIND_ROUTER_SIDECAR=0`        | 永不启动或停止 sidecar（适用于自行管理路由器的操作者）                        |
| `HIVE_MIND_ROUTER_IMAGE`            | 覆盖路由器镜像                                                                |
| `HIVE_MIND_ROUTER_EXTRA_ARGS`       | sidecar 的额外 `docker run` 参数                                              |
| `HIVE_MIND_ROUTER_TOKEN_SECRET`     | 自行提供令牌签名密钥，而不是生成一个                                          |
| `HIVE_MIND_ROUTER_GH_HOST`          | 供 `gh` 流量使用的、已终结 TLS 的路由器端点（见下文）                         |
| `HIVE_MIND_ROUTER_DRAIN_SESSIONS=0` | 任务结束时不归档会话数据                                                      |
| `HIVE_MIND_SESSION_ARCHIVE_DIR`     | 将会话数据归档到该宿主机目录而非路由器数据卷                                  |

### 签名密钥

用于签发令牌的密钥只生成一次，以 `0600` 权限存放在机器人状态目录中。持有它的人就能针对订阅签发令牌，因此：

- 它绝不会进入任务的环境变量；
- 它绝不会被写入日志；
- `examples/collect-logs.mjs` 有意拒绝把状态目录复制进证据归档，只报告其路径。

如果你通过 `HIVE_MIND_ROUTER_TOKEN_SECRET` 自行提供密钥，请按根凭据对待它。

## 尚未覆盖的范围

每次启用路由器的运行都会在开始前打印这些内容。它们是实验阶段如实的边界：

- **GitHub 流量不经过路由器**，除非设置 `HIVE_MIND_ROUTER_GH_HOST`。`gh` 会把自定义主机的 REST 基址拼成 `https://<host>/api/v3/`，且不提供明文选项，而路由器监听普通 HTTP、自身不带 TLS 监听器（已向上游报告为 [router#263](https://github.com/link-assistant/router/issues/263)）。没有已终结 TLS 的端点时，任务仍保留自己的 `gh` 凭据。
- **`--model formal-ai` 不经过路由器。** 自动路由会忽略已保存的 OpenAI 兼容提供方（[router#260](https://github.com/link-assistant/router/issues/260)），因此 Formal AI 的流量仍直连它自己的 sidecar。
- **破坏性 git 操作不由路由器拦截**（[router#261](https://github.com/link-assistant/router/issues/261)）。强制推送和删除分支走的是 git 传输协议，路由器并不代理；[分支保护](./BRANCH_PROTECTION_POLICY.zh.md)仍是相应的控制手段。

## 前置条件

- `--isolation docker`。没有要隔离的容器，路由器隔离便无从谈起。
- Docker 能够拉取 `ghcr.io/link-assistant/router:latest`。
- 如果无法连上路由器，任务**不会启动**。退回直接使用凭据会悄悄取消掉该选项本要提供的隔离。

## 另见

- [收集日志](./COLLECTING-LOGS.zh.md) —— 系统中所有日志位置及其收集方法
- [Docker 支持](./DOCKER.zh.md) —— 路由器所依托的隔离机制
- [分支保护策略](./BRANCH_PROTECTION_POLICY.zh.md) —— 针对破坏性 git 操作的控制手段
- [案例研究：issue #2164](./case-studies/issue-2164/README.md) —— 该设计背后逐条需求的分析
