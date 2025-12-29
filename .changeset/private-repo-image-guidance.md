---
'@link-assistant/hive-mind': patch
---

Add private repo image upload guidance to system prompts

- Add new "Uploading images to GitHub comments" section to all prompt files
- Clarify that raw.githubusercontent.com URLs only work for public repos
- Provide alternative solutions for private repos (external hosting, base64, etc.)
- Note that gh gist create doesn't support binary files
