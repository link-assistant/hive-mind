---
'@link-assistant/hive-mind': patch
---

Use the cheapest pricing tier by default for every tool (issue #2771): short context (Claude 200K / Haiku 5.5 100K, Codex 272K, Gemini Pro 200K, Qwen 256K) unless `--sub-session-size` explicitly asks for more, standard speed (no Fast/priority/Ultrafast) via the new `--speed` option (`--speed flex`, alias `batch`, opts into OpenAI's half-price Flex tier), plain model names instead of `[1m]`, and `opus`/`sonnet`/`haiku` aliases now map to the latest and cheapest Claude 5.5 models while all pinned versions stay supported.
