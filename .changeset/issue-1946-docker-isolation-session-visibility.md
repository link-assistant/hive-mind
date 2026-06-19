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
(`/solve`, `/hive`, `/task`).

The image-preparation log gap and host-image re-download were reported upstream,
fixed there, and are now pinned in this repo's images: `Dockerfile` /
`Dockerfile.dind` bump `start-command` `0.29.1` → `0.29.2` (link-foundation/start#138
— the `docker pull`/dind-boot phase is now recorded in the `$` session log), and
`Dockerfile.dind` bumps its base from `konard/box-dind:2.3.2` → `2.3.5`
(link-foundation/box#106 — the dind entrypoint now verifies host-image passthrough
actually seeded the nested daemon instead of silently re-downloading ~30 GB). A
deep case study is in `docs/case-studies/issue-1946/`.
