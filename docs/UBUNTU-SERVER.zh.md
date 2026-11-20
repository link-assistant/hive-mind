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
> Docker 镜像现在使用 `ghcr.io/link-foundation/box`（固定到特定版本）作为基础镜像，提供所有开发工具。
> 作为历史参考，在 Ubuntu 24.04 之上预装完整 Hive Mind 工具链的脚本最后一个版本保留在：
> https://github.com/link-assistant/hive-mind/blob/4f027b32/scripts/ubuntu-24-server-install.sh
>
> `ghcr.io/link-foundation/box` 镜像是通用基础镜像，本身不包含 Hive Mind 专用工具，因此这个旧的 Hive Mind 脚本仍然作为裸机安装路径的唯一保留来源。

## 步骤

1. 使用全新的 Ubuntu 24.04 重置/安装 VPS/VDS 服务器
2. 登录 `root` 用户。
3. 运行存档的 Hive Mind 裸机安装脚本

   ```bash
   curl -fsSL -o- https://raw.githubusercontent.com/link-assistant/hive-mind/4f027b32/scripts/ubuntu-24-server-install.sh | bash
   ```

   **注意**：安装不会自动运行 `gh auth login`。这是为了支持无超时的 Docker 构建而有意为之。身份验证将在后续步骤中执行。

4. 登录 `box` 用户

   ```bash
   su - box
   ```

5. 以运行 Hive Mind 的用户身份登录 GitHub。在浏览器中打开 GitHub 设备验证页面，然后输入终端显示的代码。

   ```bash
   hive-manager auth github
   ```

6. 登录 Claude Code。将浏览器显示的授权码粘贴到仍在运行的命令中。

   ```bash
   hive-manager auth claude
   ```

   如果旧安装脚本没有提供管理器，请直接运行服务商命令。

   ```bash
   env GH_BROWSER=true gh-setup-git-identity --web --skip-ssh-key
   claude auth login
   ```

7. 启动 Hive Mind Telegram 机器人：

   **使用 Links 符号（推荐）：**

   ```
   screen -R bot # 进入机器人的新 screen 会话

   umask 077
   cat > bot.lenv <<'LENV'
     TELEGRAM_BOT_TOKEN: YOUR_TELEGRAM_BOT_TOKEN
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
   LENV
   chmod 600 bot.lenv
   hive-telegram-bot --configuration-file bot.lenv

   # 按 CTRL + A + D 从 screen 会话中分离
   ```

   **使用独立命令行选项：**

   ```
   screen -R bot # 进入机器人的新 screen 会话

   read -rsp "Telegram 机器人令牌：" TELEGRAM_BOT_TOKEN
   echo
   export TELEGRAM_BOT_TOKEN
   hive-telegram-bot --allowed-chats "(
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

在要使用 Codex 的机器上运行下面的管理器命令。也可以从另一台机器运行 `hive-manager --host deploy@your-server auth codex`。打开显示的设备授权链接，在浏览器中输入代码，然后检查登录状态。

```bash
hive-manager auth codex
hive-manager auth codex status
```

如果没有管理器，请直接运行 `codex login --device-auth` 和 `codex login status`。参阅 [Codex 登录指南](deployment/hive-manager.md#headless-sign-in)。
