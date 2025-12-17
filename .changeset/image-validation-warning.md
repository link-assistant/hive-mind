---
"@link-assistant/hive-mind": patch
---

Add image format validation warning to system prompts to prevent "Could not process image" errors. AI solvers are now instructed to verify image files with the 'file' command before reading them, avoiding crashes from corrupted downloads or HTML 404 pages. Includes reference to case study documenting the root cause of GitHub image processing failures.
