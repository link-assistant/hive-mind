---
'@link-assistant/hive-mind': patch
---

Fix `/queue` status accuracy (issue #2823): tasks that are still running are no
longer listed under Completed, queued tasks that fail after launch (non-zero
exit or kill) now move to Failed with their exit code or signal, the summary
counts come from the lists shown (`Pending, Processing, Completed, Failed`),
long replies repeat the tool and list headers in every continuation message,
and bare repository URLs render as `owner/repo` links.

Docker images build on Box 2.10.4; command-stream is pinned to 2.3.0 and
lino-objects-codec is 0.9.2.
