---
'@link-assistant/hive-mind': patch
---

Make `/claude`, `/codex` and `/agent` with `--model formal-ai` reliable end to end:

- The Telegram bot keeps answering every chat while a command prepares its task (for example while a Formal AI image is pulled). Slow command work runs outside the update loop, logs are written asynchronously, `gh` calls have a timeout (`HIVE_MIND_GITHUB_EXEC_TIMEOUT_MS`), and lint rules keep blocking calls out of the bot process.
- A run that changed nothing finishes with ⚠️ "Finished without changes" and exit code 5 instead of 🎉, keeps a draft PR in draft, and reports a session that looped on one command. An echoed tool output is no longer posted as the working-session summary.
- Telegram alias session recovery executes the real solve command, keeps resume hints, and reports, cleans up and retries snapshot recoveries that fail to start.
- Docker sessions are only reported as finished after their container was observed (or the launch failed), and an unknown exit code is shown as "status unknown" instead of success.
- Formal AI images are resolved local-first, an accepted fallback image is reused instead of re-pulled, and sidecar leases survive while their session is alive.
- Codex runs against Formal AI keep a pinned `CODEX_HOME` and config across restarts and classify Formal AI failures.
- Recoverable agent tool errors no longer abort the run.
- The DinD image clears stale `dockerd`/`containerd` pid files before starting.
- Formal AI draft runs report their checks on the draft head, keep tool state between iterations, and can be called from other repositories.
- Pinned versions: `@link-assistant/agent` 0.26.15, `start-command` 0.37.8, `formal-ai` 0.353.2, `@dotenvx/dotenvx` 2.35.0.
