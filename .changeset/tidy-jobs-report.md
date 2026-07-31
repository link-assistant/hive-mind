---
'@link-assistant/hive-mind': patch
---

Stop reporting successful docker work sessions as failed. start-command can fabricate a detached-docker exit code from any `Exit Code: N` text the command itself printed (link-foundation/start#150), so the session monitor now trusts its own anchored log footer over `$ --status` and defers an uncorroborated docker failure for up to 60 seconds until the real footer is written.
