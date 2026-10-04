---
'@link-assistant/hive-mind': patch
---

Stop presenting an earlier container OOM event as the cause of a failure (#2498). In the reported run, a child process (`rustc`) was OOM-killed and the session kept working. It later stopped for an unrelated reason, an expired Claude login. The pull-request notice is now titled "ℹ️ Work session stopped on its own — the earlier container OOM event did not cause it" and leads with the real stop line from the log; the old title was "⚠️ Container OOM event during a failed work session". The Telegram and PR diagnostics now label the OOM event "Event … (not the cause of this stop)" instead of "Cause". start-command's `memoryExhausted` / `exitReason: memory-exhaustion (cgroup-oom-killer)` derived only from Docker's sticky `State.OOMKilled` flag is no longer shown as separate evidence of memory exhaustion (reported upstream as link-foundation/start#180).
