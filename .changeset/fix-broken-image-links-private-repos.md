---
'@link-assistant/hive-mind': patch
---

fix: use universal GitHub blob URL format for screenshots to fix broken images in private repositories (Issue #1349)

Previously, the system prompt instructed AI agents to embed screenshots using `raw.githubusercontent.com` URLs. These URLs always return HTTP 404 for private repositories because GitHub does not authenticate raw content requests when rendering PR description markdown.

Now agents are instructed to use the `https://github.com/{owner}/{repo}/blob/{branch}/path?raw=true` URL format instead, which works for both public and private repositories. This simplifies the implementation by removing the need to check repository visibility at all.
