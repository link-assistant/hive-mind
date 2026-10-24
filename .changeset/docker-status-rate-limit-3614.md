---
'@link-assistant/hive-mind': patch
---

The Telegram bot reuses each Docker or session status probe for 5 s by default, so each probe runs at most 12 times per minute. Before, it could run up to ~95 checks a minute, each starting new processes (#3614). With three real Docker tasks and idle chat, the combined status probes now run 4.3 times per task per minute (including the default CPU penalty sampler):

- One in-memory cache is shared by the session monitor, the queue's processing count, `/limits`, `/queue`, `/log`, `/terminal_watch` and the backend probes. Callers that arrive while a check runs wait for that check instead of starting their own. Starting or stopping a task clears that task's entry. Set the interval with `HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS` or `hive-telegram-bot --docker-status-min-interval-ms`. `0` turns off the reuse but keeps the waiting for a running check.
- `which $` no longer runs before every start-command call: the path is looked up once. `$ --status`, `$ --list`, `docker`, `screen`, `tmux` and `pgrep` run without a `sh -l -c` login shell.
- Docker liveness for all containers comes from one `docker ps`, screen liveness from one `screen -ls`, and the running-tool count from one `pgrep` for all tools.
- `checkTmuxSessionRunning()` no longer reports a missing tmux session as running.
- The session monitor, `/top` and the interactive-mode pollers start the next tick only after the previous one has finished, and sidecar maintenance skips a tick while one is still running. One slow session no longer delays the monitor's checks of the other sessions.
- Concurrent `/version` requests share one result for 30 s. Concurrent cold-cache `/limits` requests share GitHub, system and subscription probes while preserving their existing TTLs.
- New lint rules `no-login-shell-probe` and `no-overlapping-interval` block new `sh -l -c` status probes and new async `setInterval` callbacks on bot paths.
- `docs/case-studies/issue-3614` lists every polling mechanism in the bot.
- The images pin start-command 0.39.2. Its detached monitor checks each docker task every 5 s instead of every 1 s (link-foundation/start#238, reported from this issue), and its `$ --status` answers every docker probe with one `docker inspect`. `START_COMMAND_CGROUP_SAMPLE_INTERVAL_SECONDS` set where the bot runs changes that monitor's interval. Unreadable cgroup counters stop sampling, and transient failures back off up to 60 s (link-foundation/start#247).

The start-command sampler regression also runs against the published 0.39.2 npm package in the default test suite.

CI's dependency-freshness gate also required updates to `@dotenvx/dotenvx` 2.38.2, Bun 1.4.4, Formal AI 0.355.7, `@link-assistant/agent` 0.27.0, agent-commander 0.12.0, Sentry 11.9.0, command-stream 2.6.0, lino-arguments 0.4.0, lino-objects-codec 0.9.3, zizmor-action 0.8.0 and transitive dependencies.

The lino-arguments refresh preserves Hive's numeric `-c` concurrency option alongside the explicit `--configuration` option, while other commands keep `-c` for configuration.
