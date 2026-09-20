Follow-up to the requested idle lifecycle and auto-update behavior in [this review comment](https://github.com/link-assistant/hive-mind/pull/2147#issuecomment-5228459541).

I confirmed the current gaps:

- `docker-compose.yml` starts the Formal AI service permanently (`restart: unless-stopped`) and makes the Hive Mind container depend on its health. It is not task-scoped today.
- Docker-isolated tasks receive the sidecar URL, but the sidecar is outside the task daemon/network. The requested task-only internal network is not implemented.
- Formal AI memory is persisted in a named volume, but replacing the image currently has no machine-readable memory-schema preflight, explicit migration transaction, or rollback contract. `/health` proves the binary is alive and reports its version; it does not prove persisted-memory compatibility.
- Claude, Codex, Agent, Gemini, Qwen, Copilot, and OpenCode are installed at Hive Mind image-build time. There is no idle-only runtime refresh mechanism today.

The responsibility split is:

- **Hive Mind:** count live tasks, pull only while idle, compare image digests, start/stop the sidecar on demand, create the internal network, attach only Formal AI task containers before releasing their startup gate, keep the named memory volume, orchestrate backup/rollback, and refresh the agentic CLI runtime only while no task is active.
- **Formal AI:** define whether an old persisted-memory schema is readable by a candidate binary and provide a non-destructive, atomic, idempotent migration/preflight contract that an unattended orchestrator can trust.

Upstream reports:

- **Blocking:** [formal-ai#982](https://github.com/link-assistant/formal-ai/issues/982) — reproducible named-volume replacement case, current backup/pin workaround, proposed machine-readable preflight/transaction, and old-to-new/interruption/rollback acceptance tests.
- **Non-blocking:** [link-foundation/start#154](https://github.com/link-foundation/start/issues/154) — native Docker `--network`/`--network-alias` support. Hive Mind can safely work around this one with `docker network connect` while its existing task startup gate is closed.

Per issue #2146's explicit instruction to report missing Formal AI features as blockers and pause the pull request until they are resolved, PR #2147 remains **draft**. I am not enabling a health-check-only `latest` replacement path: it could appear successful while silently damaging memory or making rollback impossible. The general agentic-CLI updater remains part of the Hive Mind follow-up scope; no upstream Agent defect is required merely to install its latest published package while Hive Mind is idle.
