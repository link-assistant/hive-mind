# Collecting logs (languages: en • [zh](COLLECTING-LOGS.zh.md) • [hi](COLLECTING-LOGS.hi.md) • [ru](COLLECTING-LOGS.ru.md))

Hive Mind writes evidence in several places, and no single one of them tells the whole story of a run. When you are debugging a failure — or auditing what an autonomous agent did — you want all of them. This page is the complete list, and the script that walks it.

```bash
node examples/collect-logs.mjs --list                  # show every location, copy nothing
node examples/collect-logs.mjs --out ./audit           # gather them into ./audit
node examples/collect-logs.mjs --out ./audit --session <uuid>   # plus that session's console log
```

The script writes an `INDEX.md` next to what it collected, recording what was included, what was skipped, and what each location holds. The list it walks is `describeSystemLogLocations()` in `src/router-logs.lib.mjs` — the same list this page documents, kept in code so the two cannot drift apart.

## The locations

| Location            | Where                                                                     | What it holds                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run logs**        | Working directory, or `--log-dir` / `HIVE_MIND_LOG_DIR`                   | One `solve-*.log` / `hive-*.log` per run, renamed to `<sessionId>.log` once the AI tool reports its session id. The narrative of a single run.                    |
| **Bot logs**        | `~/.hive-mind/logs` (`HIVE_MIND_LOG_DIR`)                                 | Rotated `telegram-bot.log` plus timestamped backups: every command, launch and lifecycle event the bot handled.                                                   |
| **Bot state**       | `~/.hive-mind/state` (`HIVE_MIND_STATE_DIR`)                              | Tracked sessions and sidecar state, including `router-sidecar.json` — which task held which token, and when. **Contains the router signing secret; mode `0600`.** |
| **Session console** | `/tmp/start-command/logs/isolation/<backend>/<uuid>.log`                  | Console output of an isolated session. This is what the Telegram `/log <uuid>` command serves.                                                                    |
| **Container logs**  | `docker logs <sessionId>`                                                 | Docker's own capture of the task container's stdout/stderr, available until the container is removed.                                                             |
| **Router requests** | `hive-mind-router-data:/data/router/requests/<token-hash>/requests.jsonl` | One redacted JSONL request log per issued token — that is, per task. Retained after the token is revoked.                                                         |
| **Router audit**    | `hive-mind-router-data:/data/router/audit.jsonl`                          | Token issuance, revocation and rotation events.                                                                                                                   |
| **Task sessions**   | `hive-mind-router-data:/data/router/task-sessions/<sessionId>/`           | Agent session data drained out of each routed task before its container was reclaimed: the transcripts of what the agent actually did.                            |

The last three exist only when [`--use-router`](./ROUTER.md) is in use.

## The state directory is not evidence you can share

`~/.hive-mind/state` holds the secret that signs router tokens. Anyone with it can mint tokens against the subscription. `examples/collect-logs.mjs` therefore **never copies it** — it prints the path so you know where it is, and leaves it where it is. If you need something from it for an investigation, extract the specific fact rather than the directory.

Everything else on the list can be shared, subject to the usual review: Hive Mind [sanitizes recognized credentials](./CREDENTIAL-SANITIZATION.md) on its own output paths, and the router redacts request bodies, but neither is a substitute for reading an archive before you attach it to a public issue.

## Reading router logs when no router is running

The router's data lives in the named volume `hive-mind-router-data`, not in the container. The volume outlives every container that writes to it, and Hive Mind never removes it — but the sidecar itself is stopped as soon as no task needs it, so at the moment you want the logs there is usually nothing running to ask.

Both cases are handled:

```bash
# When the sidecar is up — copy straight out of it:
docker cp hive-mind-router:/data/router/. ./audit/router

# When it is not — mount the volume into a throwaway container:
docker run --rm --entrypoint cp \
  -v hive-mind-router-data:/data/router:ro \
  -v "$PWD/audit/router:/export" \
  --user "$(id -u):$(id -g)" \
  ghcr.io/link-assistant/router:latest -a /data/router/. /export/
```

`collectRouterLogs()` in `src/router-logs.lib.mjs` tries the first and falls back to the second. Note the two safety details in the fallback, which are worth keeping if you run the command by hand: the volume is mounted **read-only**, so collecting evidence can never damage it, and `--user` makes the exported files readable without root.

## Finding the run you want

- **From Telegram:** `/log <uuid>` serves the session console log directly; `/status` lists live sessions and their uuids.
- **From a session id:** run logs are named `<sessionId>.log` after the tool reports its id, so `grep -rl <sessionId>` across your log directory finds every file about that run.
- **From a routed task:** `router-sidecar.json` in the state directory maps session ids to token ids, and the token id is the directory name under `requests/`.

## Retention

Nothing here is rotated away automatically except the bot log, which keeps timestamped backups. Run logs, session console logs and the router volume grow until you remove them. Container logs disappear with the container.

For an audit trail you intend to keep, copy the router volume somewhere durable on a schedule — it is the only location that is designed to be complete.

## See also

- [Router isolation](./ROUTER.md) — what produces the router logs, and why per-task tokens matter
- [Credential sanitization](./CREDENTIAL-SANITIZATION.md) — what is masked before anything is written or published
- [Docker support](./DOCKER.md) — container isolation and its own diagnostics
