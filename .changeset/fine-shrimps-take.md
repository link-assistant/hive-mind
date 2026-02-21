---
'@link-assistant/hive-mind': patch
---

Make `--auto-resume-on-limit-reset` enabled by default to improve user experience when hitting API rate limits. Previously defaulted to `false`, now defaults to `true` for both `solve` and `hive` commands. Users can explicitly disable with `--no-auto-resume-on-limit-reset` if needed.
