---
'@link-assistant/hive-mind': patch
---

fix: filter unrelated branch runs in CI consensus check (#1573)

- Skip repo-wide active runs on unrelated branches when PR's own CI is fully passing
- Prevent indefinite consensus DISAGREE caused by long-running CI on other branches
- Add branch-aware filtering with verbose logging of skipped runs
