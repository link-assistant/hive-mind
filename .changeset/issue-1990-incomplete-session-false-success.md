---
"@link-assistant/hive-mind": patch
---

Fix exit-0-but-incomplete runs being reported as success under docker isolation (#1990). A `solve` run whose AI tool exited 0 while its session was cut off mid-run (e.g. the container ran out of disk) is now registered as a failure instead of a false success: codex requires its paired `turn.started`/`turn.completed` lifecycle, and gemini and qwen now require their terminal `result` event (claude already gated on it). A flagged failure preserves the AI session for a context-preserving retry and returns a non-zero exit so the docker container filesystem is kept for inspection. Disk-exhaustion strings are surfaced only as diagnostics, never as an independent failure gate, to avoid the #1955 echo false positive.

This also refreshes dependencies and picks up the upstream half of the #1990 fix. The
`start-command` pin in `Dockerfile`/`Dockerfile.dind` is bumped `0.30.1 → 0.30.2`,
which delivers [link-foundation/start#144](https://github.com/link-foundation/start/issues/144):
detached/isolated docker runs now surface the container's `OOMKilled` status and
preserve an abnormally-terminated container's filesystem for inspection instead of
auto-removing it. npm dependencies and devDependencies are updated to their latest
compatible versions (notably ESLint 9 → 10, which enables the `no-useless-assignment`
and `preserve-caught-error` recommended rules — all newly-flagged sites were fixed).
`jscpd` is intentionally held at `^4.0.5` because its 5.x line changes the
duplication baseline (it analyzes a wider file set, reporting 12.2% vs 10.7% on the
same tree) and would otherwise force weakening the duplication gate; this is a tooling
behavior change, not new duplication.
