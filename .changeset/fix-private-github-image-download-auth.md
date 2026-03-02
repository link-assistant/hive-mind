---
'@link-assistant/hive-mind': patch
---

fix: update system messages to use authenticated curl for private GitHub issue images

Images attached to GitHub issues/PRs (github.com/user-attachments/assets/\*) require authentication. Without auth, GitHub returns "Not Found" (9 bytes ASCII) with HTTP 200 — a silent failure. The AI would then call Read on the non-image file, encoding "Not Found" as base64, causing Anthropic API to return "Could not process image" (HTTP 400), crashing the session.

Updated system messages in all 4 prompt files (claude, agent, codex, opencode) to explicitly identify user-attachments URLs as requiring GitHub authentication and provide the exact authenticated curl command using `gh auth token`.
