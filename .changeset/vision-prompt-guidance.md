---
'@link-assistant/hive-mind': minor
---

Add system prompt guidance for visual UI work when model supports vision

**Changes:**

- Add `checkModelVisionCapability` function in claude.lib.mjs to detect if a model supports image input using models.dev API
- Add vision-specific system prompt section in claude.prompts.lib.mjs and agent.prompts.lib.mjs
- When model supports vision, add guidance for including screenshots/renders of visual UI changes in pull request descriptions
- Use "When x, do y." style as requested

**Vision prompt guidance includes:**

- When working on visual UI changes, include a render or screenshot in the PR description
- When showing visual results, save screenshots to the repository (e.g., docs/screenshots/)
- When referencing images, use permanent raw file links in the PR description markdown
- When uploading images, commit them first, then use raw GitHub URL format
- When the visual result is important, mention it explicitly with embedded image

**Technical details:**

- Uses models.dev API to check if 'image' is in the model's input modalities
- All current Claude models (opus, sonnet, haiku) support vision
- Gracefully handles unknown models by returning false

Fixes #1175
