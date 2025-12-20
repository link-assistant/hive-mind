# Logs and Evidence

This file aggregates the most relevant logs for Issue #719, demonstrating detection of usage limits, proper failure signaling, and reset time surfacing.

Key log sources saved locally during investigation (clickable paths):

- ci-logs/issue-719.json:1 — Original issue body including usage-limit error snippet
- ci-logs/pr-722.details.txt:1 — PR comments containing validation notes and follow-ups
- ci-logs/gh-run-list.branch.json:1 — Recent CI runs and outcomes for the branch
- logs.src-github.lib.620-740.txt:1 — attachLogToGitHub usage-limit comment branch
- logs.src-solve.head.txt:1 — solve.mjs startup and options wiring
- logs.search-usage-limit-in-solve.txt:1 — Cross-references of usage-limit handling across the codebase

Excerpts

```text
From ci-logs/issue-719.json:1

[2025-11-12T11:47:04.135Z] [INFO] 📌 Session ID: 019a77e4-0716-7152-8396-b642e26c3e20
[2025-11-12T11:47:04.163Z] [INFO] {"type":"turn.started"}

[2025-11-12T11:47:04.639Z] [INFO] {"type":"error","message":"You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}
{"type":"turn.failed","error":{"message":"You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}}
```

```text
From ci-logs/pr-722.details.txt:1

Weekly limit reached ∙ resets 5am
…
❌ Claude command failed with exit code 0
📌 Session ID for resuming: 64652bfd-65f5-460f-bb16-fa89fa8fc778
To resume this session, run:
   <node> <script> <url> --resume 64652bfd-65f5-460f-bb16-fa89fa8fc778
```

```text
From ci-logs/gh-run-list.branch.json:1

All 5 latest CI runs for branch issue-719-a653aae7d4d5 concluded success, including head SHA 419e64bc6c6ac88b8660d2cd44dba0dd2a833f4e
```

```text
From logs.src-github.lib.620-740.txt:1

Dedicated usage-limit comment variant is used whenever isUsageLimit=true; includes optional Reset Time and Resume Command.
```

```text
From logs.search-usage-limit-in-solve.txt:1

Usage-limit detection and formatting present in:
- src/claude.lib.mjs
- src/codex.lib.mjs
- src/opencode.lib.mjs
- src/github.lib.mjs (attachLogToGitHub)
- src/solve.mjs (propagates limitResetTime to global + PR comments)
```

