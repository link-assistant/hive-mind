# Issue #2320: Evidence from the failed `--model formal-ai` runs (2026-09-27)

Source logs live in `docs/case-studies/issue-2320/logs/` and were not modified.
Line references use the form `file:line`. Every excerpt below is copied verbatim from the log or the GitHub comment.

| Log                   | Lines | Tool   | Target repository / branch                                                              |
| --------------------- | ----- | ------ | --------------------------------------------------------------------------------------- |
| `kotlin-main.log`     | 2120  | claude | `konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a` / `issue-1-604f2202fd18` |
| `kotlin-restart1.log` | 4034  | claude | same                                                                                    |
| `kotlin-restart2.log` | 5917  | claude | same                                                                                    |
| `kotlin-final.log`    | 6067  | claude | same                                                                                    |
| `scala-agent.log`     | 4243  | agent  | `konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b` / `issue-1-1f3e3886bcb8` |
| `rust-codex.log`      | 9284  | codex  | `konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c` / `issue-1-09b0c76bd0e4` |

The four Kotlin files are cumulative snapshots of one log file:

- `kotlin-restart1.log` is a prefix of `kotlin-restart2.log`, which is a prefix of `kotlin-final.log`.
- `kotlin-main.log` differs from the others only in 4 masked commit-hash lines, such as `433…62a` vs `4337bf1…`.
- Line numbers are therefore the same in all four files. This document cites `kotlin-final.log`.

---

## 1. Kotlin (`--tool claude`)

### 1.1 Timeline

