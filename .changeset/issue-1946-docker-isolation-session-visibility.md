---
'@link-assistant/hive-mind': patch
---

Surface the docker-isolation session id + isolation backend immediately when the
Telegram bot launches a task, instead of only after the (potentially hour-long)
image pull / container startup finishes (#1946). `formatStartingWorkSessionMessage`
now renders the `Session:` and `🔒 Isolation:` lines on the `🔄 Starting...`
message, and `buildExecuteAndUpdateMessage` tracks the session up front (before
awaiting the launch) so the run is addressable by `/watch`, `/log` and `/status`
during the whole startup window. A new `untrackSession` helper removes the
optimistically-tracked session if the launch fails, so a phantom session is never
monitored or resumed. Fix applies to every caller of the shared execution path
(`/solve`, `/hive`, `/task`). The image-preparation log gap and host-image
re-download are reported upstream (link-foundation/start#138,
link-foundation/box#106) with a deep case study in
`docs/case-studies/issue-1946/`.
