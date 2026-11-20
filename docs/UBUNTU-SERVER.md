# Installation on Ubuntu 24.04 Server (Deprecated) (languages: en • [zh](UBUNTU-SERVER.zh.md) • [hi](UBUNTU-SERVER.hi.md) • [ru](UBUNTU-SERVER.ru.md))

> ⚠️ **DEPRECATED:** This installation method is no longer recommended.
>
> **We now recommend using Docker for all installations**, both on developer machines and servers.
> Docker provides better isolation, easier management, and consistent environments.
>
> Please use the [Docker installation method](../README.md#using-docker) instead.
> For Kubernetes deployments, see the [Helm installation](../README.md#helm-installation-kubernetes-experimental).
> For detailed Docker usage, see [docs/DOCKER.md](./DOCKER.md).

---

The following instructions describe the legacy bare-metal installation on Ubuntu 24.04 server. This approach is kept for reference only.

> **Note:** As of issue #1639, the Docker image uses the full `ghcr.io/link-foundation/box`
> image, pinned to the current Box release, as the base image that provides all
> development tools. The standalone Hive Mind bare-metal install script was
> removed from this repository; the last version that pre-installed all Hive
> Mind tools on top of Ubuntu 24.04 is preserved for historical reference at:
> https://github.com/link-assistant/hive-mind/blob/4f027b32/scripts/ubuntu-24-server-install.sh
>
> The `ghcr.io/link-foundation/box` image is a universal base image and does not contain Hive
> Mind specific tooling by itself, so this legacy Hive Mind script is kept as
> the only remaining source for the bare-metal install path.

## Steps

1. Reset/install VPS/VDS server with fresh Ubuntu 24.04
2. Login to `root` user.
3. Run the archived Hive Mind bare-metal installer

   ```bash
   curl -fsSL -o- https://raw.githubusercontent.com/link-assistant/hive-mind/4f027b32/scripts/ubuntu-24-server-install.sh | bash
   ```

   **Note:** The installation does NOT run `gh auth login` automatically. This is intentional to support Docker builds without timeouts. Authentication is performed in the next steps.

4. Login to `box` user

   ```bash
   su - box
   ```

5. Sign in as the user that runs Hive Mind. Open the GitHub device page in your browser and enter the code shown in the terminal.

   ```bash
   hive-manager auth github
   ```

6. Sign in to Claude Code. Paste the browser's authorization code into the running command.

   ```bash
   hive-manager auth claude
   ```

   If the archived installation does not provide the manager, use the direct provider commands.

   ```bash
   env GH_BROWSER=true gh-setup-git-identity --web --skip-ssh-key
   claude auth login
   ```

7. Launch the Hive Mind telegram bot:

   **Using Links Notation (recommended):**

   ```
   screen -R bot # Enter new screen for bot

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

   # Press CTRL + A + D for detach from screen
   ```

   **Using individual command-line options:**

   ```
   screen -R bot # Enter new screen for bot

   read -rsp "Telegram bot token: " TELEGRAM_BOT_TOKEN
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

   # Press CTRL + A + D for detach from screen
   ```

   Note: You may need to register you own bot with https://t.me/BotFather to get the bot token.

## Codex sign-in

On the machine where you want to use Codex, run the manager command below. From another machine, connect with `hive-manager --host deploy@your-server auth codex`. Open the displayed device authorization URL and enter the code in your browser. Then check the login status.

```bash
hive-manager auth codex
hive-manager auth codex status
```

Without the manager, use `codex login --device-auth` and `codex login status` directly. For device authorization settings and browser callback alternatives, see the [Codex sign-in guide](deployment/hive-manager.md#headless-sign-in).

Codex stores its data in `~/.codex` on a regular server. The most important paths are:

- `~/.codex/auth.json`
- `~/.codex/config.toml`
- `~/.codex/sessions/`
