# Installation on Ubuntu 24.04 Server (Deprecated)

> ⚠️ **DEPRECATED:** This installation method is no longer recommended.
>
> **We now recommend using Docker for all installations**, both on developer machines and servers.
> Docker provides better isolation, easier management, and consistent environments.
>
> Please use the [Docker installation method](../README.md#using-docker) instead.
> For Kubernetes deployments, see the [Helm installation](../README.md#helm-installation-kubernetes).
> For detailed Docker usage, see [docs/DOCKER.md](./DOCKER.md).

---

The following instructions describe the legacy bare-metal installation on Ubuntu 24.04 server. This approach is kept for reference only.

## Steps

1. Reset/install VPS/VDS server with fresh Ubuntu 24.04
2. Login to `root` user.
3. Execute main installation script

   ```bash
   curl -fsSL -o- https://github.com/link-assistant/hive-mind/raw/refs/heads/main/scripts/ubuntu-24-server-install.sh | bash
   ```

   **Note:** The installation script will NOT run `gh auth login` automatically. This is intentional to support Docker builds without timeouts. Authentication is performed in the next steps.

4. Login to `hive` user

   ```bash
   su - hive
   ```

5. **IMPORTANT:** Authenticate with GitHub CLI AFTER installation is complete

   ```bash
   gh-setup-git-identity
   ```

   Note: Follow the prompts to authenticate with your GitHub account. This is required for the gh tool to work, and the system will perform all actions using this GitHub account. This step must be done AFTER the installation script completes to avoid build timeouts in Docker environments.

6. Claude Code CLI, OpenCode AI CLI, and @link-assistant/agent are preinstalled with the previous script. Now you need to make sure claude is authorized. Execute claude command, and follow all steps to authorize the local claude

   ```bash
   claude
   ```

   Note: Both opencode and agent come with free Grok Code Fast 1 model by default - so no authorization is required for these tools.

7. Launch the Hive Mind telegram bot:

   **Using Links Notation (recommended):**

   ```
   screen -R bot # Enter new screen for bot

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

   # Press CTRL + A + D for detach from screen
   ```

   **Using individual command-line options:**

   ```
   screen -R bot # Enter new screen for bot

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

   # Press CTRL + A + D for detach from screen
   ```

   Note: You may need to register you own bot with https://t.me/BotFather to get the bot token.

## Codex sign-in

1. Connect to your instance of VPS with Hive Mind installed, using SSH with tunnel opened

```bash
ssh -L 1455:localhost:1455 root@123.123.123.123
```

2. Start codex login oAuth server:

```bash
codex login
```

The oAuth callback server on 1455 port will be started, and the link to oAuth will be printed, copy the link.

3. Use your browser on machine where you started the tunnel from, paste there the link from `codex login` command, and go there using your browser. Once redirected to localhost:1455 you will see successful login page, and in `codex login` you will see `Successfully logged in`. After that `codex login` command will complete, and you can use `codex` command as usual to verify. It should also be working with `--tool codex` in `solve` and `hive` commands.
