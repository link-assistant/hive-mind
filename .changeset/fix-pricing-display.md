---
'@link-assistant/hive-mind': patch
---

Fix agent tool pricing display to show correct provider

- Add proper model mapping for free models (kimi-k2.5-free, gpt-4o-mini, etc.)
- Add getProviderName helper function to detect provider from model ID
- Prioritize provider from model ID over API response to fix issue #1250
- Display correct provider names: Moonshot AI, OpenAI, Anthropic instead of generic "OpenCode Zen"
