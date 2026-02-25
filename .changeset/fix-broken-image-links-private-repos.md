---
'@link-assistant/hive-mind': patch
---

fix: prevent broken image links in PR descriptions for private repositories (Issue #1349)

Previously, the system prompt's "Visual UI work and screenshots" section instructed AI agents to embed screenshots using `raw.githubusercontent.com` URLs. These URLs always return HTTP 404 for private repositories because GitHub does not serve raw content without authentication when rendering PR description markdown.

Now the fix checks repository visibility before building the system prompt. For private repos, agents are warned that raw URLs produce broken images and are instructed to describe visual results in text form instead. For public repos, existing behavior is unchanged (backward compatible).

Full case study analysis including timeline reconstruction, root cause analysis, and evidence in `docs/case-studies/issue-1349/`.
