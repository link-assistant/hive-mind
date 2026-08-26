# 路由器隔离（`--use-router`） (languages: [en](ROUTER.md) • zh • [hi](ROUTER.hi.md) • [ru](ROUTER.ru.md))

> **⚠️ 实验性功能。** 该选项可用，sidecar 也能正常工作，尚未覆盖的部分列在[尚未覆盖的范围](#尚未覆盖的范围)一节中——每次启用路由器的运行也都会自行打印这些内容。在依赖它做隔离之前请先阅读该节。

默认情况下，Docker 隔离的任务会直接拿到操作者本人的订阅：`~/.claude`、`~/.claude.json`、`~/.codex`、`~/.agents` 和 `~/.config/gh` 会被绑定挂载进容器。容器内的智能体因此持有原始的厂商 OAuth 凭据，可以无限制地消耗订阅，除了它自己愿意写下的内容之外不留任何记录。

`--use-router` 会撤销这些挂载。凭据只留在唯一的 `hive-mind-router` sidecar 容器中，每个任务获得自己的短期令牌，每一次模型请求都会落入属于该令牌的日志。

```bash
solve https://github.com/owner/repo/issues/42 --isolation docker --use-router
```

## 有何变化

|                    | 默认                | 使用 `--use-router`                                |
| ------------------ | ------------------- | -------------------------------------------------- |
| 厂商凭据           | 绑定挂载进任务      | 仅挂载进 sidecar                                   |
| 任务的模型端点     | api.anthropic.com   | `https://link-assistant-router`                    |
| 任务的 GitHub 端点 | 直连 api.github.com | api.github.com，在容器内被解析到路由器             |
| 任务的 git remote  | github.com          | `https://link-assistant-router/git/<owner>/<repo>` |
| 任务持有的凭据     | 订阅本身            | 仅限该任务的 `la_sk_…` 令牌                        |
| 令牌有效期         | —                   | 24 小时或 5000 次请求，任务结束时吊销              |
| 请求日志           | 无                  | 每个令牌一份脱敏 JSONL 日志，吊销后仍保留          |
| 网络               | 任务自身的网络      | 任务另外接入内部网络 `hive-mind-router`            |

不加该选项则一切照旧。默认路径保持不变是有意为之：这是可选启用的隔离，而不是一次迁移。

## 工作原理

1. **Sidecar。** 第一个使用路由器的任务会在 `--internal` Docker 网络上启动 `ghcr.io/link-assistant/router:0.119.0`——版本是固定的，因此上游发新版不会在本仓库没有提交的情况下改变任务所对话的对象——容器名为 `hive-mind-router`。网络是内部的，因此 sidecar 除 Docker 给它的通路外没有对外出口，宿主机上的任何进程也无法访问它。它自己在 443 端口终结 TLS，使用的自签名证书同时覆盖 `link-assistant-router` 和 `api.github.com` 两个名字。操作者的 `~/.claude`、`~/.codex`、`~/.gemini` 和 `~/.qwen` 挂载进去，并由 `CLAUDE_CODE_HOME`、`CODEX_HOME`、`GEMINI_HOME` 和 `QWEN_HOME` 指向。这是订阅唯一存在的地方（R3）。
2. **令牌。** Hive Mind 通过 `router tokens issue` 为每个任务签发一个令牌，以会话 id 标注，并用 `--github-repo` 将其限定在该任务所要处理的那一个仓库上。令牌绝不在任务之间共享——正是这一点让每个任务的日志只属于它自己（R6）。
3. **任务。** 任务容器在自身网络之外再接入路由器网络，并获得指向 sidecar 的 `ANTHROPIC_BASE_URL`（OpenAI 兼容工具则是一条生成的 provider 记录）以及令牌。Claude Code 的*每一次*请求都经由 `ANTHROPIC_BASE_URL` 发出，包括智能体的子循环，因此没有任何路径能悄悄绕开代理。
4. **信任与拦截。** 在启动闸门仍扣住任务命令的这段时间里，Hive Mind 会把路由器的 CA 写进容器，在 `/etc/hosts` 中把 `api.github.com` 指向路由器，并把 git 配置成经由 `https://link-assistant-router/git/…` 推送。每个客户端都按它自己期待的方式被告知该 CA：Node 用 `NODE_EXTRA_CA_CERTS`，`gh` 和 Rust 客户端用 `SSL_CERT_FILE`——后者会*替换*系统信任库，因此交给它们的是公共根证书加上路由器 CA 的合集——curl 用 `CURL_CA_BUNDLE`，git 用 `http.<url>.sslCAInfo`。因此未经改动的 `gh` 会在毫不知情的情况下访问到路由器，而任务本身不持有任何 GitHub 令牌（R12）。
5. **Formal AI。** 使用 `--model formal-ai` 的运行有两个 sidecar。路由器加入 Formal AI 网络，并把该 sidecar 存为一个 provider（`router providers add`），因此该模型是*经由*路由器提供的，也像其他模型一样被记录（R11）。注册它不会改道其他任务：路由器按请求中的模型 id 分派。
6. **租约。** sidecar 以租约计数，而非布尔开关。只要还有任务持有租约它就运行，最后一个释放时才停止（R5）。停止操作绝不触碰数据卷。
7. **任务结束。** 租约被释放时，任务的 `~/.claude`、`~/.claude.json` 和 `~/.codex` 会先被复制进路由器数据卷的 `task-sessions/<sessionId>/`，然后才吊销令牌（R7）。`docker cp` 对已停止的容器同样有效，因此崩溃或被杀死的任务与正常退出的任务一样能被完整导出。

被杀死的机器人或重启的宿主机都无法让 sidecar 永远运行下去：Telegram 机器人每五分钟将租约与 Docker 核对一次，并停止没有任何存活任务在用的 sidecar。不足一小时的租约一律保留，因此仍在启动中的任务不会被釜底抽薪。

## 审计轨迹

整套安排的意义在于：事后你能回答"这个智能体到底做了什么？"。

- `requests/<token-hash>/requests.jsonl` —— 该令牌发出的每一次请求，已脱敏。
- `audit.jsonl` —— 每个获授权的请求一行：时间、令牌 id、签发该令牌时的会话标签、provider、接口、路径与模型。
- `task-sessions/<sessionId>/` —— 智能体自己的会话记录，在容器被回收前从中导出。

这些内容位于命名卷 `hive-mind-router-data` 中，**Hive Mind 的任何代码路径都不会删除它**。它比 sidecar 活得更久；停止或重建路由器都不会影响它。如何把它读回来——包括在没有路由器运行时——见[收集日志](./COLLECTING-LOGS.zh.md)：

```bash
node examples/collect-logs.mjs --out ./audit
```

## 配置

| 变量                                 | 含义                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `HIVE_MIND_USE_ROUTER=1`             | 等同于传入 `--use-router`；机器人和嵌套的 `solve` 运行以此继承该决定          |
| `HIVE_MIND_ROUTER_URL`               | 使用已在运行的路由器而不启动 sidecar。必须是纯粹的 `http(s)://host[:port]` 源 |
| `HIVE_MIND_ROUTER_TOKEN`             | 该外部路由器的令牌。设置了 `HIVE_MIND_ROUTER_URL` 时必填                      |
| `HIVE_MIND_ROUTER_SIDECAR=0`         | 永不启动或停止 sidecar（适用于自行管理路由器的操作者）                        |
| `HIVE_MIND_ROUTER_IMAGE`             | 覆盖路由器镜像                                                                |
| `HIVE_MIND_ROUTER_EXTRA_ARGS`        | sidecar 的额外 `docker run` 参数                                              |
| `HIVE_MIND_ROUTER_TOKEN_SECRET`      | 自行提供令牌签名密钥，而不是生成一个                                          |
| `HIVE_MIND_ROUTER_GH_HOST`           | 经由该 HTTPS 主机访问 GitHub，而不拦截 `api.github.com`（外部路由器需要）     |
| `HIVE_MIND_ROUTER_GITHUB=0`          | 完全不路由 GitHub 流量；任务保留自己的 `gh` 凭据                              |
| `HIVE_MIND_ROUTER_DRAIN_SESSIONS=0`  | 任务结束时不归档会话数据                                                      |
| `HIVE_MIND_SESSION_ARCHIVE_DIR`      | 将会话数据归档到该宿主机目录而非路由器数据卷                                  |
| `HIVE_MIND_GIT_HOOKS_DIR`            | 存放生成的 `pre-push` 守卫的宿主机目录（默认 `~/.hive-mind/git-hooks`）       |
| `HIVE_MIND_ALLOW_DESTRUCTIVE_PUSH=1` | 仍然允许启用路由器的任务强制推送或删除远端 ref                                |

### 签名密钥

用于签发令牌的密钥只生成一次，以 `0600` 权限存放在机器人状态目录中。持有它的人就能针对订阅签发令牌，因此：

- 它绝不会进入任务的环境变量；
- 它绝不会被写入日志；
- `examples/collect-logs.mjs` 有意拒绝把状态目录复制进证据归档，只报告其路径。

如果你通过 `HIVE_MIND_ROUTER_TOKEN_SECRET` 自行提供密钥，请按根凭据对待它。

## 破坏性 git 操作

issue 中的 R13 要求让智能体在物理上失去销毁数据的能力。三层共同覆盖它；三层合起来之后，只剩下带 `--no-verify` 的强制推送还能抵达远端。

| 层级                                               | 覆盖范围                                                                                              | 如何被绕过                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 远端的[分支保护](./BRANCH_PROTECTION_POLICY.zh.md) | 对受保护分支的强制推送与删除                                                                          | 在任务内部无法绕过                        |
| 每个启用路由器的任务中的 `pre-push` 钩子           | 删除任何远端 ref，以及任何会丢弃远端已有提交的推送——也就是 `git reset --hard` + `push --force` 的形态 | `git push --no-verify`                    |
| 经路由器中转的 git 传输                            | ref **删除**与**非快进**更新，由路由器自己以 HTTP 403 拒绝——在任务内部无法绕过                        | 操作者在路由器上为具名 ref 设置的放行规则 |

钩子在宿主机的 `~/.hive-mind/git-hooks`（`HIVE_MIND_GIT_HOOKS_DIR`）中生成，并以**只读**方式挂载进任务，因此任务无法修改约束自己的那条规则。指向它的方式是 `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0=core.hooksPath` 而非 `git config --global`，因为容器里的 `~/.gitconfig` 是从宿主机挂载进来的、属于操作者本人的文件。

普通推送、新分支和新标签都不受影响，而且该守卫只存在于启用路由器的任务中。`--allow-fork-divergence-resolution-using-force-push-with-lease` 会把操作者已经给出的强制推送授权带进容器；`HIVE_MIND_ALLOW_DESTRUCTIVE_PUSH=1` 则是手动做同一件事。

第三层已经就位：启用路由器的任务经由 `https://link-assistant-router/git/<owner>/<repo>` 推送，自身不持有任何 GitHub 凭据，`git push origin :branch` 会从路由器得到 `HTTP 403`。自路由器 `0.110.0` 起，强制推送同样会被拒绝：路由器会询问 GitHub 的 compare API，判断待推送的提交是否领先于当前提交，只有领先时才转发 packfile；当它得不到可信的答复时则直接拒绝（[router#272](https://github.com/link-assistant/router/issues/272)，已在 [router#273](https://github.com/link-assistant/router/pull/273) 中修复）。本仓库固定为 `0.119.0`，因此这一层是生效的。

上述测量是在修复之前针对 `0.109.0` 做的，此后固定版本已两次变更而探针未重跑——如果你需要当前的结果而非记录中的结果，见 `experiments/issue-2164/probe-git-transport.sh`。

第二层是减速带，不是牢笼：读过本页的智能体可以绕过它。它消除的是意外，而非对手。第一层和第三层才是任务无法绕开的——但要注意下一节的说明：第一层本身可以通过 GitHub API 触及。

## 尚未覆盖的范围

每次启用路由器的运行都会在开始前打印这些内容。它们是实验阶段如实的边界：

- **对 GitHub API 的破坏性调用是按方法拦截的，而不是按后果**（[router#329](https://github.com/link-assistant/router/issues/329)）。路由器会拒绝所有 `DELETE`、REST 的强制 ref 更新以及破坏性的 GraphQL mutation，但不会拒绝换一种写法达成的同样后果：`PUT /repos/{o}/{r}/branches/{b}/protection` 会整体替换保护对象，`PUT .../rulesets/{id}` 可放宽 ruleset，`POST .../transfer` 会转移仓库，`PATCH /repos/{o}/{r}` 则能改动 `visibility`、`archived` 或 `default_branch`。分支保护可经由此路径触及，因此应把它视为稳妥的默认设置，而不是任务碰不到的控制手段；凡是不允许被改动的东西，都应放在该令牌 `--github-repo` 范围之外。实际影响的边界，取决于路由器向上游出示的那个 `gh` 凭据的权限。
- **Formal AI sidecar 自身的上游调用不经过路由器。** `--model formal-ai` 会经由路由器抵达 Formal AI，但如果该服务器本身去调用厂商 API，那一段会直接从 sidecar 出去。
- **非 Claude 工具的验证较少。** codex、gemini 和 qwen 通过路由器的 OpenAI 兼容接口和一条生成的 provider 记录接入；只有 Claude Code 在 `experiments/issue-2164/` 中有端到端的证据。
- **不接受模型别名。** 路由器按设计不内置别名表（[router#192](https://github.com/link-assistant/router/issues/192)），并且在这一点被提出时明确不打算加入层级解析（[router#323](https://github.com/link-assistant/router/issues/323)），因此 `--model sonnet` 会失败，而 `--model claude-sonnet-4-5-20250929` 可用。自 `0.115.0` 起，拒绝信息会列出该部署确实宣告的 id，因此写错名字时也能看到正确的那个。这影响的是整个以层级命名的接口——`--plan`、`--escalate` 以及内置的回退链都使用层级名——所以在启用路由器的运行中请固定使用带日期的 id。
- **`HIVE_MIND_ROUTER_GITHUB=0` 会关闭 GitHub 路由**；而外部路由器（`HIVE_MIND_ROUTER_URL`）没有我们的容器网络可供拦截，因此需要 `HIVE_MIND_ROUTER_GH_HOST`。这两种情况下任务都保留自己的 `gh` 凭据，其 GitHub 调用不受中介。

## 前置条件

- `--isolation docker`。没有要隔离的容器，路由器隔离便无从谈起。
- Docker 能够拉取 `ghcr.io/link-assistant/router:0.119.0`（可用 `HIVE_MIND_ROUTER_IMAGE` 覆盖）。下限是 `0.110.0`：更早的版本会放行强制推送。
- 如果无法连上路由器，任务**不会启动**。退回直接使用凭据会悄悄取消掉该选项本要提供的隔离。

## 另见

- [收集日志](./COLLECTING-LOGS.zh.md) —— 系统中所有日志位置及其收集方法
- [Docker 支持](./DOCKER.zh.md) —— 路由器所依托的隔离机制
- [分支保护策略](./BRANCH_PROTECTION_POLICY.zh.md) —— 针对破坏性 git 操作的控制手段
- [案例研究：issue #2164](./case-studies/issue-2164/README.md) —— 该设计背后逐条需求的分析
