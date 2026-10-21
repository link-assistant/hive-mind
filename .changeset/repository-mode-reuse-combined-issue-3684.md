---
'@link-assistant/hive-mind': patch
---

`/solve <repository-url>` is idempotent now (#3684). A combined issue created by an earlier repository-mode run is never counted as work; when an open combined issue already requires every open issue it is reused instead of creating another one, when issues were opened since then its scope is updated in place, and only issues that are not its sub-issues yet are attached. A kill recovery that replays the repository URL therefore lands on the same combined issue and continues the same pull request instead of opening a second and third combined issue.
