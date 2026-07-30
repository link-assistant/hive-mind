---
'@link-assistant/hive-mind': patch
---

Stop reporting an empty `--model formal-ai` run as a success. Formal AI sessions are now attributed to Link.Assistant at $0.00, token usage is parsed for all six tools, the two duplicate auto-restart loops are one N/M budget that fails visibly when it is exhausted, and a pull request whose net diff is empty (or holds only the solver's own placeholder) is neither described as changed nor announced as ready to merge.
