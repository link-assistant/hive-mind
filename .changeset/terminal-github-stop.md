---
"@link-assistant/hive-mind": patch
---

Fail fast when watched GitHub repositories, issues, pull requests, or branches are deleted, closed, or no longer accessible instead of retrying them as unknown CI states.

Also fall back to a pinned working `use-m` bootstrap when the upstream latest unpkg entry is missing, so local and CI test startup remains stable.
