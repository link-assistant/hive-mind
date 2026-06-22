# Docker 隔离：DinD 与 DooD (languages: [en](DOCKER-ISOLATION.md) • zh • [hi](DOCKER-ISOLATION.hi.md) • [ru](DOCKER-ISOLATION.ru.md))

Hive Mind 可以用 `--isolation docker` 让每个任务在自己的 Docker 容器中运行（关于
周边的 Docker 配置见 [DOCKER.md](./DOCKER.zh.md)）。本页解释隔离与 Docker daemon
通信的**两种方式**——**DinD** 和 **DooD**——二者的取舍，以及各自的运行配方。

> **一句话总结** — 在磁盘受限的主机上，优先选择 **DooD**：机器人共享主机的 Docker
> daemon，因此隔离任务**复用主机上已有的镜像，零拷贝、零拉取、零额外磁盘**。DinD 让
> 每个机器人拥有自己的嵌套 daemon，但必须保存多 GB 镜像的**第二份完整副本**。
> 见 [issue #1962](https://github.com/link-assistant/hive-mind/issues/1962)。

## 运行器相同——只有 daemon 不同

`--isolation docker` 始终通过 start-command 发出**相同**的普通命令：

```text
$ --isolated docker --image <ref> [--privileged] --shell sh -e … --volume … \
    --detached --session <uuid> -- '<command>'
```

即对**机器人的 `docker` 所连接的那个 daemon** 执行普通的 `docker run`。模式纯粹是关于
**那个 daemon 是哪一个**：

| 模式                             | 由哪个 daemon 运行任务              | 镜像成本                                   | 每任务隔离                            |
| -------------------------------- | ----------------------------------- | ------------------------------------------ | ------------------------------------- |
| **DinD**（Docker-in-Docker）     | 机器人容器内部的**嵌套** daemon     | 嵌套存储中必须存在镜像的**第二份完整副本** | 每任务一个容器**以及**一个私有 daemon |
| **DooD**（Docker-out-of-Docker） | **主机** daemon（通过其套接字共享） | **零**——任务复用主机已有的镜像             | 每任务一个容器；**daemon 共享**       |

两种模式都让每个任务拥有自己的容器（进程／文件系统／网络隔离）。区别在 daemon：DinD 嵌套
一个（完整镜像副本，隔离更强）；DooD 共享主机的（零拷贝，是在空闲磁盘容纳不下第二份镜像
副本时唯一的无拷贝选项）。

## Hive Mind 如何选择模式

Hive Mind 按以下优先级解析模式：

1. **`HIVE_MIND_DOCKER_ISOLATION_MODE`** — 显式 `dind` 或 `dood`。用它以明确无歧义。
2. **`DIND_SKIP_DAEMON`** 为真 — box 的 DooD 开关。DinD 入口脚本跳过启动嵌套 daemon，
   于是 `docker` CLI 指向主机 daemon → **DooD**。
3. **`DOCKER_HOST`** 指向非嵌套 daemon（`tcp://…`、`ssh://…`，或**不是**容器内默认
   `/var/run/docker.sock` 的 `unix://` 套接字）→ **DooD**。
4. 否则 → **DinD**（历史默认值，因此现有部署保持不变）。

使用 `--verbose`（或 `TELEGRAM_BOT_VERBOSE=true`）时，启动日志会打印解析出的模式以及
`docker` 指向哪个 daemon，从而立即暴露配置错误。

## DinD 配方（嵌套 daemon）

每个任务在机器人容器内部嵌套的 daemon 上运行。嵌套存储起初是**空的**，因此必须把镜像
播种进去（box 主机镜像透传），否则第一个任务会拉取完整的多 GB 镜像。详情见
[DOCKER.md → 主机镜像透传](./DOCKER.zh.md#host-image-passthrough-avoid-re-downloading-multi-gb-images)：

```bash
docker run -dit --privileged --name hive-mind --restart unless-stopped \
  # ... 你常用的凭据挂载 ...
  -v /var/run/docker.sock:/var/run/host-docker.sock:ro \
  -e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind" \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

DinD 需要为重复的镜像付出磁盘代价，但每个机器人获得完全私有的 daemon。当 daemon 隔离比
磁盘更重要时优先选择它。

## DooD 配方（共享主机 daemon）——磁盘紧张时推荐

机器人通过把主机 Docker 套接字挂载为 `/var/run/docker.sock` 并跳过嵌套 daemon 来共享
**主机** daemon。隔离任务于是在主机 daemon 上运行，**复用主机镜像，无拉取、无拷贝**：

```bash
# 主机的 docker 组 GID——容器需要它来读取挂载的套接字。
HOST_DOCKER_GID="$(getent group docker | cut -d: -f3)"

docker run -dit --name hive-mind --restart unless-stopped \
  # ... 你常用的凭据挂载 ...
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "${HOST_DOCKER_GID}" \
  -e DIND_SKIP_DAEMON=1 \
  -e HIVE_MIND_DOCKER_ISOLATION_MODE=dood \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

关键标志：

- `-v /var/run/docker.sock:/var/run/docker.sock` — 机器人的 `docker` 现在连接到
  **主机** daemon（而非嵌套的）。
- `--group-add <host-docker-gid>` — **必需**，以便非 root 的 `box` 用户能读取挂载的
  套接字；否则 `docker` 会因权限错误失败。
- `-e DIND_SKIP_DAEMON=1` — 告诉 DinD 镜像的入口脚本不要启动自己的 daemon（没有需要
  嵌套的东西）。
- `-e HIVE_MIND_DOCKER_ISOLATION_MODE=dood` — 让模式显式化，使诊断描述**主机** daemon，
  绝不会就 DooD 中不存在的嵌套 daemon 或透传发出误报。（设置 `DIND_SKIP_DAEMON` 已能
  推断出 DooD；此项让其明确无歧义。）

> **一个镜像，两种模式。** `konard/hive-mind-dind` 在**任一**模式下运行——区别仅在上面的
> 运行标志。你不需要为 DooD 准备单独的镜像。

> **安全提示。** DooD 共享主机 daemon，因此任务能访问主机上的每个容器和镜像。请在你掌控
> 的主机上使用它，且该信任边界可被接受。

## DooD 中的凭据挂载（主机 daemon 挂载源陷阱）

每个隔离任务都会把 bot 的凭据挂载进容器，以便 `gh`、git 和 agent CLI 完成认证：
`~/.config/gh`、`~/.gitconfig`、`~/.config/git`，以及按工具划分的 `~/.claude` +
`~/.claude.json` 或 `~/.codex`。这些挂载**源**是从 bot 的 home 解析出来的（例如
`/home/box/.gitconfig`）。

在 **DinD** 下这是正确的：嵌套 daemon 与 bot 共享文件系统，所以
`/home/box/.gitconfig` 就是真实文件。在 **DooD** 下，任务在**主机** daemon 上运行，
它会按**主机**文件系统解析 bind 挂载源——而 `/home/box/...` 通常并不存在。于是 Docker
会把每个缺失的源**自动创建为空目录**，从而以两种方式破坏任务
（[issue #1962](https://github.com/link-assistant/hive-mind/issues/1962)）：

1. 文件挂载（`~/.claude.json`、`~/.gitconfig`）失败并报 _"Are you trying to mount a
   directory onto a file (or vice‑versa)?"_——任务尚未启动就崩溃。
2. git 身份为空（`fatal: empty ident name (for <>)`），因为挂载进来的 `~/.gitconfig`
   是一个空目录。

你必须让 bot 的配置在**主机上解析到相同的路径**。两种受支持的方式：

**方式 A——在主机上暴露相同路径（符号链接可用）。** 把容器的 home 配置以相同路径绑定到
主机，或用符号链接。Docker 会跟随符号链接挂载源，所以把主机的 `/home/box/.claude` 等
指向文件真正所在之处即可：

```bash
# 在主机上，以 bot 使用的相同路径暴露其凭据。
# （若你修改了 bot 用户的 home，请相应调整 /home/box。）
sudo mkdir -p /home/box/.config
sudo ln -s /srv/hive-config/.gitconfig   /home/box/.gitconfig
sudo ln -s /srv/hive-config/.claude      /home/box/.claude
sudo ln -s /srv/hive-config/.claude.json /home/box/.claude.json
sudo ln -s /srv/hive-config/.config/gh   /home/box/.config/gh
# ……以及 Codex 工具的 ~/.codex、XDG git 配置的 ~/.config/git。
```

**方式 B——让 Hive Mind 指向主机配置根目录（推荐）。** 把
`HIVE_MIND_HOST_CONFIG_DIR` 设为**主机**上存放 bot 的 `.gitconfig`、`.claude`、
`.claude.json`、`.codex` 和 `.config/gh` 的目录。在 DooD 下，Hive Mind 会改为按该根目录
解析常规的 `~/.x` 挂载源，而不是 bot 的 home，于是主机 daemon 绑定的就是真实文件：

```bash
docker run -dit --name hive-mind --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "${HOST_DOCKER_GID}" \
  -e DIND_SKIP_DAEMON=1 \
  -e HIVE_MIND_DOCKER_ISOLATION_MODE=dood \
  -e HIVE_MIND_HOST_CONFIG_DIR=/srv/hive-config \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

`HIVE_MIND_HOST_CONFIG_DIR` 仅在 DooD 下生效（DinD 始终使用 bot 的 home，因为那里的源
就是真实文件）。由于 bot 无法 stat 主机 daemon 的路径，重定位后的源会跳过 bot 侧的存在性
检查并信任你的主机布局——请确保每个文件/目录都以正确类型存在（例如 `.claude.json` 是
**文件**，`.claude` 是**目录**）。

启动预检会检测 DooD，并在挂载源仍是 bot 的 home 路径且未设置
`HIVE_MIND_HOST_CONFIG_DIR` 时，在首个任务之前发出警告——把原始的 Docker 挂载失败变成
可操作的提示。

## 精确标签要求（两种模式）

`resolveDockerIsolationImageTag()` 让每个任务请求**精确**的
`HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`（例如 `konard/hive-mind-dind:2.0.13`），而非浮动
的 `:latest`。要实现零拷贝复用，daemon 必须持有**那个精确标签**：

- **DooD** — 在启动任务前于**主机**拉取精确标签：
  ```bash
  docker pull konard/hive-mind-dind:2.0.13
  ```
- **DinD** — 用精确标签为**嵌套** daemon 播种（透传或 [DOCKER.md](./DOCKER.zh.md#host-image-passthrough-avoid-re-downloading-multi-gb-images)
  中的预加载脚本）。

发布镜像会从已发布的 `HIVE_MIND_VERSION` 烘焙出 `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`，
因此即使父容器以 `:latest` 启动，子容器仍使用相同的不可变发布标签。请在你的部署中固定该
解析出的版本；如果 daemon 只有 `:latest`，digest 漂移会强制重新拉取多 GB 镜像。

## 验证 DooD 复用（无静默重新拉取）

两项检查确认机器人处于 DooD 并将复用主机镜像：

```bash
# 1. 机器人的 docker 连接到主机 daemon（DooD 访问正常）。
docker exec hive-mind docker info >/dev/null && echo "DooD docker access OK"

# 2. 该 daemon 上已存在精确的隔离标签（零拷贝复用）。
TAG="$(docker exec hive-mind printenv HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG || true)"
docker exec hive-mind docker image inspect "konard/hive-mind-dind:${TAG:-latest}" >/dev/null \
  && echo "镜像已存在于主机 daemon → 零拷贝，首个任务无需拉取"
```

启动预检会自动执行等价探测，并在 DooD 模式下记录：

- ✅ 镜像已存在于**主机** daemon → 任务复用它（零拷贝／零拉取）；
- ⚠️ 镜像在主机 daemon 上**缺失** → 在主机拉取精确标签并固定
  `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`（绝不会提到 DooD 中不存在的嵌套 daemon 或透传）；
- ⚠️ 主机 daemon 使用 `vfs` 存储驱动／空闲磁盘不足 → 通常的磁盘溢出警告，指向**主机**
  daemon。

## 相关

- [DOCKER.md](./DOCKER.zh.md) — 通用 Docker 配置、DinD 镜像以及 DinD 的主机镜像透传。
- [issue #1962](https://github.com/link-assistant/hive-mind/issues/1962) — 支持并记录
  两种模式的请求。
- [issue #1914](https://github.com/link-assistant/hive-mind/issues/1914)、
  [#1879](https://github.com/link-assistant/hive-mind/issues/1879)、
  [#1946](https://github.com/link-assistant/hive-mind/issues/1946) — 本工作所基于的
  DinD 镜像复用／磁盘工作。
