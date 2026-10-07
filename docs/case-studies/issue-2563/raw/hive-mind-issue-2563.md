# We got some strange situation here, needs investigating

https://github.com/link-foundation/command-stream/pull/206#issuecomment-6018806079
https://github.com/link-foundation/command-stream/pull/206#issuecomment-6018754327
https://github.com/link-foundation/command-stream/pull/206#issuecomment-6018810946

First of all we need to find out what exactly caused inability to make auto-merge. The link to the issue was clear in the pull request description, so issue would be closed on merge.

Also it is strange what we provide solution log twice.

If after first solution logs we have more logs we can combine the message about failed auto-merge with latest solution log, but no need to duplicate already provided:

```
This log file contains the complete execution trace of the AI solution draft process.

💰 Cost estimation:

Model: GPT-6.1 Sol
Provider: OpenAI
Public pricing estimate: $4.553812
📊 Context and tokens usage:

357.3K input tokens across requests (cumulative, larger than the 200K context window, so not one request's context), 73.2K / 128K (57%) output tokens
Total: (357.3K + 10.1M cached) input tokens, 73.2K output tokens, $4.553812 cost

🤖 Models used:

Tool: OpenAI Codex
Requested: gpt-6.1-sol
Thinking level: xhigh (~31999 tokens)
Model: GPT-6.1 Sol (gpt-6.1-sol)
```

Also looks like we have obsolete format:

```
🤖 Solution Draft Log

This log file contains the complete execution trace of the AI solution draft process.

🤖 Models used:

Tool: OpenAI Codex
Requested: gpt-6.1-sol
Thinking level: xhigh (~31999 tokens)
Model: GPT-6.1 Sol (gpt-6.1-sol)
```

Which never should be used in all our codebase. The latest format of solution log for all tools must provide Cost estimation, Context and tokens usage, Models used, in a unified way, we should deduplicate as much code as possible.
