---
'@link-assistant/hive-mind': minor
---

Make Formal AI the only model a Formal AI task can reach, and run it on demand. Formal AI Agent flags stay separate argv values, a Formal AI task refuses to start on an Agent CLI older than 0.25.8 (earlier releases answer with their default model when they cannot parse `--model`), the supported Formal AI runtime is pinned and enforced, Agent provider drift fails closed, and structured Formal AI output is preserved in GitHub comments.

Formal AI now runs as an on-demand sidecar: it starts for the first Formal AI task, is reachable only over an internal Docker network, stops after the last lease is released, and keeps its memory volume across restarts. While idle, the sidecar image is refreshed through the Formal AI persisted-memory upgrade contract (preflight, backup, receipt, health check, rollback), and the installed agentic CLIs are refreshed too.
