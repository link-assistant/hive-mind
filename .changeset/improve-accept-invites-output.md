---
'@link-assistant/hive-mind': patch
---

Improve /accept_invites command output with grouped items and real-time updates

**Changes:**

- Group output by "Repositories:" and "Organizations:" instead of repeating "Repository:" for each item
- Add clickable GitHub links for each repository and organization
- Implement real-time message updates after each invitation is processed
- Show progress indicator (e.g., "Processing GitHub Invitations (3/10)") during processing

Fixes #1148
