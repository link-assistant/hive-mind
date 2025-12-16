---
"@link-assistant/hive-mind": patch
---

fix: prefer Anthropic provider for public price calculation

When calculating public pricing for Claude models, fetchModelInfo now checks the Anthropic provider first instead of using the first match from the models.dev API (which was Helicone). This ensures pricing calculations show "Provider: Anthropic" as expected.
