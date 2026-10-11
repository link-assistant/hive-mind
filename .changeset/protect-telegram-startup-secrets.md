---
'@link-assistant/hive-mind': patch
---

Protect Telegram bot credentials passed on the command line without forbidding it: `--token`/`-t` and secret-bearing `--configuration`/`-c` values now print a warning recommending a private `.lenv` file (the default, loaded from the working directory) or a Links Notation file at a custom path via `--configuration-file`/`HIVE_MIND_CONFIGURATION_FILE`, and the bot re-launches itself in place without those arguments when the runtime supports `process.execve` (otherwise it continues with a warning). Configuration files are loaded before CLI defaults, every hive-telegram-bot option now has an environment variable (adding `TELEGRAM_DRY_RUN`) so it can be set from `.lenv`, `.env`, a custom configuration file, or arguments, and deployment examples use Kubernetes Secret references.
