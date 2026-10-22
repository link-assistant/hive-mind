---
'@link-assistant/hive-mind': patch
---

The Telegram bot checks each container or session at most once every 5 s, so at most 12 checks per minute per task. Before, it could run up to ~95 checks a minute, each starting new processes (#3614):

- One in-memory cache is shared by the session monitor, the queue's processing count, `/limits`, `/queue`, `/log`, `/terminal_watch` and the backend probes. Callers that arrive while a check runs wait for that check instead of starting their own. Starting or stopping a task clears that task's entry. Set the interval with `HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS` or `hive-telegram-bot --docker-status-min-interval-ms`. `0` turns off the reuse but keeps the waiting for a running check.
- `which $` no longer runs before every start-command call: the path is looked up once. `$ --status`, `$ --list`, `docker`, `screen`, `tmux` and `pgrep` run without a `sh -l -c` login shell.
- Docker liveness for all containers comes from one `docker ps`, screen liveness from one `screen -ls`, and the running-tool count from one `pgrep` for all tools.
- `checkTmuxSessionRunning()` no longer reports a missing tmux session as running.
- The session monitor, `/top` and the interactive-mode pollers start the next tick only after the previous one has finished, and sidecar maintenance skips a tick while one is still running. One slow session no longer delays the monitor's checks of the other sessions.
- Concurrent `/version` requests share one result for 30 s.
- New lint rules `no-login-shell-probe` and `no-overlapping-interval` block new `sh -l -c` status probes and new async `setInterval` callbacks on bot paths.
- `docs/case-studies/issue-3614` lists every polling mechanism in the bot.
- The images pin start-command 0.39.0. Its detached monitor checks each docker task every 5 s instead of every 1 s (link-foundation/start#238, reported from this issue), and its `$ --status` answers every docker probe with one `docker inspect`. `START_COMMAND_CGROUP_SAMPLE_INTERVAL_SECONDS` set where the bot runs changes that monitor's interval.

Also brings the `@dotenvx/dotenvx` use-m pin up to 2.38.2, which the CI dependency-freshness gate reported as stale.
