---
'@link-assistant/hive-mind': patch
---

Fix high CPU/RAM load handling and EPIPE errors

- Add EPIPE error handling and SIGPIPE signal handler for graceful shutdown when child processes are killed
- Add URL validation to detect malformed URLs from gh-upload-log during network issues
- Add resource checking before auto-restart to prevent OOM kills (requires 512MB free RAM)
