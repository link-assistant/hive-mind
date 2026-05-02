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

该镜像默认将内部 Docker daemon 设置为 `DIND_STORAGE_DRIVER=vfs`，以兼容 overlay-backed 宿主机。如果宿主机支持嵌套 overlay mount，可传入 `-e DIND_STORAGE_DRIVER=overlay2` 获得更快的本地运行速度。

如果宿主机支持 Sysbox，优先使用 Sysbox runtime：

```bash
docker run --rm --runtime=sysbox-runc -it konard/hive-mind-dind:latest bash
```

DinD 镜像与 `konard/hive-mind:latest` 分开发布，因此不需要嵌套 Docker 的用户可以继续使用现有的低权限镜像。

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
