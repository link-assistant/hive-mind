---
'@link-assistant/hive-mind': patch
---

Publish sanitized fallback logs on pull request heads and dedicated issue branches. Large logs are streamed and committed in bounded UTF-8 parts with a download index, and log comments link to the published artifacts, including the parts published before a failure. The scratch-space precheck now reserves one sanitized copy plus one 100 MiB gh-upload-log part, because gh-upload-log 0.13.4 streams large logs, instead of two full copies.
