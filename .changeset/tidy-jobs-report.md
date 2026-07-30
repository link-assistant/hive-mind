---
'@link-assistant/hive-mind': patch
---

Latch confirmed pull request merges so later internal cleanup errors cannot change a successful solve to exit code 1, and report any genuinely external post-merge runner failure as a split outcome.
