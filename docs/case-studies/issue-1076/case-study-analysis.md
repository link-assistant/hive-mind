# Case Study: API Error - Claude's response exceeded the 32000 output token maximum

## Issue Reference

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1076
- **Date**: 2026-01-07
- **Severity**: High (causes session failure and lost work)

## Executive Summary

A Claude Code session failed with the error "API Error: Claude's response exceeded the 32000 output token maximum" after 26 turns and approximately 7 minutes of work (413,766ms). The session had accumulated 35,974 output tokens when it hit the hard limit, resulting in lost work and a cost of $1.016327.

The error message suggests setting the `CLAUDE_CODE_MAX_OUTPUT_TOKENS` environment variable to configure this behavior, but the full variable name was censored in the logs due to issue #1037 (false positives in token removal).

---

## Timeline of Events

### 2026-01-07T16:14:01.320Z - Normal Operation

- **Model**: claude-sonnet-4-5-20250929
- **Session ID**: 0676c625-1664-48ad-adec-327ac8da189c
- Claude was working on a media rewind bug investigation
- Last visible response discussed media player behavior and placeholder items
- Usage at this point:
  - input_tokens: 3
  - cache_creation_input_tokens: 476
  - cache_read_input_tokens: 56,410
  - output_tokens: 1 (just starting response)

### 2026-01-07T16:18:19.376Z - Token Limit Hit

