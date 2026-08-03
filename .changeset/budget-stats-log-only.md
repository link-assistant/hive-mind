---
'@link-assistant/hive-mind': patch
---

Keep context/cost budget statistics out of the working session summary (issue #2132).

Cost estimation and token/context usage are now published only in the working
session log comment, and only when `--attach-logs` is enabled — previously every
session posted the identical blocks twice, and the summary could publish them even
with log attachment disabled. The per-session budget stats derivation used by the
top-level run, watch iterations and auto-restart-until-mergeable iterations is now
a single shared implementation.
