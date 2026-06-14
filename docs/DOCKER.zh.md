# Hive Mind Docker 支持 (languages: [en](DOCKER.md) • zh • [hi](DOCKER.hi.md) • [ru](DOCKER.ru.md))

本文档介绍如何在 Docker 容器中运行 Hive Mind。

## 快速开始

### 选项 1：使用 Docker Hub 上的预构建镜像（推荐）

```bash
# 拉取最新镜像
docker pull konard/hive-mind:latest

# 运行交互式会话
docker run -it konard/hive-mind:latest

# 重要：身份验证在 Docker 镜像安装完成后进行
# 安装脚本不会运行 gh auth login 以避免构建超时
# 这允许 Docker 构建成功完成，无需交互式提示

# 在容器内，使用 GitHub 进行身份验证
gh auth login -h github.com -s repo,workflow,user,read:org,gist

# 使用 Claude 进行身份验证
claude

# 现在您可以使用 hive 和 solve 命令
solve https://github.com/owner/repo/issues/123
```

### 选项 2：本地构建

```bash
# 构建生产镜像
docker build -t hive-mind:local .

# 运行镜像
docker run -it hive-mind:local
```

### 选项 3：Docker-in-Docker 镜像

当代理需要在 Hive Mind 容器内运行 Docker、Docker Compose 或 Testcontainers 时，请使用 `konard/hive-mind-dind:latest`。

```bash
# 拉取 Docker-in-Docker 镜像
docker pull konard/hive-mind-dind:latest

# 默认运行方式：privileged 容器会启动内部 dockerd
docker run --rm --privileged -it konard/hive-mind-dind:latest bash

# 在容器内验证嵌套 Docker
docker info
docker run hello-world
```

