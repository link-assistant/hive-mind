---
'@link-assistant/hive-mind': patch
---

Run Formal AI as an on-demand sidecar: start it for the first Formal AI task, reach it only over an internal Docker network, stop it after the last lease is released, and keep its memory volume across restarts. While idle, refresh the sidecar image through the Formal AI persisted-memory upgrade contract (preflight, backup, receipt, health check, rollback) and refresh the installed agentic CLIs.
