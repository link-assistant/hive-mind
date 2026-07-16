# Local protocol verification

Verification date: 2026-07-14 (UTC).

## Installed tools

```text
codex-cli 0.144.3
Claude Code 2.1.207
```

`claude --help` describes `--input-format stream-json` as “realtime streaming
input” and documents `--replay-user-messages` for acknowledging stdin user
messages when input and output both use stream-json.

`codex app-server --help` exposes stdio, WebSocket, and Unix-socket transports.
The local protocol schema was generated without starting a model turn:

```bash
codex app-server generate-json-schema --out /tmp/codex-app-schema
```

The generated `v2/TurnSteerParams.json` requires:

```json
{
  "required": ["expectedTurnId", "input", "threadId"]
}
```

Its description states that `expectedTurnId` is an active-turn precondition and
the request fails when it differs from the current turn. The generated
`TurnSteerResponse` requires one string field, `turnId`.

This was a schema-only verification. It made no authenticated model request,
changed no remote state, and incurred no model usage. The repository already
contains authenticated Claude stream experiments under
`experiments/issue-814-streaming-input/` and regression tests for the current
live-input capability matrix.
