# Issue 890: "❌ No session ID extracted" for --tool agent

## Issue Description
When using the `--tool agent` option, the session summary incorrectly shows "❌ No session ID extracted" as an error message, even though the agent tool successfully extracts session IDs from its JSON output.

## Root Cause Analysis
The agent tool in `src/agent.lib.mjs` correctly parses NDJSON output and extracts session IDs during execution. However, the `showSessionSummary` function in `src/solve.results.lib.mjs` treats any missing session ID as an error for all tools.

The issue is that agent tool session IDs are not meaningful for resuming sessions like Claude's interactive sessions. Agent tools complete their work in a single execution and don't support resuming from a session ID.

## Evidence from Logs
From the execution log, we can see the agent correctly extracts and logs session IDs:
```
[2025-12-09T19:04:04.499Z] [INFO] 📌 Session ID: ses_4fb80368affeq12lyNC0F8yGV7
```

But the final session summary showed: "❌ No session ID extracted"

This is misleading because:
1. The agent tool DID extract the session ID successfully
2. Agent session IDs are not used for resuming (unlike Claude sessions)
3. The error message was inappropriate for agent tool usage

## Solution
Modified `src/solve.results.lib.mjs` to handle agent tool differently in the session summary:
- For non-agent tools: Continue showing "❌ No session ID extracted" as an error when appropriate
- For agent tool: Show "ℹ️ Agent tool completed (session IDs not used for resuming)" as informational message

## Files Changed
- `src/solve.results.lib.mjs`: Modified `showSessionSummary` function to conditionally handle agent tool

## Testing
The fix ensures that:
- Agent tool executions complete without erroneous error messages
- Other tools continue to show appropriate session ID status
- The informational message correctly explains that agent session IDs are not for resuming