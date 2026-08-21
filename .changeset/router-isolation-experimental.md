---
'@link-assistant/hive-mind': minor
---

Add the experimental `--use-router` option, which stops handing a Docker-isolated task the operator's real subscription. With the flag, `~/.claude`, `~/.claude.json`, `~/.codex` and `~/.agents` are mounted only into a reference-counted `hive-mind-router` sidecar on an internal Docker network; each task is joined to that network and given its own `la_sk_…` token, so every model request lands in that token's own redacted log. The sidecar runs while at least one task holds a lease and is stopped when the last one is released, with the Telegram bot reconciling leases against Docker so a killed bot cannot leave it running forever. At end of task the agent's session data is drained into the router's data volume for audit, and that volume is never removed by any code path. Routed tasks also get a read-only `pre-push` hook that refuses remote-ref deletions and history rewrites.

Nothing changes without the flag. Three limits are documented and printed before every routed run: `gh` traffic needs an HTTPS-terminated endpoint (`HIVE_MIND_ROUTER_GH_HOST`), `--model formal-ai` still reaches its own sidecar directly, and the push guard is bypassable with `git push --no-verify`, so branch protection remains the only unbypassable control. New docs: `docs/ROUTER.md`, `docs/COLLECTING-LOGS.md` and `examples/collect-logs.mjs`.
