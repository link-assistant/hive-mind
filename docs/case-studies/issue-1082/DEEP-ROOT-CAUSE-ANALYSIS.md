# Deep Root Cause Analysis: PDF Token Limit in Claude Code CLI

**Date**: 2026-01-10
**Investigator**: AI Issue Solver
**Status**: Complete

## Executive Summary

The 25,000 token limit for file reading in Claude Code CLI is **a CLI-level implementation choice**, not an API or model architecture limitation. The Anthropic API supports much larger files (32MB, 100 pages for PDFs) and Claude models have context windows up to 200K tokens. The CLI imposes this artificial constraint to manage context efficiency, but it can be overridden via environment variables.

## The Three Layers of Limits

### Layer 1: Anthropic API Limits (Official)

Based on [Anthropic's official PDF support documentation](https://platform.claude.com/docs/en/build-with-claude/pdf-support):

| Limit Type                | Value         | Notes                         |
| ------------------------- | ------------- | ----------------------------- |
| Maximum request size      | **32MB**      | Entire payload including PDFs |
| Maximum pages per request | **100 pages** | Per PDF document              |
| Format                    | Standard PDF  | No password/encryption        |

**Token costs for PDFs:**

- Text extraction: **1,500-3,000 tokens per page** depending on content density
- Image conversion: Each page is also converted to an image (additional vision costs)
- A 100-page PDF could consume 150,000-300,000+ tokens

### Layer 2: Model Context Windows

| Model             | Context Window | Output Limit               |
| ----------------- | -------------- | -------------------------- |
| Claude Sonnet 4   | 200K tokens    | 8K tokens default, 64K max |
| Claude Opus 4.5   | 200K tokens    | 32K tokens default         |
| Claude 3.5 Sonnet | 200K tokens    | 8K tokens                  |

The models themselves can handle far more than 25,000 tokens.

### Layer 3: Claude Code CLI Limits (The Actual Constraint)

The 25,000 token limit is **hardcoded in Claude Code CLI**, not from the API:

```typescript
// Claude Code CLI internal implementation
const MAX_FILE_READ_TOKENS = 25000; // Hardcoded default
```

**Why this limit exists:**

1. **Context preservation** - Reading large files consumes context that could be used for reasoning
2. **Cost management** - Prevents accidental high API costs from reading massive files
3. **Response quality** - Too much context can degrade response quality
4. **Memory efficiency** - Prevents CLI memory issues with huge files

## Environment Variables to Override

Claude Code CLI provides several environment variables to override defaults:

| Variable                                  | Default | Purpose                               |
| ----------------------------------------- | ------- | ------------------------------------- |
| `MAX_MCP_OUTPUT_TOKENS`                   | 25,000  | Maximum tokens for MCP tool responses |
| `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` | 25,000  | Maximum tokens for Read tool          |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`           | 32,000  | Maximum output tokens from Claude     |

**Workaround command:**

```bash
export MAX_MCP_OUTPUT_TOKENS=250000
export CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=100000
claude
```

**Subscription-based practical limits:**

- 5x Max plan: ~88K effective token limit
- 20x Max plan: ~200K effective token limit

## Read Tool Behavior

The Read tool in Claude Code CLI has these characteristics:

| Feature             | Value                           |
| ------------------- | ------------------------------- |
| Default line limit  | 2,000 lines                     |
| Maximum line length | 2,000 characters (truncated)    |
| Token limit         | 25,000 tokens                   |
| Multimodal support  | Images, PDFs, Jupyter notebooks |
| PDF processing      | Page-by-page extraction         |

**Error message format:**

```
Error: File content (28375 tokens) exceeds maximum allowed tokens (25000).
Please use offset and limit parameters to read specific portions of the file,
or use the GrepTool to search for specific content.
```

## Does Limit Apply to All Files or Just PDFs?

**The 25,000 token limit applies to ALL file types**, not just PDFs:

- **Text files (.txt, .md, .json, etc.)**: Subject to 25,000 token limit
- **Code files (.py, .js, .ts, etc.)**: Subject to 25,000 token limit
- **PDF files**: Subject to 25,000 token limit PLUS 100-page API limit
- **Images**: Converted to base64, subject to image token calculations
- **Jupyter notebooks**: Cells extracted, subject to 25,000 token limit

**PDF-specific additional constraints:**

- API hard limit of 100 pages
- Each page converted to image + text extraction
- Higher token cost per page than text files

## Comparison with Other AI CLI Tools

### OpenCode CLI (sst/opencode)

- **Architecture**: TypeScript, client/server model
- **File handling**: Documentation doesn't specify token limits
- **Notable**: Supports multiple interfaces, extensible agent system
- **Limits**: Not explicitly documented; likely uses model defaults

### Gemini CLI (google-gemini/gemini-cli)

- **Context window**: **1M tokens** with Gemini 2.5 Pro
- **File handling**: Built-in file system operations
- **Token management**: Includes "Token Caching" feature
- **PDF support**: Accepts PDFs through multimodal capabilities
- **Advantage**: Much larger context window allows bigger files

### Qwen-Agent (QwenLM/qwen-agent)

- **Token management**: Configurable via `max_input_tokens` (e.g., 58,000)
- **Large document handling**: RAG-based approach for 1M+ token documents
- **File handling**: Direct file path support during initialization
- **Approach**: Retrieval-based chunking rather than full file loading

## Root Cause Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    "PDF too large" Error                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PROXIMATE CAUSE: CLI token counter exceeded 25,000 threshold   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ IMPLEMENTATION CAUSE: Hardcoded MAX_FILE_READ_TOKENS = 25000   │
│ in Claude Code CLI source code                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ DESIGN DECISION: Conservative default to prevent:               │
│ - Context exhaustion                                            │
│ - High API costs                                                │
│ - Response quality degradation                                  │
│ - Memory issues                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ NOT A ROOT CAUSE:                                               │
│ ✗ API limitation (API supports 32MB/100 pages)                 │
│ ✗ Model architecture (200K context window)                     │
│ ✗ PDF format limitation                                        │
└─────────────────────────────────────────────────────────────────┘
```

## The Infinite Error Loop Bug

A separate but related bug exists where after triggering "PDF too large":

1. The error corrupts the session state
2. ALL subsequent requests return the same error
3. Even unrelated commands fail
4. Session must be killed and restarted
5. All progress is lost

**This is NOT caused by the token limit itself**, but by improper error recovery in the CLI's state management.

Related issues:

- [#13518](https://github.com/anthropics/claude-code/issues/13518): Error persists and blocks all PDF reading
- [#11527](https://github.com/anthropics/claude-code/issues/11527): Oversized PDF kills the REPL
- [#6780](https://github.com/anthropics/claude-code/issues/6780): Irreversible session corruption

## Proposed Solutions

### For Users (Immediate)

1. **Set environment variables before starting Claude Code:**

   ```bash
   export MAX_MCP_OUTPUT_TOKENS=100000
   export CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=100000
   ```

2. **Pre-process large PDFs:**

   ```bash
   pdftotext large-document.pdf large-document.txt
   ```

3. **Split large PDFs:**

   ```bash
   pdftk large-document.pdf burst output page_%03d.pdf
   ```

4. **Use `/rewind` command** if error occurs interactively

### For Anthropic (Recommended Fixes)

1. **Dynamic limits based on model:**

   ```javascript
   function getMaxReadTokens(model, subscriptionTier) {
     if (model.includes('1m')) return 250000;
     if (model.includes('sonnet-4.5')) return 64000;
     if (model.includes('opus')) return 32000;
     return 25000; // default fallback
   }
   ```

2. **Pre-flight size check with warning:**

   ```
   Warning: PDF document.pdf (4.4MB, 372 pages) exceeds recommended limits.
   Options:
   1. Extract text only: pdftotext document.pdf
   2. Read specific pages: Read with offset/limit
   3. Continue anyway (may cause errors)
   Choose [1/2/3]:
   ```

3. **Fix error recovery** - Don't corrupt session state on errors

4. **Better documentation** - Document limits clearly in `--help` and docs

## Feature Request References

| Issue                                                            | Request                       | Status             |
| ---------------------------------------------------------------- | ----------------------------- | ------------------ |
| [#4002](https://github.com/anthropics/claude-code/issues/4002)   | Original 25K limit issue      | Closed             |
| [#7679](https://github.com/anthropics/claude-code/issues/7679)   | Increase to 50K               | Closed (duplicate) |
| [#14888](https://github.com/anthropics/claude-code/issues/14888) | Dynamic limits based on model | Open               |
| [#6910](https://github.com/anthropics/claude-code/issues/6910)   | Read tool default behavior    | Open               |

## Conclusion

**The 25,000 token limit is a CLI implementation choice, not an inherent limitation of the API or model architecture.**

| Layer           | Actual Limit     | Constraining Factor             |
| --------------- | ---------------- | ------------------------------- |
| Claude Code CLI | 25,000 tokens    | Hardcoded default (overridable) |
| Anthropic API   | 32MB / 100 pages | Official documented limit       |
| Claude Models   | 200K context     | Model architecture              |

Users can work around this by:

1. Setting `MAX_MCP_OUTPUT_TOKENS` environment variable
2. Pre-processing files before reading
3. Using chunked reading with offset/limit parameters

Anthropic should:

1. Make limits dynamic based on model/subscription
2. Improve error recovery to prevent session corruption
3. Add pre-flight checks with user-friendly warnings
4. Document limits clearly

## References

- [Anthropic PDF Support Documentation](https://platform.claude.com/docs/en/build-with-claude/pdf-support)
- [Claude Code Issue #4002](https://github.com/anthropics/claude-code/issues/4002) - Original 25K limit discussion
- [Claude Code Issue #14888](https://github.com/anthropics/claude-code/issues/14888) - Dynamic limits proposal
- [Claude Code Internal Tools Gist](https://gist.github.com/bgauryy/0cdb9aa337d01ae5bd0c803943aa36bd)
- [OpenCode CLI](https://github.com/sst/opencode)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Qwen-Agent](https://github.com/QwenLM/qwen-agent)