| Timestamp (UTC)           | Location                                           | Event                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15:02:20.741              | kotlin-final.log:8                                 | `solve .../issues/1 --model formal-ai --tool claude --attach-logs ...` (solve v2.32.0, line 135)                                                                                                                    |
| 15:02:51.307              | kotlin-final.log:132                               | PR #2 converted to draft (session start)                                                                                                                                                                            |
| 15:03:03.601-.645         | kotlin-final.log:188-191                           | Formal AI wrapper 0.351.0 differs from serving backend 0.352.1                                                                                                                                                      |
| 15:03:03.228-.311         | kotlin-final.log:173-184                           | Main prompt: 515 chars, **system prompt 0 chars**, feedback "Yes (1 lines)"                                                                                                                                         |
| 15:03:03.890              | kotlin-final.log:213-227                           | Main user prompt printed; system prompt block is empty                                                                                                                                                              |
| 15:03:40                  | kotlin-final.log:1671 ff.                          | Main session: 7 tool calls (gh issue view, 3x Write, `kotlinc Main.kt -include-runtime -d Main.jar`, verify script, `git add -- 'Main.kt' ... && git commit --only ...`). The commit succeeds and is pushed (1819). |
| 15:03:45.542              | kotlin-final.log:1980                              | `Ignoring Anthropic cost $0.576812 ...`                                                                                                                                                                             |
| 15:03:46.068-.092         | kotlin-final.log:2015-2023                         | The same $0.576812 is printed as "cost (public)" and "Public pricing estimate"                                                                                                                                      |
| 15:03:46.155-.218         | kotlin-final.log:2040-2052                         | `?? Main.jar`, "Uncommitted changes detected!", "AUTO-RESTART"                                                                                                                                                      |
| 15:03:54.952              | kotlin-final.log:2101-2102                         | PR converted **to ready for review** even though a restart is pending                                                                                                                                               |
| 15:04:02.794              | kotlin-final.log:2142                              | "SUCCESS: A solution draft has been prepared"                                                                                                                                                                       |
| 15:04:02.829              | kotlin-final.log:2152, 2159                        | `shouldRestart (auto-detected): true`, "AUTO-RESTART: Uncommitted changes detected"                                                                                                                                 |
| 15:04:14.760              | kotlin-final.log:2191                              | "Restart 1/5: Running CLAUDE to handle uncommitted changes..."                                                                                                                                                      |
| 15:04:16.172              | kotlin-final.log:2199-2203                         | PR `isDraft=false` is **converted back to draft** (restart iteration)                                                                                                                                               |
| 15:04:17.843              | kotlin-final.log:2220                              | Restart 1 prompt: "Feedback info included: Yes (12 lines)"                                                                                                                                                          |
| 15:04:17.987              | kotlin-final.log:2242-2256                         | Restart 1 user prompt is byte-identical to the main prompt; system prompt empty                                                                                                                                     |
| 15:04:54-55               | kotlin-final.log:3700, 3743                        | The same 7 tool calls run again. `git commit --only` result: `Exit code 1 ... nothing added to commit but untracked files present`                                                                                  |
| 15:04:56.991              | kotlin-final.log:3971                              | `Ignoring Anthropic cost $0.551092 ...`                                                                                                                                                                             |
| 15:04:57.085-.090         | kotlin-final.log:3977-3988                         | `Command failed: Final tool result failed: Exit code 1`, then `Claude command failed with exit code 0`                                                                                                              |
| 15:04:57.806              | kotlin-final.log:4017-4018                         | Ensure-draft after failure: `Already in draft mode`                                                                                                                                                                 |
| 15:04:59.783              | kotlin-final.log:4020                              | "CLAUDE execution failed Will retry in next check" (failure comment 5857020327)                                                                                                                                     |
| 15:05:17.225              | kotlin-final.log:4076                              | "Restart 2/5"                                                                                                                                                                                                       |
| 15:05:19.212-.363         | kotlin-final.log:4103-4139                         | Restart 2 prompt: "Yes (12 lines)"; user prompt again byte-identical; system prompt empty                                                                                                                           |
| 15:05:56-59               | kotlin-final.log:5583, 5626, 5854, 5860-5871       | The same 7 tool calls, the same git failure, the same classification; ignored cost $0.551092                                                                                                                        |
| 15:05:59.885              | kotlin-final.log:5898                              | "No progress: this session ended exactly like the previous one"                                                                                                                                                     |
| 15:06:00.683              | kotlin-final.log:5901                              | Ensure-draft after failure: `Already in draft mode`                                                                                                                                                                 |
| 15:06:22.047-.067         | kotlin-final.log:5960-5963                         | "NO PROGRESS BETWEEN SESSIONS Stopping instead of repeating an identical session" (3 restart iterations unused)                                                                                                     |
| 15:06:22.767              | kotlin-final.log:5965-5967                         | Ensure-draft: `Already in draft mode`                                                                                                                                                                               |
| 15:06:22.793-15:06:28.793 | kotlin-final.log:5969-5977                         | Critical-error auto-commit **adds `Main.jar`** (commit 923ff30) and pushes `4337bf1..923ff30`                                                                                                                       |
| 15:06:29.360              | kotlin-final.log:5978                              | A working-session-summary comment from a **different run** (`/tmp/gh-issue-solver-1785421161275`) is fetched from the PR                                                                                            |
| 15:06:30.428              | kotlin-final.log:5981                              | Stop reason posted to PR #2                                                                                                                                                                                         |
| 15:06:31.510-.624         | kotlin-final.log:6013, 6027, 6031, 6042-6043, 6052 | "stays a draft", "MONITORING STOPPED", "Uncommitted work was auto-committed", "No progress between sessions"                                                                                                        |

### 1.2 The prompts are byte-identical, and the system prompt is empty

Prompt-structure lines for the main session (kotlin-final.log:173-184, abridged to the relevant lines):

```
[2026-09-27T15:03:03.235Z] [INFO]    Characters: 515
[2026-09-27T15:03:03.255Z] [INFO]    System prompt characters: 0
[2026-09-27T15:03:03.302Z] [INFO]    Prompt length: 515 chars
[2026-09-27T15:03:03.307Z] [INFO]    System prompt length: 0 chars
[2026-09-27T15:03:03.311Z] [INFO]    Feedback info included: Yes (1 lines)
```

Restart 1 (kotlin-final.log:2208-2220) and restart 2 (kotlin-final.log:4091-4103) print the same `Characters: 515` and `System prompt characters: 0`. The only change is `Feedback info included: Yes (12 lines)` at 2220 and 4103.

The raw command passes an empty system prompt (`--append-system-prompt ""`) at kotlin-final.log:210, 2239 and 4122.

User prompt, main session (kotlin-final.log:214-222; restart 1 is at 2243-2251 and restart 2 at 4126-4134):

