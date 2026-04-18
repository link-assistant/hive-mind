---
"@link-assistant/hive-mind": minor
---

Add experimental bidirectional interactive mode (issue #817). Introduces three composable opt-in flags for `solve` (auto-forwarded to `hive`): `--accept-incomming-comments-as-input` (feed new PR/issue comments into Claude as stream-json input, excluding solve's own system comments), `--exclude-all-own-incomming-comments-from-input` (also skip comments authored by the same GitHub user that solve runs as), and `--bidirectional-interactive-mode` (composite convenience flag that enables `--interactive-mode` plus the two flags above). All flags default off and only take effect with `--tool claude`.