- **Duration**: 4 minutes 18 seconds later
- Claude's response exceeded the 32000 output token maximum
- Error message returned:
  ```
  API Error: Claude's response exceeded the 32000 output token maximum.
  To configure this behavior, set the CLAUD*******************OKENS environment variable.
  ```
  (Note: Variable name censored due to issue #1037)

### 2026-01-07T16:18:19.382Z - Session Result

- **Final Statistics**:
  - Duration: 413,766ms (6.9 minutes)
  - API Duration: 469,983ms (7.8 minutes)
  - Number of turns: 26
  - Total cost: $1.016327

- **Token Usage**:
  - input_tokens: 76
  - cache_creation_input_tokens: 44,213
  - cache_read_input_tokens: 839,110
  - output_tokens: 35,974 (exceeded 32,000 limit)

- **Model Usage Breakdown**:
  - claude-haiku-4-5-20251001: $0.058957 (4,488 output tokens)
  - claude-sonnet-4-5-20250929: $0.95736975 (35,974 output tokens)

### 2026-01-07T16:18:19.844Z - Session Failure

- Exit code: 0 (misleading - the session actually failed)
- Error was detected but process didn't return non-zero exit code

---

## Root Cause Analysis

### Primary Cause: Output Token Limit Exceeded

1. **The 32,000 Token Limit**
   - Claude Code CLI has a default maximum output token limit of 32,000 tokens
   - The session generated 35,974 output tokens, exceeding this limit by ~4,000 tokens
   - When this limit is exceeded, the entire response is rejected

2. **Why Did Claude Generate So Many Tokens?**
   - The agent was in "experiment mode" creating comprehensive test scripts
   - The last message mentioned creating "a comprehensive experiment script to test with actual media"
   - Complex debugging tasks often require generating large amounts of code

3. **Model Capabilities vs CLI Defaults**
   According to [Anthropic's documentation](https://platform.claude.com/docs/en/about-claude/models/overview):
   - Claude Sonnet 4.5 max output: **64K tokens**
   - Claude Opus 4.5 max output: **64K tokens**
   - Claude Haiku 4.5 max output: **64K tokens**

   The 32K limit in Claude Code CLI is therefore an artificial constraint below the model's actual capability.

### Secondary Cause: Censored Error Message (Issue #1037)

The error message was censored:

```
CLAUD*******************OKENS
```

Should be:

```
CLAUDE_CODE_MAX_OUTPUT_TOKENS
```

This censorship is caused by false positives in the token removal logic (issue #1037), which incorrectly treats the environment variable name as a sensitive token.

---

## Impact Analysis

### Direct Impact

- **Lost Work**: ~7 minutes of Claude's analysis and code generation was lost
- **Cost Incurred**: $1.016327 spent with no successful output
- **User Frustration**: Error message was censored, making troubleshooting harder

### Indirect Impact

- **Workflow Disruption**: Session cannot be simply resumed; work must be redone
- **Budget Waste**: API tokens consumed without deliverable results
- **Debugging Difficulty**: Censored variable name requires external research

---

## Research: CLAUDE_CODE_MAX_OUTPUT_TOKENS

### Official Documentation

The environment variable `CLAUDE_CODE_MAX_OUTPUT_TOKENS` controls the maximum output token limit for Claude Code CLI responses.

### Configuration Methods

1. **Environment Variable (Shell)**:

   ```bash
   export CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
   ```

2. **Configuration File** (~/.claude/config.json):

   ```json
   {
     "env": {
       "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000"
     }
   }
   ```

3. **Per-Session**:
   ```bash
   CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000 claude -p "your prompt"
   ```

### Recommended Values by Model

| Model      | Default CLI Limit | Actual Model Max | Recommended Setting |
| ---------- | ----------------- | ---------------- | ------------------- |
| Sonnet 4.5 | 32,000            | 64,000           | 64,000              |
| Opus 4.5   | 32,000            | 64,000           | 64,000              |
| Haiku 4.5  | 32,000            | 64,000           | 64,000              |
| Bedrock    | 4,096             | varies           | 4,096 (minimum)     |

### Known Issues with CLAUDE_CODE_MAX_OUTPUT_TOKENS

Based on research from [GitHub Issues](https://github.com/anthropics/claude-code/issues):

1. **Issue #10738**: Output token limit settings not applied to agent subprocesses
   - The 32K limit is hardcoded for Task tool subagents
   - Parent environment configuration doesn't inherit

2. **Issue #9365**: Token limit capped at 32K even when set to 64K
   - Some versions cap the value regardless of configuration

3. **Issue #4510**: Sonnet models incorrectly validated against 32K limit
   - Validation was checking against 32K instead of 64K for Sonnet

4. **Issue #7927**: Environment variable not respected on Linux
   - Platform-specific bugs in reading the variable

---

## Proposed Solutions

### Solution 1: Set CLAUDE_CODE_MAX_OUTPUT_TOKENS (Immediate)

Configure the environment variable in the hive-mind solve execution:

```javascript
// In src/claude.lib.mjs or solve execution
process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '64000';
```

Or via system prompt guidance to avoid generating excessive output.

### Solution 2: Prompt Engineering (Workaround)

Add guidance to the system prompt to break up large outputs:

```
When generating large amounts of code or text:
- Split into multiple smaller tool calls
- Write files incrementally rather than in one large block
- Use the Edit tool for partial modifications instead of Write for full files
```

### Solution 3: Fix Token Censoring (Issue #1037)

Update the token removal logic to whitelist known safe patterns like environment variable names:

```javascript
// Whitelist patterns that should not be censored
const safePatternsRegex = /CLAUDE_CODE_[A-Z_]+|ANTHROPIC_[A-Z_]+/g;
```

### Solution 4: Add CLAUDE_CODE_MAX_OUTPUT_TOKENS to hive-mind

Add the environment variable configuration to the hive-mind solve command execution:

1. Add to `.env.example`:

   ```
   CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
   ```

2. Pass through when executing Claude CLI

---

## Lessons Learned

1. **Default Limits May Be Conservative**: The 32K default is well below model capabilities
2. **Error Messages Need Context**: Censoring helpful diagnostic information harms debugging
3. **Long Tasks Are Risky**: Sessions generating large outputs should chunk their work
4. **Environment Configuration Matters**: Default settings may not be optimal for all use cases

---

## References

### Official Documentation

- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)

### Related GitHub Issues

- [Issue #6158: Response Exceeds Maximum Output Token Limit](https://github.com/anthropics/claude-code/issues/6158)
- [Issue #10738: Output token limit settings not applied](https://github.com/anthropics/claude-code/issues/10738)
- [Issue #7927: Environment Variable Not Respected](https://github.com/anthropics/claude-code/issues/7927)
- [Issue #4510: Sonnet models incorrectly validated](https://github.com/anthropics/claude-code/issues/4510)
- [Issue #9365: Token limit capped at 32K](https://github.com/anthropics/claude-code/issues/9365)

### Related Blog Posts

- [API Error: Claude's response exceeded the 32000 output token maximum - Calvin's Dev Logs](https://calvin.my/posts/api-error-claude-s-response-exceeded-the-32000-output-token-maximum)

### Internal Issues

- [Issue #1037: False positives for token removal from logs](https://github.com/link-assistant/hive-mind/issues/1037)