```
Resolve the GitHub issue at https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/issues/1 in this repository.
Keep the solution on branch issue-1-604f2202fd18.
Update the pull request at https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2.
Review and address all feedback recorded on that pull request.

Implement and verify the solution before reporting completion.
Commit the changes and push them to the branch before reporting completion.
Continue.
```

System prompt blocks (225-227, 2254-2256, 4137-4139) contain nothing between `---BEGIN SYSTEM PROMPT---` and `---END SYSTEM PROMPT---`.

Verification: the 9 lines after each `---BEGIN USER PROMPT---` (213, 2242, 4125), with the timestamp prefix removed, all hash to md5 `15d23c14044e541ed05ffe2bc156c252`. **The three prompts are byte-identical.**

The restart prompts claim 12 feedback lines, and the uncommitted file was known before restart 1 (kotlin-final.log:2187-2189 `UNCOMMITTED CHANGES: ?? Main.jar`). Even so, **neither the untracked file nor any instruction about it reaches the model.**

### 1.3 `?? Main.jar` detection (kotlin-final.log:2044-2052)

```
[2026-09-27T15:03:46.205Z] [STDOUT] ?? Main.jar
[2026-09-27T15:03:46.206Z] [INFO] 📝 Found uncommitted changes
[2026-09-27T15:03:46.208Z] [INFO] Changes:
[2026-09-27T15:03:46.210Z] [INFO]    ?? Main.jar
[2026-09-27T15:03:46.212Z] [INFO]
[2026-09-27T15:03:46.212Z] [INFO] ⚠️ IMPORTANT: Uncommitted changes detected!
[2026-09-27T15:03:46.215Z] [INFO]    Claude made changes that were not committed.
[2026-09-27T15:03:46.215Z] [INFO]
[2026-09-27T15:03:46.218Z] [INFO] 🔄 AUTO-RESTART: Restarting Claude to handle uncommitted changes...
```

Main.jar comes from the model's own `kotlinc Main.kt -include-runtime -d Main.jar`. The model's commit uses `git add -- 'Main.kt' 'tests/verify-output.sh' '.github/workflows/run.yml' && git commit --only ...`, so the jar is never staged. Nothing in the repository ignores it.

### 1.4 The PR goes ready, then back to draft, while the restart is pending (kotlin-final.log:2101-2102, 2199-2203)

```
[2026-09-27T15:03:54.952Z] [INFO] 📝 Converting PR: To ready for review (solution draft verified)...
[2026-09-27T15:03:56.101Z] [STDERR] ✓ Pull request konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a#2 is marked as "ready for review"
...
[2026-09-27T15:04:16.170Z] [INFO]   🔍 PR #2 draft state: isDraft=false, state=OPEN
[2026-09-27T15:04:16.172Z] [INFO]   📝 Converting PR:          To draft mode (restart iteration)...
[2026-09-27T15:04:17.418Z] [STDERR] ✓ Pull request konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a#2 is converted to "draft"
```

### 1.5 `nothing added to commit` and the "Final tool result failed" classification (kotlin-final.log:3977-3989)

```
[2026-09-27T15:04:57.085Z] [ERROR] ❌ Command failed: Final tool result failed: Exit code 1
[2026-09-27T15:04:57.085Z] [ERROR] On branch issue-1-604f2202fd18
[2026-09-27T15:04:57.085Z] [ERROR] Your branch is up to date with 'origin/issue-1-604f2202fd18'.
[2026-09-27T15:04:57.085Z] [ERROR] Untracked files:
[2026-09-27T15:04:57.085Z] [ERROR]   (use "git add <file>..." to include in what will be committed)
[2026-09-27T15:04:57.085Z] [ERROR] 	Main.jar
[2026-09-27T15:04:57.085Z] [ERROR] nothing added to commit but untracked files present (use "git add" to track)
[2026-09-27T15:04:57.090Z] [ERROR] ❌ Claude command failed with exit code 0
[2026-09-27T15:04:57.093Z] [INFO] 📌 Session ID: fa815b13-30f8-4c74-a8cc-8453fcbadbe4
```

Blank `[ERROR]` lines are omitted. Restart 2 repeats this at 5860-5871 (session `61b04830-a068-4b5d-a207-0ffc5a22af28`). The raw tool_result is at 3743 and 5626 (`"content": "Exit code 1\nOn branch ...`, `"is_error": true`).

