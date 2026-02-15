---
'@link-assistant/hive-mind': patch
---

Fix false positive error detection for step_finish with reason stop

When an agent encounters a timeout error during execution but successfully recovers and completes (indicated by `step_finish` with `reason: "stop"`), the error detection was incorrectly flagging this as a failure due to fallback pattern matching.

The `agentCompletedSuccessfully` flag was only being set for `session.idle` and `"exiting loop"` log messages (Issue #1276), but not for the more common `step_finish` event with `reason: "stop"`. This meant the fallback pattern matching would still trigger and detect error patterns in the full output, even when the agent had clearly completed successfully.

Fix: Add `step_finish` with `reason: "stop"` as a success marker in both stdout and stderr processing loops in `src/agent.lib.mjs`.
