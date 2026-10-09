---
'@link-assistant/hive-mind': patch
---

Fix `/queue` status accuracy (issue #2823): tasks that are still running are no
longer listed under Completed, queued tasks that fail after launch (non-zero
exit or kill) now move to Failed with their exit code or signal, the summary
counts come from the lists shown (`Pending, Processing, Completed, Failed`),
long replies repeat the tool and list headers in every continuation message,
and bare repository URLs render as `owner/repo` links.