Note: `git commit` exits 1 only because the files were already committed in the main session. The model's work was complete, but solve classifies the run as a failed session. The log also says "failed with exit code 0" (3988, 5871), which contradicts that classification.

### 1.6 Ensure-draft after failure (kotlin-final.log:4016-4020)

```
[2026-09-27T15:04:57.800Z] [INFO]   🔍 PR #2 draft state: isDraft=true, state=OPEN
[2026-09-27T15:04:57.806Z] [INFO]   ✅ PR status:              Already in draft mode
[2026-09-27T15:04:59.783Z] [INFO]   ⚠️ CLAUDE execution failed Will retry in next check
```

The same check appears after restart 2 (5900-5903) and after the no-progress stop (5965-5967).

### 1.7 The no-progress stop (kotlin-final.log:5898, 5960-5963)

```
[2026-09-27T15:05:59.885Z] [INFO]   ⚠️ No progress:            this session ended exactly like the previous one
...
[2026-09-27T15:06:22.047Z] [ERROR] ❌ NO PROGRESS BETWEEN SESSIONS Stopping instead of repeating an identical session
[2026-09-27T15:06:22.057Z] [ERROR]    Previous session:       session `fa815b13-30f8-4c74-a8cc-8453fcbadbe4`, log `/home/box/fa815b13-30f8-4c74-a8cc-8453fcbadbe4.log`
[2026-09-27T15:06:22.061Z] [ERROR]    Identical session:      session `61b04830-a068-4b5d-a207-0ffc5a22af28`, log `/home/box/61b04830-a068-4b5d-a207-0ffc5a22af28.log`
[2026-09-27T15:06:22.067Z] [ERROR]    Budget left unused:     3 restart iterations
```

### 1.8 The critical-error auto-commit adds the build artifact (kotlin-final.log:5969-5977)

```
[2026-09-27T15:06:22.793Z] [INFO] 💾 Critical error (stopped after two identical AI sessions) — auto-committing uncommitted changes to preserve work before recovery...
[2026-09-27T15:06:22.795Z] [INFO]    ?? Main.jar
[2026-09-27T15:06:23.108Z] [STDOUT] [issue-1-604f2202fd18 923ff30] 🛟 Auto-commit before critical-error recovery (stopped after two identical AI sessions)
 1 file changed, 0 insertions(+), 0 deletions(-)
 create mode 100644 Main.jar
[2026-09-27T15:06:23.111Z] [INFO] ✅ Uncommitted changes committed before recovery.
[2026-09-27T15:06:28.780Z] [STDOUT] To https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a.git
[2026-09-27T15:06:28.781Z] [STDOUT]    4337bf1..923ff30  issue-1-604f2202fd18 -> issue-1-604f2202fd18
[2026-09-27T15:06:28.793Z] [INFO] ✅ Preserved work pushed to remote.
```

The only "work" preserved is a compiled jar. It is now in the PR diff. The final summary says so at 6043: "Uncommitted work was auto-committed before exit, so the partial result is visible."

### 1.9 End of run (kotlin-final.log:6013, 6027, 6042, 6052)

```
[2026-09-27T15:06:31.510Z] [INFO]   ℹ️  PR #2 stays a draft: no progress between sessions
[2026-09-27T15:06:31.575Z] [ERROR]   ❌ MONITORING STOPPED:     The solution session failed: no progress between sessions
[2026-09-27T15:06:31.607Z] [ERROR] ❌ Stopped after two consecutive AI sessions produced identical results - no restart can make progress.
[2026-09-27T15:06:31.624Z] [ERROR] ❌ No progress between sessions
```

---

## 2. Scala (`--tool agent`)

### 2.1 Timeline

