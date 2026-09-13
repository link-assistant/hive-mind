---
'@link-assistant/hive-mind': minor
---

Fix the ten Hive Mind-side defects behind the three failed 2026-09-13 `solve --model formal-ai` Hello World runs (issue #2247).

One task per tool ran against a fresh `konard/test-hello-world-*` repository, and each failed differently: 547 identical `mcp__playwright__browser_click` calls ending in `Prompt is too long` (claude), a `Main.scala` that could not compile reported as "Created and verified" and never committed (agent), and the operator's ChatGPT connector answering the issue fetch with JSON that became the final message (codex). Two of the three pull requests were converted to ready with an empty diff and then restarted five byte-identical times each. The Formal AI half of the analysis is link-assistant/formal-ai#1133.

- **The task image is refreshed before the container is created, and the session comment says what ran.** All three tasks printed `🚀 solve v2.22.0` 111 minutes after v2.28.1 was published: `latest` was pulled once and reused forever, and nothing published which version, image or backend served the run. `src/task-image-refresh.lib.mjs` pulls only *mutable* references (a pinned tag or `@sha256:` is still reused, per #1879) and resolves the digest; the launcher passes it into the task, and `src/session-runtime-provenance.lib.mjs` states solve version, tool, model, image digest and the Formal AI backend's version in the *AI Work Session Started* comment. A backend may now declare the Hive Mind version it requires in `/health`, and an older `solve` is refused rather than silently served.
- **A pull request with an empty diff stays a draft.** `ensurePullRequestIsReady('solution draft verified')` ran unconditionally; the conversion is now gated on a measured non-empty diff, and a session that produced nothing says so instead.
- **A restart that changes nothing stops the loop.** The final assistant message and `git status --porcelain` are hashed per session; a second identical pair ends the run with one *no progress between sessions* comment and leaves the remaining budget unused.
- **The Claude runner breaks out of a repeated failing tool call.** Three identical `(tool, input, is_error)` triples end the session with that reason, and playwright is no longer attached for `--model formal-ai`, which has no use for a browser.
- **`--tool agent` runs stop calling `opencode/big-pickle`.** `--no-summarize-session --no-generate-title` remove the 12 per-session `HTTP 400 MissingSessionID` requests the CLI made to its own default provider.
- **The formal-ai prompt states the commit/push contract**, as the claude and codex prompts already did.
- **A formal-ai codex task holds one credential and no MCP servers.** Only `auth.json` and a minimal `config.toml` are seeded, so the operator's `codex_apps` ChatGPT connector cannot answer a task's GitHub request under their identity.
- **The working session summary is bounded**: an oversized summary is folded into `<details>` with the rest left in the attached log.
- **`create-test-repo` only picks languages the task image ships.** `ghcr.io/link-foundation/box:2.10.2` has no Scala toolchain — and had none for 26 of the 40 languages in the old pool. `src/task-image-languages.lib.mjs` publishes the supported list, with a probe command per language and the removed ones recorded with their reason.
- **A failure comment names the cause, not the last symptom.** The Kotlin run was reported as `Prompt is too long`; it is now classified from the tool-call history as the same call repeated 547 times.
