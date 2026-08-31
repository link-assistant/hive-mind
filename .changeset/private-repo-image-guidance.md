---
'@link-assistant/hive-mind': patch
---

Add private repo image upload guidance to system prompts

- Add new "Uploading images to GitHub comments" section to all prompt files
- Clarify that raw.githubusercontent.com URLs do not support authentication at all
- For private repos, even authenticated users cannot view images via raw.githubusercontent.com
- Recommend base64 encoding as the only viable solution for private repo images