| Timestamp (UTC)   | Location                                   | Event                                                                                                                                        |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| —                 | scala-agent.log:8                          | `--model formal-ai --tool agent --attach-logs --verbose --no-tool-check --disable-report-issue --language en`                                |
| 15:09:15-16       | scala-agent.log:170, 180-184               | No uncommitted changes; prompt 515 chars, system prompt 0 chars                                                                              |
| 15:09:15.848      | scala-agent.log:188                        | "Formal AI attribution enabled (formal-ai/0.351.0)"                                                                                          |
| 15:09:16.036      | scala-agent.log:199                        | **`XDG_CONFIG_HOME=/home/box/.cache/hive-mind/formal-ai/agent-krM8Ep/.config`**                                                              |
| 15:09:16.041      | scala-agent.log:200                        | environment `FORMAL_AI_API_KEY, XDG_CONFIG_HOME`                                                                                             |
| 15:09:16.056      | scala-agent.log:203                        | `cat "/tmp/agent_prompt_..." \| agent --model formalai/formal-ai ...`                                                                        |
| 15:09:17.420-.438 | scala-agent.log:546-577                    | Provider registry `"message": "found"` for `formal-ai` (551), `formalai` (559), `@link-assistant` (567), `opencode` (575)                    |
| 15:09:17.444      | scala-agent.log:578                        | **Attribution guard: "Formal AI attribution disabled: the Agent CLI stream reports opencode"**                                               |
| 15:09:17.448-.488 | scala-agent.log:584, 602, 611, 659-660     | `kilo` found; `opencode`/`big-pickle` short-name resolution; compaction cascade **drops** `opencode/big-pickle` and `kilo/minimax-m2.5-free` |
| 15:09:17.494      | scala-agent.log:680-688                    | `model_resolved`: `providerID "formalai"`, `modelID "formal-ai"`, `matchesRequest: true`                                                     |
| 15:09:20.848-.918 | scala-agent.log:1588, 1617-1620, 1649-1655 | Agent bash `gh issue view ...` → **"gh auth login / GH_TOKEN"**, `"exit": 4`                                                                 |
| 15:09:22.533      | scala-agent.log:2627 (also 2657)           | Plan record `terminal_state "planned_not_executed"`                                                                                          |
| 15:09:24.112      | scala-agent.log:3584                       | Final text "Planned, not executed ... Nothing the request names was changed"                                                                 |
| 15:09:24.404      | scala-agent.log:4199-4208                  | 27,622 input / 3,461 output tokens; `Public pricing estimate: $0.000000`                                                                     |
| 15:09:24.414-.415 | scala-agent.log:4211-4212                  | ERROR "Formal AI did not execute repository work ... planned_not_executed"                                                                   |
| 15:09:25.119      | scala-agent.log:4229                       | "No uncommitted changes to preserve before recovery."                                                                                        |
| 15:09:25.493      | scala-agent.log:4243                       | Log ends during failure-log upload                                                                                                           |

### 2.2 XDG_CONFIG_HOME override (scala-agent.log:199-200)

```
[2026-09-27T15:09:16.036Z] [INFO] 🧠 Formal AI: config XDG_CONFIG_HOME=/home/box/.cache/hive-mind/formal-ai/agent-krM8Ep/.config, seeded /home/box/.config/link-assistant-agent → .config/link-assistant-agent
[2026-09-27T15:09:16.041Z] [INFO] 🧠 Formal AI: environment FORMAL_AI_API_KEY, XDG_CONFIG_HOME
```

Only `link-assistant-agent` is seeded into the temporary config directory. `gh` reads `$XDG_CONFIG_HOME/gh/hosts.yml`, so inside the agent it cannot find its credentials. solve's own `gh` calls in the same run (outside the agent) worked.

### 2.3 gh auth failure inside the agent (scala-agent.log:1617-1620, 1655)

```
[2026-09-27T15:09:20.903Z] [INFO]         "command": "gh issue view 'https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/issues/1' --json title --jq .title && echo && gh issue view 'https...
[2026-09-27T15:09:20.903Z] [INFO]         "output": "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n"
...
[2026-09-27T15:09:20.918Z] [INFO]         "exit": 4
```

### 2.4 planned_not_executed (scala-agent.log:2627, 3584, 4211-4212)

