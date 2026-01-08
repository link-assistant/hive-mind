# Research Sources for Issue #1076

## Environment Variable: CLAUDE_CODE_MAX_OUTPUT_TOKENS

### Official Anthropic Documentation

From https://platform.claude.com/docs/en/about-claude/models/overview:

| Model             | Claude API ID              | Max Output |
| ----------------- | -------------------------- | ---------- |
| Claude Sonnet 4.5 | claude-sonnet-4-5-20250929 | 64K tokens |
| Claude Haiku 4.5  | claude-haiku-4-5-20251001  | 64K tokens |
| Claude Opus 4.5   | claude-opus-4-5-20251101   | 64K tokens |

Legacy models:
| Model | Max Output |
|-------|------------|
| Claude Opus 4.1 | 32K tokens |
| Claude Sonnet 4 | 64K tokens |
| Claude Opus 4 | 32K tokens |
| Claude Haiku 3 | 4K tokens |

### GitHub Issues

#### Issue #6158 - Response Exceeds Maximum Output Token Limit

- **URL**: https://github.com/anthropics/claude-code/issues/6158
- **Status**: CLOSED as DUPLICATE
- **Date**: August 2025
- **Key Findings**:
  - Error occurs during claude-code operations
  - Solution: Set CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable
  - MCP tool responses also have 25,000 token limit
  - Duplicated to Issue #4002

#### Issue #10738 - Output token limit settings not being applied

- **URL**: https://github.com/anthropics/claude-code/issues/10738
- **Version**: Claude Code 2.0.30
- **Key Findings**:
  - Environment variables not respected by agent subprocesses
  - 32K limit is hardcoded for Task tool subagents
  - Config file settings also ignored
  - Critical impact: loss of synthesized output after 20+ minutes

#### Issue #7927 - Environment Variable Not Respected

- **URL**: https://github.com/anthropics/claude-code/issues/7927
- **Key Findings**:
  - Environment variable gets ignored on some platforms (Linux)
  - Platform-specific bugs in reading the variable

#### Issue #4510 - Sonnet models incorrectly validated

- **URL**: https://github.com/anthropics/claude-code/issues/4510
- **Key Findings**:
  - Validation incorrectly uses 32K limit for Sonnet (should be 64K)
  - Values above 32K trigger error regardless of model

#### Issue #9365 - Token limit capped at 32K

- **URL**: https://github.com/anthropics/claude-code/issues/9365
- **Version**: v2.0.14
- **Key Findings**:
  - Even when set to 64K, limit gets capped to 32K
  - Bug in version 2.0.14

### Blog Posts

#### Calvin's Dev Logs

- **URL**: https://calvin.my/posts/api-error-claude-s-response-exceeded-the-32000-output-token-maximum
- **Solutions Provided**:
  1. Optimize prompts to reduce output
  2. Increase token limit via environment variable:
     ```bash
     export CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
     claude -r
     ```
  3. Switch to Sonnet for better compatibility with higher limits

### Configuration Methods

#### Environment Variable

```bash
# Shell
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000

# Windows PowerShell
[System.Environment]::SetEnvironmentVariable('CLAUDE_CODE_MAX_OUTPUT_TOKENS', '64000', 'User')
```

#### Config File (~/.claude/config.json)

```json
{
  "env": {
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000"
  }
}
```

### AWS Bedrock Specific

For Amazon Bedrock users:

```bash
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096
export MAX_THINKING_TOKENS=1024
```

Note: Bedrock has burndown throttling with minimum 4096 tokens as max_token penalty.

## Token Censoring Issue (#1037)

The error message in the logs showed:

```
CLAUD*******************OKENS
```

This is caused by overly aggressive token removal logic that incorrectly identifies environment variable names as sensitive tokens. The actual variable name is:

```
CLAUDE_CODE_MAX_OUTPUT_TOKENS
```

Related patterns that may be affected:

- `ANTHROPIC_API_KEY`
- `CLAUDE_*` variables
- Other configuration tokens
