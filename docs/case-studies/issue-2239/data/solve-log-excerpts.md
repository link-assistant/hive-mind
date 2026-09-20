# Solve-log excerpts — issue #2239

Line numbers refer to `solve-log-sanitized.log.gz` (33,477 lines), the
sanitized log attached to the issue. Decompress with `gunzip -c`.

## Fork mode is detected, and the prompt is correct

```
68: [2026-09-12T04:31:13.895Z] [INFO] ✅ Auto-fork: No write access detected, enabling fork mode
78: [2026-09-12T04:31:16.228Z] [INFO] 🍴 Detected fork PR from konard/frontend
100: [2026-09-12T04:31:20.261Z] [INFO] ℹ️ Fork exists:              konard/frontend
169: [2026-09-12T04:31:30.150Z] [STDERR] ✓ Pull request Godmy/frontend#2 is converted to "draft"
```

Lines 374 and 528 are the screenshot instruction as it was actually sent to
the tool. Both name the **fork**, so the fix from issue #1561 worked exactly as
designed:

```
374: [2026-09-12T04:31:39.125Z] [INFO]    - When you save screenshots to the repository, use permanent links in the pull request description markdown (e.g., https://github.com/konard/frontend/blob/issue-1-46ba053c/docs/screenshots/result.png?raw=true).
```

## Context compaction, eight minutes later

Line 18415 resumes the session from a summary. `Godmy/frontend` appears
5 times in that summary; `konard/frontend` appears
1 time, in a parenthetical. The rule survived compaction; the
fork-specific repository did not. See `compaction-summary.txt`.

## What was published, ten minutes after that

Line 32641 is the command that wrote and published the description. The `<img>`
tags it contains name `Godmy/frontend` — the repository that does not hold the
branch:

```html
<img src="https://github.com/Godmy/frontend/blob/issue-1-46ba053c/docs/screenshots/graph-force.png?raw=true" width="260" />
<img src="https://github.com/Godmy/frontend/blob/issue-1-46ba053c/docs/screenshots/graph-sankey.png?raw=true" width="260" />
<img src="https://github.com/Godmy/frontend/blob/issue-1-46ba053c/docs/screenshots/graph-network.png?raw=true" width="260" />
```

The same command ends with `gh pr ready 2`, and line 32692 confirms it landed:

```
32692: [2026-09-12T04:49:46.521Z] [INFO]         "content": "https://github.com/Godmy/frontend/pull/2\n✓ Pull request Godmy/frontend#2 is marked as \"ready for review\
```

Nothing between writing those URLs and publishing them looked at whether they
resolve. That gap is what this pull request closes.

## Mention counts

| String                                                              | In the full log | In the compaction summary |
| ------------------------------------------------------------------- | --------------- | ------------------------- |
| `Godmy/frontend` (the repository that does **not** hold the branch) | 90              | 5                         |
| `konard/frontend` (the fork that **does**)                          | 16              | 1                         |
| the fork-aware screenshot instruction                               | 2               | 0                         |

An instruction stated twice is competing against a repository path stated 90
times. That imbalance is root cause RC2.
