---
'@link-assistant/hive-mind': patch
---

feat(interactive-mode): display images the AI reads/writes inline in PR comments (#1843)

When `--interactive-mode` posts Claude/Codex tool activity as PR comments, any
images the AI reads or produces (the `Read` tool on a screenshot, Playwright
captures, MCP image results) were previously serialized as multi-kilobyte
base64 blobs inside the "Raw JSON" section — unreadable and pushing comments
toward GitHub's size limit.

Those base64 payloads are now uploaded to a dedicated orphan media branch
(`hive-mind-interactive-media`) via the GitHub Contents API and embedded inline
in the comment as `![](…?raw=true)` blob URLs, so reviewers see the actual image
(GitHub's Camo proxy renders `?raw=true` blob URLs inline for both public and
private repos, whereas `data:` URIs are stripped by the comment sanitizer).
Uploads are content-hashed (SHA-256) for dedup, and the base64 is redacted from
the Raw JSON section with a `<image data: N base64 chars>` placeholder.

Enabled by default; use `--no-interactive-image-upload` to opt out, in which
case each image degrades to a compact metadata note instead of being embedded.
All comment bodies continue to pass through the token sanitizer (#1745).