```
[2026-09-27T15:09:22.533Z] [INFO]         "content": "general_change_plan\n  id \"repository_work_item_plan_371ce45f8cb93a5a\"\n  execution_mode \"repository_work_item\"\n  terminal_state \"planned_not_executed\"\n  goal \"Resolve...
[2026-09-27T15:09:24.112Z] [INFO]     "text": "Planned, not executed: https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/issues/1.\n\nNothing the request names was changed. The only file this run wrote ...
[2026-09-27T15:09:24.414Z] [ERROR] ❌ Formal AI did not execute repository work; it returned the terminal state planned_not_executed. Fix or upgrade Formal AI's repository-work executor before retrying.
[2026-09-27T15:09:24.415Z] [ERROR]    The deterministic terminal response will not be retried as a mergeability problem.
```

### 2.5 Attribution guard and the provider-registry records before it (scala-agent.log:570-578)

Records at 546-553 (`formal-ai`), 554-561 (`formalai`) and 562-569 (`@link-assistant`) have the same shape as this one.

```
[2026-09-27T15:09:17.438Z] [INFO] {
[2026-09-27T15:09:17.438Z] [INFO]   "type": "log",
[2026-09-27T15:09:17.438Z] [INFO]   "level": "info",
[2026-09-27T15:09:17.438Z] [INFO]   "timestamp": "2026-09-27T15:09:17.414Z",
[2026-09-27T15:09:17.438Z] [INFO]   "service": "provider",
[2026-09-27T15:09:17.438Z] [INFO]   "providerID": "opencode",
[2026-09-27T15:09:17.438Z] [INFO]   "message": "found"
[2026-09-27T15:09:17.438Z] [INFO] }
[2026-09-27T15:09:17.444Z] [WARNING] 🛑 Formal AI attribution disabled: the Agent CLI stream reports opencode, a hosted opencode model
```

The model resolved 50 ms later (scala-agent.log:680-688):

```
[2026-09-27T15:09:17.494Z] [INFO]   "type": "model_resolved",
[2026-09-27T15:09:17.494Z] [INFO]   "requested": "formalai/formal-ai",
[2026-09-27T15:09:17.494Z] [INFO]   "providerID": "formalai",
[2026-09-27T15:09:17.494Z] [INFO]   "modelID": "formal-ai",
[2026-09-27T15:09:17.494Z] [INFO]   "matchesRequest": true
```

The guard fired on a provider-registry `"found"` (availability) record, not on the model actually used. The compaction cascade even dropped `opencode/big-pickle` (659-660).

---

## 3. Rust (`--tool codex`)

### 3.1 Timeline

| Timestamp (UTC)   | Location / source             | Event                                                                                                                                    |
| ----------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| —                 | rust-codex.log:8              | `--model formal-ai --tool codex --attach-logs --verbose --no-tool-check --disable-report-issue ...`                                      |
| —                 | rust-codex.log:80-83, 135-137 | PR #2 already a draft; "Already in draft mode"                                                                                           |
| 15:15:12          | rust-codex.log:106-107        | `gh auth setup-git` cannot write global gitconfig; per-clone credential helper used instead                                              |
| 15:15:29.549      | rust-codex.log:205            | `CODEX_HOME=/home/box/.cache/hive-mind/formal-ai/codex-ASg3Ll/.codex` (seeded)                                                           |
| 15:15:30.8        | rust-codex.log:221-222        | `model_context_window=200000`, `model_auto_compact_token_limit=150000`                                                                   |
| 15:15:30.877      | rust-codex.log:227            | Raw command exports a **different** `CODEX_HOME=/home/box/.codex/hive-mind/repositories/konard/...`                                      |
| 15:15:34.874      | rust-codex.log:494            | First `item.started` `gh issue view ...` (item_1), exit_code 0, output = issue body (573)                                                |
| 15:15:34-15:19:33 | rust-codex.log:494 … 8834     | **78 identical `gh issue view` executions** (item_1 … item_155), each preceded by the same agent message                                 |
| 15:19:35.598      | rust-codex.log:8930           | `item.completed` type `error`: "Heads up: Long threads and multiple compactions ..."                                                     |
| 15:19:37.7-40.0   | rust-codex.log:8991, 9057     | The only other commands: `find . -maxdepth 1 -type f ...` and `cat .gitkeep`                                                             |
| 15:19:42          | rust-codex.log:9202-9212      | Final message "Read 1 file(s): `.gitkeep`"; 6,183,844 input tokens; 80 command executions; `$0.000000`; error event ignored as non-fatal |
| —                 | rust-codex.log:9231           | "No uncommitted changes found"                                                                                                           |
| —                 | rust-codex.log:9266-9267      | "PR #2 keeps its draft status: no changes were produced by this session"; comment 5857129286 posted                                      |
| 15:19:51.540      | rust-codex.log:9284           | Log ends during solution-draft-log upload                                                                                                |
| 15:20:00Z         | PR comment 5857130507         | Solution Draft Log: `6.2M / 200K (3092%) input tokens`                                                                                   |
| 15:22:39Z         | PR comment 5857152388         | Automation stopped with reason `draft_pull_request` (3 restore attempts)                                                                 |

