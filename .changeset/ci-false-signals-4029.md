---
'@link-assistant/hive-mind': patch
---

Fix the red `Checks and release` on main: the capability lifecycle gate now accepts the typed refusal of an unpinned npm-latest Codex (0.167.0 ships different stock skills than the pinned 0.164.0) and restores the pinned stock runtime before the next phases; image-gate helpers mounted into the container now trigger the Docker checks; azure/setup-helm v5.1.0 and lino-objects-codec 0.9.6 keep the dependency freshness gate green (#4029).
