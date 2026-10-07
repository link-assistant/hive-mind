---
'@link-assistant/hive-mind': patch
---

`fix --ci-cd` now recommends the C/C++ pipeline template (`link-foundation/cpp-ai-driven-development-pipeline-template`) for C, C++ and CMake repositories, and `docs/CI-CD-BEST-PRACTICES.md` and its translations list it. A GitHub integration test fails when a new link-foundation pipeline template is published but not yet listed. Also refresh `lino-i18n` to 0.3.0 and `lino-objects-codec` to 0.9.0 for the dependency freshness gate.
