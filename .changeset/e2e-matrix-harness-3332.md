---
'@link-assistant/hive-mind': patch
---

The E2E Hello World matrix (issue #3332) now tests the Formal AI version Hive Mind ships (`FORMAL_AI_BOOTSTRAP_VERSION`, cross-checked against the Dockerfile pins) instead of the GitHub Releases `latest`. It records the shipped, GitHub release and crates.io versions in the job summary and the `e2e-matrix-metadata` artifact, and annotates a disagreement between releases and crates.io with a link to formal-ai#1203. Rows on the default `GITHUB_TOKEN` ask for the workflow under `ci/`, which that token can push, and the harness runs it with act. A rejected workflow push is reported as `harness: workflow push rejected (no workflows permission)`, together with the exact secret a maintainer must set. The summary reports the harness verdict apart from the model verdict, and a red Formal AI row links formal-ai#1209 and formal-ai#1154.
