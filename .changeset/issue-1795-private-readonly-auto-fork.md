---
'@link-assistant/hive-mind': patch
---

Fix `--auto-fork` failing on private repositories with read-only access when forking is allowed. `handleAutoForkOption` now probes the `allow_forking` repository attribute before bailing out: when it is `true`, fork mode is enabled (the same behaviour already used for public repos without write access); when it is explicitly `false`, the existing fatal exit fires with a clearer message; when it cannot be determined, we fall through with a verbose warning so `gh repo fork` can produce a precise downstream error. Resolves #1795.
