# 收集日志 (languages: [en](COLLECTING-LOGS.md) • zh • [hi](COLLECTING-LOGS.hi.md) • [ru](COLLECTING-LOGS.ru.md))

Hive Mind 会在若干处留下证据，其中没有任何一处能独自讲完一次运行的完整经过。当你排查失败——或审计一个自主智能体做了什么——时，你需要全部这些。本页就是这份完整清单，以及遍历它的脚本。

```bash
node examples/collect-logs.mjs --list                  # 列出所有位置，不复制任何内容
node examples/collect-logs.mjs --out ./audit           # 把它们收集到 ./audit
node examples/collect-logs.mjs --out ./audit --session <uuid>   # 另加该会话的控制台日志
```

脚本会在收集结果旁写下 `INDEX.md`，记录哪些内容被收入、哪些被跳过，以及每个位置存放什么。它遍历的清单就是 `src/router-logs.lib.mjs` 中的 `describeSystemLogLocations()`——与本页所记录的是同一份，放在代码里正是为了让两者不会各说各话。

## 各个位置

| 位置           | 路径                                                                      | 存放什么                                                                                                                     |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **运行日志**   | 工作目录，或 `--log-dir` / `HIVE_MIND_LOG_DIR`                            | 每次运行一份 `solve-*.log` / `hive-*.log`；一旦 AI 工具报告了会话 id，就重命名为 `<sessionId>.log`。单次运行的完整叙述。     |
| **机器人日志** | `~/.hive-mind/logs`（`HIVE_MIND_LOG_DIR`）                                | 轮转的 `telegram-bot.log` 以及带时间戳的备份：机器人处理过的每条命令、每次启动和每个生命周期事件。                           |
| **机器人状态** | `~/.hive-mind/state`（`HIVE_MIND_STATE_DIR`）                             | 已跟踪的会话与 sidecar 状态，包括 `router-sidecar.json`——哪个任务在何时持有哪个令牌。**内含路由器签名密钥；权限为 `0600`。** |
| **会话控制台** | `/tmp/start-command/logs/isolation/<backend>/<uuid>.log`                  | 隔离会话的控制台输出。Telegram 的 `/log <uuid>` 命令返回的正是它。                                                           |
| **容器日志**   | `docker logs <sessionId>`                                                 | Docker 自己捕获的任务容器 stdout/stderr，在容器被删除前可用。                                                                |
| **路由器请求** | `hive-mind-router-data:/data/router/requests/<token-hash>/requests.jsonl` | 每个已签发令牌——也就是每个任务——一份脱敏 JSONL 请求日志。令牌吊销后仍然保留。                                                |
| **路由器审计** | `hive-mind-router-data:/data/router/audit.jsonl`                          | 令牌的签发、吊销与轮换事件。                                                                                                 |
| **任务会话**   | `hive-mind-router-data:/data/router/task-sessions/<sessionId>/`           | 在每个使用路由器的任务容器被回收前从中导出的智能体会话数据：智能体实际所作所为的记录。                                       |

最后三项仅在使用 [`--use-router`](./ROUTER.zh.md) 时才存在。

## 状态目录不是可以分享的证据

`~/.hive-mind/state` 中存有为路由器令牌签名的密钥。谁拿到它，谁就能针对订阅签发令牌。因此 `examples/collect-logs.mjs` **从不复制它**——它只打印路径让你知道在哪，然后原地不动。如果调查确实需要其中某项内容，请提取那一项具体事实，而不是整个目录。

清单上的其余内容都可以分享，但需照例复核：Hive Mind 会在自己的输出路径上[对已识别的凭据做脱敏](./CREDENTIAL-SANITIZATION.zh.md)，路由器也会脱敏请求体，但两者都不能替代你在把归档附到公开 issue 之前亲自读一遍。

## 路由器没在运行时如何读取其日志

路由器的数据位于命名卷 `hive-mind-router-data` 中，而不在容器里。该卷比任何向它写入的容器都活得久，Hive Mind 也从不删除它——但 sidecar 本身一旦无任务需要就会被停止，所以在你想要日志的那一刻，通常已经没有正在运行的容器可问了。

两种情况都已考虑到：

```bash
# sidecar 在运行时——直接从中复制：
docker cp hive-mind-router:/data/router/. ./audit/router

# 不在运行时——把卷挂载进一个一次性容器：
docker run --rm --entrypoint cp \
  -v hive-mind-router-data:/data/router:ro \
  -v "$PWD/audit/router:/export" \
  --user "$(id -u):$(id -g)" \
  ghcr.io/link-assistant/router:latest -a /data/router/. /export/
```

`src/router-logs.lib.mjs` 中的 `collectRouterLogs()` 先尝试前者，失败则回退到后者。请留意回退命令中的两处安全细节，手动执行时同样值得保留：数据卷以**只读**方式挂载，因此收集证据绝不会损坏证据；`--user` 则让导出的文件无需 root 即可读取。

## 找到你要的那次运行

- **从 Telegram：** `/log <uuid>` 直接返回会话控制台日志；`/status` 列出存活的会话及其 uuid。
- **从会话 id：** 工具报告 id 之后，运行日志即命名为 `<sessionId>.log`，因此在日志目录下执行 `grep -rl <sessionId>` 就能找出关于该次运行的所有文件。
- **从使用路由器的任务：** 状态目录中的 `router-sidecar.json` 把会话 id 映射到令牌 id，而令牌 id 就是 `requests/` 下的目录名。

## 保留策略

除机器人日志会保留带时间戳的备份外，这里的内容都不会自动轮转清理。运行日志、会话控制台日志和路由器数据卷会一直增长，直到你自行删除。容器日志随容器一起消失。

若你打算长期保留审计轨迹，请按计划把路由器数据卷复制到持久存储：它是唯一按"完整"设计的位置。

## 另见

- [路由器隔离](./ROUTER.zh.md) —— 路由器日志由何产生，以及为何每个任务单独发令牌很重要
- [凭据脱敏](./CREDENTIAL-SANITIZATION.zh.md) —— 写入或发布之前会屏蔽哪些内容
- [Docker 支持](./DOCKER.zh.md) —— 容器隔离及其自身的诊断手段
