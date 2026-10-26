---
'@link-assistant/hive-mind': patch
---

Keep in-flight usage requests within their cache instance so resetting the cache cannot join obsolete work or overwrite a fresh result. Isolate queue unit tests from automatic background consumers.
