---
'@link-assistant/hive-mind': minor
---

Add model information display in PR/issue log comments. Shows actual models used (extracted from CLI JSON output) vs requested model. Main model is bolded when it matches the request; a warning appears when it doesn't. Supporting models are listed separately. Uses models.dev API for full model name, provider, and knowledge cutoff. Replaces duplicated tool name mapping with unified getToolDisplayName() helper.
