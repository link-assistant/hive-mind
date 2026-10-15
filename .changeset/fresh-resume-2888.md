---
'@link-assistant/hive-mind': patch
---

Kill recovery in a new Docker container can now resume Codex threads (issue #2888). solve writes Codex rollouts from its repository-scoped `CODEX_HOME` to the mounted `~/.codex/sessions` directory, so a recovery container can find them. For runs started before this change, recovery copies the thread's rollout out of the killed container. If the thread still cannot be found, recovery starts a new Codex session on the same branch and says so in the recovery notice, instead of launching `codex exec resume` that would fail at once with "no rollout found". solve also starts a new session, with a warning, when it is asked to resume a thread whose rollout is not in its scoped `CODEX_HOME`. A recovery session that solve refuses to start for lack of disk space (exit 75) no longer uses up a recovery attempt. Once enough space is free, it is relaunched under the same attempt number, at most 6 times per recovery chain.