### 3.2 78 identical `gh issue view` executions (counted with grep)

```
$ grep -c '"type":"item.started","item":{"id":"item_[0-9]*","type":"command_execution"' rust-codex.log
80
$ grep '"type":"item.started".*"command":"/bin/bash -lc \\"gh issue view' rust-codex.log | wc -l
78
$ grep '"type":"item.started".*command_execution' rust-codex.log | sed 's/.*"command":\("[^,]*\),.*/\1/' | sort | uniq -c
      1 "/bin/bash -lc 'cat .gitkeep'"
      1 "/bin/bash -lc \"find . -maxdepth 1 -type f | sed ...\""
     78 "/bin/bash -lc \"gh issue view 'https://github.com/konard/test-hello-world-019fb331-.../issues/1' --json title --jq .title && echo && gh issue view ...
```

The 78 `item.completed` records match the 78 starts. Every one exits 0 and returns the issue body (e.g. rust-codex.log:573 `"aggregated_output":"Implement Hello World in Rust\n\n## Task..."`, `"exit_code":0`). Before each command the agent message is always the same, "Let me run the requested command to get that for you." (80 occurrences). The plain `grep -c 'gh issue view'` returns 312, because each execution appears in several stdout/stderr/trace lines.

Solve summary (rust-codex.log:9203-9212):

```
thread.started=1, turn.started=1, item.completed=162, item.started=80, turn.completed=1
agent_message=81, command_execution=160, error=1
📈 Codex usage from turn.completed: 6,183,844 input, 0 cache read, 27,382 output across 1 turn(s)
💻 Codex command executions observed: 80
💰 Codex public pricing estimate: $0.000000
⚠️ Ignoring non-fatal Codex error event(s): Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible ...
```

No repeated-tool-call breaker fired. The only in-band signal was the Codex compaction warning, and solve downgraded it to non-fatal.

### 3.3 `6.2M / 200K (3092%)` (PR comment 5857130507, 15:20:00Z; not in the local log, which ends at 15:19:51)

```
- 6.2M / 200K (3092%) input tokens
Total: 6.2M input tokens, 27.4K output tokens, $0.000000 cost
```

This is a cumulative total across the turn's many compactions, reported as if it were context-window usage. The run also had a 200K window with auto-compaction at 150K (rust-codex.log:221-222).

### 3.4 "No changes were produced by this session" (rust-codex.log:9266-9267; PR comment 5857129286)

```
[WARNING] ⚠️ PR #2 keeps its draft status: no changes were produced by this session
💬 Posted: No changes were produced by this session comment (id=5857129286)
```

The comment body reads: "**No changes were produced by this session** The pull request still has an empty diff against its base branch (only the solver placeholder file is present), so it stays a draft..."

### 3.5 "Draft restored" and the `draft_pull_request` stop

`grep -n 'Draft restored\|draft_pull_request\|3092' logs/*.log` finds **no matches**. rust-codex.log ends at 15:19:51.540, before the auto-restart-until-mergeable phase. The evidence comes from the PR comment and the source code.

PR comment 5857152388 (15:22:39Z):

```
## 🛑 Automation stopped: the automation stopped with reason `draft_pull_request`
... Pull request #2 keeps returning to draft state (3 restore attempts). A draft pull request cannot be merged.
... Mark the pull request as ready for review manually (gh pr ready), then rerun.
```

Mechanism in the code:

