---
'@link-assistant/hive-mind': patch
---

Make pull request comments short and true (#2492). Session comments use the past tense ("Started at …") and no longer claim "The PR has been converted to draft mode", which was false when the PR already was a draft and otherwise repeated GitHub's timeline. The runtime line goes into the comment only with `--verbose` and is still logged. `--auto-merge` without merge rights now posts "Auto-merge blocked" instead of an unchecked "Ready to merge" that also hid the real one. Auto-restart, usage-limit, merge and force-kill comments drop footers that repeated the heading. The force-kill notice promises a resume only when there is a session to resume. Auto-close no longer says logs were attached, and an empty pull request is no longer described as implementing a solution. With only `--auto-restart-on-limit-reset`, the run no longer exits as failed right after announcing the restart.