该镜像默认将内部 Docker daemon 设置为 `DIND_STORAGE_DRIVER=fuse-overlayfs`。这是一个**写时复制（copy-on-write）**驱动，因此数 GB 的 Hive Mind 镜像在磁盘上只占用约一份真实大小——而 `vfs` 会完整复制每一层，使磁盘占用膨胀到镜像大小的数倍，最终以 `failed to register layer: no space left on device` 耗尽磁盘（[issue #1914](https://github.com/link-assistant/hive-mind/issues/1914)）。`fuse-overlayfs` 同时支持 overlay-on-overlay（这正是当初选择 `vfs` 的兼容性原因），镜像已内置 `fuse-overlayfs` 二进制，且 Hive Mind 以 `--privileged` 启动 DinD 容器，因此 `/dev/fuse` 可用。覆盖选项：

- `-e DIND_STORAGE_DRIVER=overlay2`——在支持嵌套 overlay mount 的宿主机上更快，但在 overlay-backed 宿主机上可能失败；
- `-e DIND_STORAGE_DRIVER=vfs`——仅作为最后的兼容性回退；占用数倍磁盘，且正是导致 issue #1914 的配置。

> **已经在旧的 `vfs` 镜像上运行的容器？** 在 bot 容器的 `docker run` 中加上 `-e DIND_STORAGE_DRIVER=fuse-overlayfs` 并重新创建容器——无需重新构建镜像。

如果宿主机支持 Sysbox，优先使用 Sysbox runtime：

```bash
docker run --rm --runtime=sysbox-runc -it konard/hive-mind-dind:latest bash
```

DinD 镜像与 `konard/hive-mind:latest` 分开发布，因此不需要嵌套 Docker 的用户可以继续使用现有的低权限镜像。

#### 宿主镜像透传（避免重复下载数 GB 镜像）

当机器人以 `--isolation docker` 在 DinD 镜像内运行时，每个任务都会以*嵌套*的
`docker run konard/hive-mind-dind:latest …` 启动。该嵌套 `docker run` 与**内部**
dockerd 通信，而内部镜像库一开始是**空的**（部署会在 `docker commit` 之前清空
`/var/lib/docker`）。于是 Docker 报告 `Unable to find image '…' locally` 并拉取新副本——
而 Hive Mind 镜像有数 GB，因此第一个隔离任务可能要花很长时间（或耗尽磁盘）去重新下载
一个**宿主机已有**的镜像。参见
[issue #1914](https://github.com/link-assistant/hive-mind/issues/1914) 和
[#1879](https://github.com/link-assistant/hive-mind/issues/1879)。

基础镜像（`konard/box-dind`）可以从宿主机自动播种内部 daemon——**宿主镜像透传**——
但前提是把宿主机的 Docker 套接字 bind-mount 进容器。**如果不挂载该套接字，透传将静默无效**，
内部 daemon 保持为空。请挂载它并设置允许列表：

```bash
docker run -dit --privileged --name hive-mind --restart unless-stopped \
  # ... 你常用的凭据挂载 ...
  -v /var/run/docker.sock:/var/run/host-docker.sock:ro \
  -e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind" \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

透传由以下环境变量控制（由 `box-dind` 识别）：

| 变量                               | 默认值                      | 用途                                                                        |
| ---------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `DIND_HOST_PASSTHROUGH`            | `public`                    | `off`、`public`（仅复制带有公共注册表 digest 的镜像）或 `all`。             |
| `DIND_HOST_DOCKER_SOCK`            | `/var/run/host-docker.sock` | 宿主套接字在容器内的挂载位置。Hive Mind 读取同一个变量。                    |
| `DIND_HOST_PASSTHROUGH_IMAGES`     | _(空 = 任意)_               | 以空格分隔的镜像名允许列表，例如 `konard/hive-mind konard/hive-mind-dind`。 |
| `DIND_HOST_PASSTHROUGH_REGISTRIES` | _(空)_                      | `public` 模式下可选的注册表允许列表。                                       |

在默认的 `public` 模式下，只有携带公共注册表 digest 的镜像才会被复制，因此宿主副本必须是
已拉取/推送的镜像（仅本地 `docker build`、没有 `RepoDigest` 的镜像会被跳过——请先推送，或使用 `all`）。

**启动预检。** 启用 `--isolation docker` 时，机器人会在启动时探测内部 daemon 并记录结果，
让配置错误立即暴露，而不是在任务执行中变成意外拉取：

- ✅ 镜像已存在 → 隔离任务复用它（无需拉取）；
- ⚠️ 套接字**未**挂载 → 提示你添加套接字挂载 + 允许列表；
- ⚠️ 套接字已挂载但镜像仍缺失 → 提示你检查透传模式/允许列表/digest；
- ⚠️ 内部 daemon 使用 `vfs` 存储驱动 → 提示你切换到 `fuse-overlayfs`（issue #1914 的磁盘膨胀根因）；
- ⚠️ Docker data root 可用空间不足且镜像仍缺失 → 警告即将进行的拉取可能耗尽磁盘。

以 `--verbose`（或 `TELEGRAM_BOT_VERBOSE=true`）运行机器人可查看底层
`docker image inspect` 跟踪。

**手动回退。** 要立即为正在运行的容器播种（或当你无法更改部署时），把宿主镜像复制进内部 daemon：

```bash
node scripts/preload-dind-isolation-image.mjs \
  --container hive-mind --image konard/hive-mind-dind:latest
```

它以 `docker save … | docker exec -i <container> docker load` 流式传输，因此 tarball 永不落盘；
如果内部 daemon 已有该镜像，则为空操作。镜像就位后，start-command 的原生 Docker 后端会自动复用它
（Docker 默认的 "missing" 拉取策略——仅在镜像缺失时拉取，因此不会重复下载）。

### 选项 4：开发模式（Gitpod 风格）

出于开发目的，旧版 `Dockerfile` 提供了一个 Gitpod 兼容的环境：

```bash
# 构建开发镜像
docker build -t hive-mind-dev .

# 挂载凭据运行
docker run --rm -it \
    -v ~/.config/gh:/home/box/.persisted-configs/gh:ro \
    -v ~/.local/share/claude-profiles:/home/box/.persisted-configs/claude:ro \
    -v ~/.config/claude-code:/home/box/.persisted-configs/claude-code:ro \
    -v "$(pwd)/output:/home/box/output" \
    hive-mind-dev
```

## 身份验证

生产 Docker 镜像（`Dockerfile`）使用 Ubuntu 24.04 和官方安装脚本。**重要**：身份验证在 Docker 镜像完全安装并运行后，**在容器内部**执行。

**为什么身份验证在安装后进行：**

- ✅ 避免因交互式提示导致 Docker 构建超时
- ✅ 防止 CI/CD 流水线中的构建失败
- ✅ 允许安装脚本成功完成
- ✅ 支持自动化 Docker 镜像构建

### GitHub 身份验证

```bash
# 在容器内，容器运行后执行
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

**注意**：安装脚本故意不在构建过程中调用 `gh auth login`。这是为了支持无超时的 Docker 构建而有意为之。

### Claude 身份验证

```bash
# 在容器内，容器运行后执行
claude
```

此方法允许：

- ✅ 多个 Docker 实例使用不同的 GitHub 账户
- ✅ 多个 Docker 实例使用不同的 Claude 订阅
- ✅ 容器之间不泄露凭据
- ✅ 每个容器拥有独立的身份验证
- ✅ 无需交互式身份验证即可成功构建 Docker 镜像

## Docker 中的 Playwright MCP 状态

镜像构建现在会为 Claude 和 Codex 注册 Playwright MCP：

- `claude mcp add playwright -s user -- ...`
- `codex mcp add playwright -- ...`

CI 工作流还会构建 Docker 镜像并验证：

- `playwright --version` 可作为 CLI fallback 使用；
- `npx --no-install @playwright/mcp --help` 可在不重新安装 MCP 包的情况下运行；
- `claude mcp list` 将 Playwright server 报告为 connected/enabled，而不是 pending 或 unavailable；
- `codex mcp list` 将 Playwright server 报告为 connected/enabled，而不是 pending 或 unavailable。

如果运行中的容器里 `codex mcp list` 仍显示 `No MCP servers configured yet`，最可能的原因是从宿主机挂载了 `/home/box/.codex`。在此镜像中 `HOME=/home/box`，因此挂载 `/home/box/.codex` 会替换镜像内置的 Codex 配置，包括预配置的 MCP 条目。

这意味着：

- 发布的镜像可能是正确的；
- 运行时容器仍可能显示 Codex 未配置；
- 差异来自持久化宿主机状态覆盖了容器默认值。

快速确认方式是比较以下两种情况：

```bash
# 不挂载宿主机 Codex 状态的新容器
docker run --rm -it konard/hive-mind:latest bash -lc 'codex mcp list'

# 挂载宿主机持久化 Codex 状态的容器
docker run --rm -it \
  -v /root/.hive-mind/codex:/home/box/.codex \
  konard/hive-mind:latest \
  bash -lc 'codex mcp list'
```

如果第一条命令显示 `playwright` 而第二条没有，则宿主机挂载的 Codex 目录就是差异来源。

## 前提条件

1. **Docker**：安装 Docker Desktop 或 Docker Engine（版本 20.10 或更高）
2. **网络连接**：拉取镜像和身份验证需要

## 目录结构

```
.
├── Dockerfile                    # 使用 Ubuntu 24.04 的生产镜像
├── experiments/
│   └── solve-dockerize/
│       └── Dockerfile            # 旧版 Gitpod 兼容镜像（已归档）
├── scripts/
│   └── ubuntu-24-server-install.sh  # Dockerfile 使用的安装脚本
└── docs/
    └── DOCKER.md                 # 本文件
```

## 高级用法

### 使用持久化存储运行

在容器重启之间持久化身份验证和工作内容：

```bash
# 为 box 用户的主目录创建卷
docker volume create box-home

# 挂载卷运行
docker run -it -v box-home:/home/box konard/hive-mind:latest
```

如果持久化的 `/home/box/.codex/config.toml` 来自较旧镜像，可能缺少新版镜像添加的 Playwright MCP 注册。容器启动后可重新运行：

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080
```

当 `codex mcp list` 没有 Playwright 行且已安装 `@playwright/mcp` 时，Hive Mind 也会在运行时尝试这种默认注册修复。它不会覆盖已有的 pending、disabled 或自定义 Playwright 行；这些状态需要直接调试 MCP 启动路径。

### 以守护进程模式运行

```bash
# 启动守护进程容器
docker run -d --name hive-worker -v box-home:/home/box konard/hive-mind:latest sleep infinity

# 在运行中的容器内执行命令
docker exec -it hive-worker bash

# 在容器内运行您的命令
solve https://github.com/owner/repo/issues/123
```

### 使用 Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3.8'
services:
  hive-mind:
    image: konard/hive-mind:latest
    volumes:
      - box-home:/home/box
    stdin_open: true
    tty: true

volumes:
  box-home:
```

然后运行：

```bash
docker-compose run --rm hive-mind
```

## 故障排除

### GitHub 身份验证问题

```bash
# 在容器内，检查身份验证状态
gh auth status

# 如需重新验证
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Claude 身份验证问题

```bash
# 在容器内，重新运行 Claude 进行身份验证
claude
```

### Docker 问题

```bash
# 检查宿主机上的 Docker 状态
docker info

# 拉取最新镜像
docker pull konard/hive-mind:latest

# 从源代码重新构建
docker build -t hive-mind:local .
```

### 构建问题

如果在本地构建镜像时遇到问题：

1. 确保有足够的磁盘空间（至少 20GB 空余）
2. 检查网络连接
3. 尝试使用更详细的输出进行构建：
   ```bash
   docker build -t hive-mind:local --progress=plain .
   ```

## 发布到 Docker Hub 的 CI/CD 配置

如果您正在维护一个 fork 或想要发布到自己的 Docker Hub 账户，请按照以下步骤配置 GitHub Actions：

### 步骤 1：创建 Docker Hub 账户

1. 访问 [hub.docker.com](https://hub.docker.com)
2. 注册或登录您的账户
3. 记下您的 Docker Hub 用户名（例如 `konard`）

### 步骤 2：生成 Docker Hub 访问令牌

1. 登录 [hub.docker.com](https://hub.docker.com)
2. 点击右上角的用户名
3. 选择 **Account Settings** → **Security**
4. 点击 **New Access Token**
5. 输入描述（例如"GitHub Actions - Hive Mind"）
6. 将权限设置为 **Read, Write, Delete**（发布所需）
7. 点击 **Generate**
8. **重要**：立即复制令牌——您将无法再次查看它！
   - 示例格式：`dckr_pat_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

### 步骤 3：向 GitHub 仓库添加 Secret

1. 进入您的 GitHub 仓库（例如 `https://github.com/konard/hive-mind`）
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 添加以下两个 secret：

   **Secret 1: DOCKERHUB_USERNAME**
   - 名称：`DOCKERHUB_USERNAME`
   - 值：您的 Docker Hub 用户名（例如 `konard`）
   - 点击 **Add secret**

   **Secret 2: DOCKERHUB_TOKEN**
   - 名称：`DOCKERHUB_TOKEN`
   - 值：在步骤 2 中生成的访问令牌
   - 点击 **Add secret**

### 步骤 4：更新 Docker 镜像名称

如果使用 fork，请在 `.github/workflows/docker-publish.yml` 中更新镜像名称：

```yaml
env:
  REGISTRY: docker.io
  IMAGE_NAME: YOUR_DOCKERHUB_USERNAME/hive-mind # 将此处改为您的用户名
```

### 步骤 5：验证配置

1. 将更改推送到 `main` 分支
2. 进入 GitHub 仓库的 **Actions** 选项卡
3. 找到"Docker Build and Publish"工作流
4. 检查其是否成功完成
5. 验证镜像出现在 [hub.docker.com/r/YOUR_USERNAME/hive-mind](https://hub.docker.com/r/konard/hive-mind)

### 工作原理

- **Pull Request 时**：工作流测试构建 Docker 镜像，但不发布
- **main 分支时**：工作流构建并以 `latest` 标签发布到 Docker Hub
- **版本标签时**：工作流以语义化版本标签发布（例如 `v0.37.0`、`0.37`、`0`）

### CI/CD 故障排除

**因身份验证错误导致构建失败：**

- 验证 `DOCKERHUB_USERNAME` 与您的 Docker Hub 用户名完全匹配
- 重新生成 `DOCKERHUB_TOKEN` 并更新 secret

**镜像已发布但无法拉取：**

- 确保 Docker Hub 上的仓库是公开的（或您已通过身份验证）
- 检查 [hub.docker.com](https://hub.docker.com) → 您的仓库 → hive-mind → Settings → Make Public

**构建成功但镜像未出现：**

- 检查您是否推送到了 `main` 分支（Pull Request 仅测试，不发布）
- 验证工作流是否在 Actions 选项卡中运行
- 检查是否超出了 Docker Hub 速率限制

## 安全说明

- 每个容器维护其独立的身份验证
- 容器之间不共享凭据
- Docker 镜像本身不存储任何凭据
- 身份验证在容器启动后在内部进行
- 每个 GitHub/Claude 账户可以拥有自己的容器实例
- Docker Hub 访问令牌应仅作为 GitHub Secret 存储，绝不提交到仓库
