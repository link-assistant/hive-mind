---
'@link-assistant/hive-mind': patch
---

Keep Telegram bot credentials out of process arguments by replacing inline configuration/token startup arguments before initialization. Support private LINO files via --configuration-file or HIVE_MIND_CONFIGURATION_FILE, load configuration before CLI defaults, and use Kubernetes Secret references in deployment examples.
