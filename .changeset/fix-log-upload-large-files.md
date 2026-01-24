---
'@link-assistant/hive-mind': patch
---

fix: enable large log file uploads using gh-upload-log (issue #1173)

- Remove premature 25MB size check that incorrectly rejected large log files
- Files larger than 25MB now use gh-upload-log which can handle any size
- Default to private visibility when repository visibility cannot be determined (safer for private repos)
- Add case study documentation for issue #1173
