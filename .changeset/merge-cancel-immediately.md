---
'@link-assistant/hive-mind': patch
---

Cancel `/merge` immediately at every stage. Poll delays were uninterruptible `setTimeout` calls, so a cancel was only noticed once the delay expired — up to 5 minutes. Every merge wait now sleeps in short steps and aborts within ~100ms of the Cancel button, including the repo-wide actions wait, which previously had no cancellation support at all.
