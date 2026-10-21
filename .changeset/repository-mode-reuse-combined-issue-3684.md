---
'@link-assistant/hive-mind': patch
---

`/solve <repository-url>` is idempotent now (#3684). A combined issue created by an earlier repository-mode run is never counted as work; when an open combined issue already requires every open issue it is reused instead of creating another one, when issues were opened since then its scope is updated in place, and only issues that are not its sub-issues yet are attached. A kill recovery that replays the repository URL therefore lands on the same combined issue and continues the same pull request instead of opening a second and third combined issue.

Other one-time actions are no longer repeated on a repeated run either: `/fix --ci-cd` and `/fix --update-all-dependencies` reuse (and refresh) their open fixed-title issue, `/task --split` reports an earlier split instead of splitting the parent again, and the "Repository Initialization Required" notice is posted only once. With `--verbose`, repository mode logs whether it was replayed with `--resume`, which combined issues of earlier runs it found and which one it reused or why it created a new one.
