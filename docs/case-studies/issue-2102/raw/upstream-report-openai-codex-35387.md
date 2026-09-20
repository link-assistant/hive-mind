### What version of Codex CLI is running?

`codex-cli 0.145.0`

### What subscription do you have?

ChatGPT (the affected runs authenticated with `auth_mode="Chatgpt"`; plan tier not recorded in the telemetry we kept)

### Which model were you using?

`gpt-5.6-sol`, `originator=codex_exec`, reasoning effort `none`

### What platform is your computer?

`Linux 6.8.0-136-generic x86_64 x86_64` (Docker container)

### Codex doctor report

```json
not available for the affected run — it happened in an ephemeral CI container two days before this report. `codex --version` there was 0.145.0 and the telemetry lines below carry `app.version=0.145.0`.
```

### What issue are you seeing?

Under `codex exec`, `request_plugin_install` can never install a plugin. There are two independent barriers, and only the first one produces a message — a message that misdescribes the cause, sending the model (and the human reading the log) after a nonexistent id problem.

**Barrier 1 — the id is matched by exact string equality against a server-supplied list.** Our automation runs `codex exec` in a repository whose `AGENTS.md` mandates a plugin. The model correctly tried to install it and got:

```
INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=request_plugin_install
  call_id=call_ccuteZ4s1AdV1wKVgJdt0Fk5
  arguments={"plugin_id":"superpowers@openai-curated-remote","suggest_reason":"…"}
  duration_ms=0 success=false
  output=plugin_id must match one of the entries in the <recommended_plugins> list
  app.version=0.145.0 auth_mode="Chatgpt" originator=codex_exec model=gpt-5.6-sol

ERROR codex_core::tools::router: error=plugin_id must match one of the entries in the <recommended_plugins> list
```

The id was not malformed. `codex-rs/core/src/tools/handlers/request_plugin_install.rs:150-179` compares with `tool.id() == requested_tool_id` — plain equality against `<recommended_plugins>`, which is populated from `GET {chatgpt_base_url}/ps/plugins/suggested?scope=GLOBAL` (`core-plugins/src/remote.rs:855-867`) and capped at 50 entries (`core/src/context/recommended_plugins_instructions.rs:6`). No local config key can add an entry, so a repository cannot make its mandatory plugin installable this way, and the message's implication ("use one of the right ids") has no achievable fix.

**Barrier 2 — and this is the part that makes it unfixable from the caller's side — even a matching id only asks.** `request_plugin_install.rs:213-237` emits an MCP elicitation and installs only `if user_confirmed`, i.e. only on `ElicitationAction::Accept`. But `exec/src/lib.rs:1661-1666` auto-cancels every elicitation:

```rust
ServerRequest::McpServerElicitationRequest { request_id, .. } => {
    // Exec auto-cancels elicitation instead of surfacing it
    // interactively. Preserve that behavior for attached subagent
    // threads too so we do not turn a cancel into a decline/error.
    match canceled_mcp_server_elicitation_response() {
```

So under `codex exec`, `user_confirmed` is always `false` and `completed` is always `false`. The tool is advertised to the model in a mode where it cannot succeed under any input.

Line-numbered excerpts of all of the above, taken from tag `rust-v0.145.0` (→ `25af12f7e61572b0bc18ddb1008be543b91519b0`), are collected here: https://github.com/link-assistant/hive-mind/blob/main/docs/case-studies/issue-2102/raw/upstream-codex-0.145.0-verification.log

**Cost of the misleading message.** Two automated sessions terminated with a refusal instead of the requested work, exit code 0 and `turn.completed=1`, so every downstream health check reported success. The model quoted the rejection and stopped, having been told it had used a wrong id. Our tracking issue, with the full transcripts and a millisecond-level reconstruction, is link-assistant/hive-mind#2102.

### What steps can reproduce the bug?

```bash
mkdir codex-plugin-exec-repro && cd codex-plugin-exec-repro && git init -q
cat > AGENTS.md <<'MD'
# Repository rules
The Superpowers plugin is mandatory. Install `superpowers@openai-curated-remote`
and invoke `superpowers:using-superpowers` before doing any work.
No manual workflow fallback is authorized.
MD

# Any ChatGPT-authenticated Codex 0.145.0; no plugins installed in CODEX_HOME.
codex exec --json --model gpt-5.6-sol \
  'Follow AGENTS.md exactly: install the required plugin, then print OK.'
```

Observed: a `request_plugin_install` call whose result is `success=false output=plugin_id must match one of the entries in the <recommended_plugins> list`, then a turn that completes without doing the work.

Substitute any plugin id you like — including one that *is* in your account's `<recommended_plugins>` list. In that case barrier 1 passes and barrier 2 fires instead: the elicitation is auto-cancelled, `completed` is `false`, and no install happens. Thread ids from our two occurrences: `019f8ee7-ba09-7482-8087-b93f7bb7940f` and `019f8f1e-168f-77d1-b70f-c0030dab63f7`.

### What is the expected behavior?

Either of these would resolve it; the first is a docs/UX fix, the second a feature:

1. **Do not advertise an install path that cannot complete.** When `request_plugin_install` runs in a mode that auto-cancels elicitations, fail fast with a message that names the real constraint — e.g. *"plugin installation requires an interactive session; install it beforehand with `codex plugin add <name>@openai-curated`"* — instead of `plugin_id must match one of the entries in the <recommended_plugins> list`. Today the message describes a problem the caller does not have and hides the one it does.
2. **Offer a non-interactive install path for headless runs**, e.g. a flag like `codex exec --allow-plugin-install <id>` (or honoring an existing approval-policy setting) that supplies `ElicitationAction::Accept` for plugin-install elicitations only.

A smaller, strictly-additive improvement, independent of both: make the rejection message state the ids that *were* acceptable (or that the list was empty), which would have told us in one line that the list is account-scoped and server-driven.

### Additional information

**Workaround, for anyone hitting this from CI.** Do not let the model install anything. Provision a scoped `CODEX_HOME` before `codex exec`:

```bash
export CODEX_HOME="$PWD/.codex-home"        # not under /tmp: Codex refuses to create helper binaries there
codex plugin add superpowers@openai-curated  # note: the *local* marketplace name
printf '[features]\nremote_plugin = false\n' >> "$CODEX_HOME/config.toml"
codex exec --json …
```

Two details that cost us time and may be worth documenting:

- **The marketplace name differs between the two surfaces.** `codex plugin add` installs from `openai-curated` (`core-plugins/src/lib.rs:26`), while every id in `<recommended_plugins>` is synthesized under `openai-curated-remote` (`core-plugins/src/remote.rs:69`, ids built at `remote.rs:888-891`). A repository that copies an id out of a `plugin://…` mention or out of the recommendation list gets the `-remote` spelling, and `codex plugin add superpowers@openai-curated-remote` then fails with `plugin superpowers was not found in marketplace openai-curated-remote`. Callers must rewrite the suffix. It would help if `plugin add` accepted the remote spelling as an alias, or said so in the error.
- **`features.remote_plugin = false` is needed to keep the locally added plugin visible**, otherwise the authenticated remote catalog merge drops it from the session.

**Related, but not a fix for this.** #31694 ("Allow plugin installs for backend dependency IDs", open, unmerged) widens the allowlist and so addresses barrier 1 only; barrier 2 would still cancel the install under `exec`. #33269 asks for discovery/recommendation, which is upstream of this problem. I searched `request_plugin_install` and `recommended_plugins` in this repo before filing and found no existing report of the headless case; if I missed one, happy to have this closed as a duplicate.
