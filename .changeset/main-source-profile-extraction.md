---
'@link-assistant/hive-mind': patch
---

Extract source-suite profile selection and execution into one builtins-only runner, keeping the release workflow below its existing warning threshold without changing test commands or integration gates. Include the existing source-size regression in the essential PR profile so this main-only failure is caught before merge.
