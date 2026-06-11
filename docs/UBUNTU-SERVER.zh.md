# 在 Ubuntu 24.04 服务器上安装（已弃用） (languages: [en](UBUNTU-SERVER.md) • zh • [hi](UBUNTU-SERVER.hi.md) • [ru](UBUNTU-SERVER.ru.md))

> ⚠️ **已弃用：** 不再推荐使用此安装方式。
>
> **我们现在推荐所有安装都使用 Docker**，无论是开发者机器还是服务器。
> Docker 提供更好的隔离、更便捷的管理和一致的环境。
>
> 请改用 [Docker 安装方式](../README.zh.md#using-docker)。
> 对于 Kubernetes 部署，请参阅 [Helm 安装](../README.zh.md#helm-installation-kubernetes)。
> 有关详细的 Docker 使用说明，请参阅 [docs/DOCKER.zh.md](./DOCKER.zh.md)。

---

以下说明描述了在 Ubuntu 24.04 服务器上进行旧版裸机安装的方法。此方法仅作参考。

> **注意**：自 issue #1639 起，`ubuntu-24-server-install.sh` 脚本已从仓库中删除。
> Docker 镜像现在使用 `konard/box`（固定到特定版本）作为基础镜像，提供所有开发工具。
> 作为历史参考，在 Ubuntu 24.04 之上预装完整 Hive Mind 工具链的脚本最后一个版本保留在：
> https://github.com/link-assistant/hive-mind/blob/4f027b32/scripts/ubuntu-24-server-install.sh
>
> `konard/box` 镜像是通用基础镜像，本身不包含 Hive Mind 专用工具，因此这个旧的 Hive Mind 脚本仍然作为裸机安装路径的唯一保留来源。

## 步骤

1. 使用全新的 Ubuntu 24.04 重置/安装 VPS/VDS 服务器
2. 登录 `root` 用户。
3. 首先安装 Box（提供所有开发工具）

   ```bash
   # 选项 1：使用 Docker（推荐）
   docker pull konard/box:2.2.0
   docker run -it konard/box:2.2.0

   # 选项 2：使用旧版 Hive Mind 裸机安装脚本（固定到最后一个包含它的提交：4f027b32）
   curl -fsSL -o- https://raw.githubusercontent.com/link-assistant/hive-mind/4f027b32/scripts/ubuntu-24-server-install.sh | bash
   ```

   **注意**：安装不会自动运行 `gh auth login`。这是为了支持无超时的 Docker 构建而有意为之。身份验证将在后续步骤中执行。

4. 登录 `box` 用户

   ```bash
   su - box
   ```

5. **重要**：安装完成后，使用 GitHub CLI 进行身份验证

   ```bash
   gh-setup-git-identity
   ```

   注意：按照提示使用您的 GitHub 账户进行身份验证。这是 gh 工具正常工作所必需的，系统将使用此 GitHub 账户执行所有操作。此步骤必须在安装脚本完成后进行，以避免 Docker 环境中的构建超时。

6. Claude Code CLI、OpenCode AI CLI 和 @link-assistant/agent 已通过前面的脚本预安装。现在您需要确保 claude 已授权。执行 claude 命令，并按照所有步骤授权本地 claude

   ```bash
   claude
   ```

   注意：opencode 和 agent 默认使用免费的 Grok Code Fast 1 模型——因此这些工具无需授权。

7. 启动 Hive Mind Telegram 机器人：

   **使用 Links 符号（推荐）：**

   ```
   screen -R bot # 进入机器人的新 screen 会话

   hive-telegram-bot --configuration "
     TELEGRAM_BOT_TOKEN: '849...355:AAG...rgk_YZk...aPU'
     TELEGRAM_ALLOWED_CHATS:
       -1002975819706
       -1002861722681
     TELEGRAM_HIVE_OVERRIDES:
       --all-issues
       --once
       --skip-issues-with-prs
       --attach-logs
       --verbose
       --no-tool-check
     TELEGRAM_SOLVE_OVERRIDES:
       --attach-logs
       --verbose
       --no-tool-check
     TELEGRAM_BOT_VERBOSE: true
   "

   # 按 CTRL + A + D 从 screen 会话中分离
   ```

   **使用独立命令行选项：**

   ```
   screen -R bot # 进入机器人的新 screen 会话

   hive-telegram-bot --token 849...355:AAG...rgk_YZk...aPU --allowed-chats "(
     -1002975819706
     -1002861722681
   )" --hive-overrides "(
     --all-issues
     --once
     --skip-issues-with-prs
     --attach-logs
     --verbose
     --no-tool-check
   )" --solve-overrides "(
     --attach-logs
     --verbose
     --no-tool-check
   )" --verbose

   # 按 CTRL + A + D 从 screen 会话中分离
   ```

   注意：您可能需要在 https://t.me/BotFather 注册自己的机器人以获取机器人令牌。

## Codex 登录

1. 使用带有隧道的 SSH 连接到已安装 Hive Mind 的 VPS 实例

```bash
ssh -L 1455:localhost:1455 root@123.123.123.123
```

2. 启动 codex 登录 oAuth 服务器：

```bash
codex login
```

将启动 1455 端口上的 oAuth 回调服务器，并打印 oAuth 链接，请复制该链接。

3. 在您启动隧道的机器上使用浏览器，粘贴 `codex login` 命令中的链接并访问。重定向到 localhost:1455 后，您将看到登录成功页面，`codex login` 中也会显示 `Successfully logged in`。之后 `codex login` 命令将完成，您可以正常使用 `codex` 命令进行验证。在 `solve` 和 `hive` 命令中使用 `--tool codex` 也应该正常工作。
