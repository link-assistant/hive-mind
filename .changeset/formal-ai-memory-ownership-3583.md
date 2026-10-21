---
'@link-assistant/hive-mind': patch
---

Formal AI sidecar: check on every start that `box` can write the `hive-mind-formal-ai-memory` volume and `chown -R` it (as root) only when it cannot, logging `[formal-ai] memory volume was owned by <uid:gid>; fixed`; turn a `logging_failure` in the sidecar's first stdout lines into a warning in the bot log and the solve log; and save `docker logs --timestamps` to a rotated `formal-ai-sidecar-<start>.log` in the bot log directory before every `docker rm` of the sidecar (`HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP`, default 50) (#3583).
