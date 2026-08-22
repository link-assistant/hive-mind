# Redacted observations for issue #1851

The source issue contained real process tables, start-command task metadata,
and command lines with credentials. This file preserves only the facts needed to
understand the bug and verify the fix.

## Observed process shape

- A high-CPU AI-agent process was visible in `top -c`.
- The agent command line referenced an issue-solving prompt and a temporary
  worktree under `/tmp/gh-issue-solver-<timestamp>`.
- At least one stuck agent had `PPID=1`, which indicates the original parent
  exited and the agent was reparented.
- The corresponding start-command task had already reached a terminal state.
- The useful linkage signals were:
  - process command name (`claude` or `codex`),
  - `/proc/<pid>/cwd`,
  - `/proc/<pid>/cmdline`,
  - start-command log path under `/tmp/start-command/logs/isolation/screen/`,
  - screen session name or `STY` when present,
  - `$ --status <session-id>` status and process IDs when available.

## Redacted representative records

```text
sessionId: 578ec383-9ef3-43af-b8f5-f0f91f9366bf
taskUrl: https://github.com/link-assistant/hive-mind/issues/1851
workspace: /tmp/gh-issue-solver-1780580701084
status: executed
processIds.wrapperPid: 88916

pid: 94445
ppid: 1
commandName: claude
cwd: /tmp/gh-issue-solver-1780580701084
cmdline: claude --output-format stream-json --append-system-prompt "[REDACTED PROMPT]"
expected: linked to the session above and marked orphaned
```

```text
sessionId: 8accdfd7-d36c-446e-8637-8574f215eda0
taskUrl: https://github.com/link-assistant/hive-mind/issues/1851
workspace: /tmp/gh-issue-solver-1780602790979
status: executing
live: true

pid: 6536
commandName: codex
cwd: /tmp/gh-issue-solver-1780602790979
screenSessionName: 8accdfd7-d36c-446e-8637-8574f215eda0
expected: linked to the session above and not marked orphaned
```

## Security note

Committed diagnostics must never include raw bot tokens, GitHub tokens,
Authorization headers, or full production prompt bodies. The reproducing test
therefore asserts that formatted process reports redact representative token
shapes before printing command lines.
