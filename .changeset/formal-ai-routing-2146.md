---
'@link-assistant/hive-mind': patch
---

Keep Formal AI Agent flags as separate argv values, refuse to start a Formal AI task on an Agent CLI older than 0.25.8 (earlier releases answer with their default model when they cannot parse `--model`), pin and enforce the supported Formal AI runtime, fail closed on Agent provider drift, and preserve structured Formal AI output in GitHub comments.
