# Production task recovery

Keep the Telegram bot, host `solve` installation and Docker task image on a reviewed release. A package update on the host does not replace an already-running bot or a locally cached task image.

## Upgrade and verify

The October 2026 incident used host version 2.33.11 after the model reasoning fix had shipped in 2.33.13. Upgrade to a reviewed release containing that fix and the recovery changes in this PR.

1. Record `solve --version`, `hive-telegram-bot --version`, the configured task image and its digest. Check the published package version with `npm view @link-assistant/hive-mind version`.
2. For an npm installation, install the chosen version with `npm install -g @link-assistant/hive-mind@<version>`. Restart the bot through its existing service manager. Verify the service uses the updated executable, rather than another installation on its PATH.
3. Pull the chosen `konard/hive-mind` or `konard/hive-mind-dind` image tag. Update a pinned image reference explicitly. For Coolify, pull/rebuild the configured image and redeploy the application. Preserve the existing credential mounts and task settings.
4. Confirm the host startup banner and the next isolated task's startup banner both report the expected Hive Mind version. Record the task image digest alongside the host version.
5. Run a small task with the production tool/model/thinking settings. Codex reasoning is resolved against the CLI capability catalogue before launch; unsupported settings fail before allocating a task container.

## Authentication

Docker task launch probes Claude/Codex subscription access on the host before sidecars, image pulls or container creation. On an authentication rejection, a fresh CLI process gets one opportunity to refresh credentials, followed by another usage probe. Each probe is bounded to 15 seconds; the refresh process is bounded to 20 seconds. The refresh can make a small model request. Concurrent checks for the same tool and credential path share the probe.

An unrecovered rejection returns a host re-login instruction to the existing launch error/Telegram reply. Pending tasks for that tool wait until the credential file changes. Run `claude /login` or `codex login --device-auth` on the host that supplies the task mounts. A changed file allows the next task to probe again. Other tool queues continue to use their own checks. A Claude session that loses access while running also starts one fresh CLI retry before reporting the terminal failure. A successful refresh does not emit the terminal queue-stop marker.

Usage API outages and HTTP 429 responses do not establish invalid authentication. API-key, router and Formal AI tasks bypass the subscription usage probe; API-key validity is still checked by their normal provider execution. The pause is held in the bot process and is re-established by preflight after a restart. Existing `/hive` workers stop on a terminal access marker; restart `/hive` after re-login.

The shared-credential inode/atomic-replacement and refresh-lock problem is tracked separately in [#2296](https://github.com/link-assistant/hive-mind/issues/2296). This preflight/retry does not change credential mount semantics.

## Exhausted restart budgets and refusals

An exhausted auto-restart budget fails the overall run, leaves the PR draft, and posts one summary naming the remaining blocker and failing CI checks. The comment records the PR commit. Automatic `/hive --auto-continue` requeues defer that commit for six hours. Set `HIVE_MIND_AUTO_RESTART_COOLDOWN_HOURS` on the bot to change the interval (`0` disables it). New PR commits or new/edited issue, PR, inline or review feedback release the cooldown; session and log bookkeeping comments do not. Deferred issues stay eligible for later queue iterations. Manual `solve` invocations remain available.

The Codex cybersecurity refusal is terminal. The issue/PR report says the model refused and suggests `--tool claude` or rephrasing. A refusal does not enter a transient-error retry loop.

## Work preservation and stopped containers

Critical-error recovery snapshots eligible uncommitted work into `recovery/<task-branch>` using a separate Git index and pushes it. The PR branch, working tree and normal index remain available to the next session. Untracked binaries up to 5 MiB are preserved, including screenshots and fixtures under `docs/`, `tests/`, `fixtures/` and `experiments/`. An extension or NUL byte alone does not identify build output. Known build-output directories are excluded; oversized or unreadable files receive an explicit skip reason and prevent a complete-preservation receipt.

The completion monitor removes an authentication/refusal/restart-budget failure under `HIVE_MIND_KEEP_TASK_CONTAINER=on-failure` only when its system recovery receipt confirms uploaded logs and complete remote preservation. A pushed recovery commit preserves its parent history; a clean tree without a recovery commit must have its HEAD on the remote task branch. Failed uploads, failed pushes, unknown preservation, oversized binaries and unpushed commits retain the container. Incomplete remote preservation also disables workspace auto-cleanup so the retained container still contains the work. `always` retains it. Completion removal uses `docker rm` without force, which refuses a container that has resumed. Existing `none` policy remains available.

Enable `--attach-logs` to allow evidence-based cleanup. Standalone start-command lifecycle retention, TTL scanning and resume-image reclamation remain separate work in [#2629](https://github.com/link-assistant/hive-mind/issues/2629) and [#2630](https://github.com/link-assistant/hive-mind/issues/2630).

## Exit 137

Exit 137 alone does not prove an OOM kill. Use the existing cgroup `memory.events`/`oom_kill` diagnostics and Docker state in the completion report. Review the configured container memory limit and host headroom before increasing RAM or swap. This change does not alter production resource limits or the existing OOM recovery path. Keep an incomplete recovery container and investigate the reported failure before removing it.