- `src/pr-draft-state.lib.mjs:318-322`: when the PR was deliberately left in draft ("no changes were produced"), `ensurePullRequestIsReady` logs "stays a draft" and returns `{ ok: true, changed: false, skipped: true, reason: 'left_in_draft_on_purpose' }`.
- `src/solve.auto-merge-guards.lib.mjs:96-99` (`resolveDraftBlocker`) treats `readyResult?.ok` as success, logs `✅ Draft restored: PR #N is ready for review again (attempt n/3)` and returns `retry`. The PR is still a draft.
- After `MAX_DRAFT_SELF_HEALS = 3` (line 37), lines 88-92 stop with reason `draft_pull_request`.

The result is three false "Draft restored" messages and a stop that blames the user. No AI session is restarted to produce the missing changes.

---

## 4. Cost reporting

| Run              | Location                                   | Line                                                                                                                                     |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Kotlin main      | kotlin-final.log:1898                      | `"total_cost_usd": 0.576812` (Claude CLI result)                                                                                         |
| Kotlin main      | kotlin-final.log:1980                      | `💰 Ignoring Anthropic cost $0.576812 reported for a Formal AI session (Link.Assistant, free)`                                           |
| Kotlin main      | kotlin-final.log:2015                      | `cost (public):   $0.576812`                                                                                                             |
| Kotlin main      | kotlin-final.log:2021-2023                 | `Public pricing estimate: $0.576812` / `Calculated by Anthropic: $0.000000` / `Difference: $-0.576812 (-100.00%)`                        |
| Kotlin restart 1 | kotlin-final.log:3971                      | `💰 Ignoring Anthropic cost $0.551092 reported for a Formal AI session (Link.Assistant, free)`                                           |
| Kotlin restart 2 | kotlin-final.log:5854                      | `💰 Ignoring Anthropic cost $0.551092 reported for a Formal AI session (Link.Assistant, free)`                                           |
| Kotlin           | PR comment 5857012293 (Solution Draft Log) | `Public pricing estimate: $0.00 (Free model)` **and** `Total: 122.3K input tokens, 4.4K output tokens, $0.576812 cost`                   |
| Scala            | scala-agent.log:4208                       | `Public pricing estimate: $0.000000` (consistent)                                                                                        |
| Rust             | rust-codex.log:9211; PR comment 5857130507 | `$0.000000`; `Public pricing estimate: $0.00 (Free model)`, `Total: 6.2M input tokens, 27.4K output tokens, $0.000000 cost` (consistent) |

For Claude, the "ignore" decision is applied inconsistently. The console reports the ignored $0.576812 as the _public_ estimate, with Anthropic's figure as $0 (the inverse of reality). The PR comment prints "$0.00 (Free model)" next to "Total: ... $0.576812 cost".

---

## 5. Other Hive Mind defects visible in the logs

1. **Stale, foreign working-session summary.** kotlin-final.log:5978 fetches a `hive-mind:working-session-summary` comment saying "The `pwd` command completed. Output: /tmp/gh-issue-solver-1785421161275". That directory is not this run's (`/tmp/gh-issue-solver-1790521368402`).
2. **Stale PR description.** In the main Kotlin session the PR body is updated to "1 file(s) modified, 1 line(s) added" (kotlin-final.log:2089, repeated at 5998), although three files were committed.
3. **Formal AI version skew.** Wrapper 0.351.0 vs serving backend 0.352.1 (kotlin-final.log:188-191). Attribution is recorded as `formal-ai/0.351.0` (scala-agent.log:188).
4. **CODEX_HOME mismatch.** The line logged at rust-codex.log:205 (`/home/box/.cache/hive-mind/formal-ai/codex-ASg3Ll/.codex`) differs from the value exported in the raw command at 227 (`/home/box/.codex/hive-mind/repositories/konard/test-hello-world-019fb331-...`).
5. **Global gitconfig not writable.** `gh auth setup-git` could not write the global gitconfig, so solve fell back to a per-clone credential helper (rust-codex.log:106-107). This is benign here, but it shows that the home directory in the task image is partly read-only.
6. **Contradictory exit reporting.** "Claude command failed with exit code 0" (kotlin-final.log:3988, 5871).
7. **Successful work classified as failure.** The model's work had already been committed and pushed in the main session (kotlin-final.log:1819). The only leftover was a build artifact that should have been ignored. Restarts then burned about $1.10 of (ignored) cost and ended in a no-progress stop.
