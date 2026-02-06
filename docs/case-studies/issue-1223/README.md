# Case Study: Issue #1223 - Support `opusplan`

## Summary

Add support for `opusplan` mode - a special model alias in Claude Code that uses Opus during plan mode and switches to Sonnet for execution. Additionally, support a separate `--plan-model` CLI flag for flexible model pairing.

## Background

### What is `opusplan`?

`opusplan` is a model alias in Claude Code that provides an automated hybrid approach to model selection:

- **In plan mode**: Uses the `opus` model (currently Opus 4.6) for complex reasoning and architecture decisions
- **In execution mode**: Automatically switches to `sonnet` (currently Sonnet 4.5) for code generation and implementation

The rationale is cost optimization while maintaining quality: Opus's superior reasoning for planning, and Sonnet's speed and cost efficiency for execution.

### Claude Code Documentation

From the [official docs](https://code.claude.com/docs/en/model-config):

```
opusplan  Special mode that uses opus during plan mode, then switches to sonnet for execution
```

### Configuration Methods in Claude Code

| Method | Example |
|--------|---------|
| At startup | `claude --model opusplan` |
| During session | `/model opusplan` |
| Environment variable | `ANTHROPIC_MODEL=opusplan` |
| Settings file | `{ "model": "opusplan" }` |

### Environment Variables

| Variable | Role |
|----------|------|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Model used for `opus` or for `opusplan` when Plan Mode is active |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Model used for `sonnet` or for `opusplan` when Plan Mode is not active |

## Requirements from Issue

1. **Primary**: Support `--model opusplan` as a valid model alias
2. **Secondary**: Support `--plan-model opus` with `--model sonnet` for flexible model pairing
3. **Investigation**: Explore possibility of arbitrary plan-model + execution-model combinations

## Technical Analysis

### Current Model Handling Architecture

The codebase has a well-structured model handling pipeline:

```
CLI Arguments (--model) → yargs parsing → validateModelName() → mapModelToId() → executeClaudeCommand()
```

Key files involved:
- `src/model-validation.lib.mjs` - CLAUDE_MODELS map, validation logic
- `src/model-mapping.lib.mjs` - Unified model mapping
- `src/claude.lib.mjs` - mapModelToId(), executeClaudeCommand()
- `src/config.lib.mjs` - isOpus46OrLater(), max output tokens, thinking budget
- `src/solve.config.lib.mjs` - CLI option definitions
- `src/hive.config.lib.mjs` - Hive CLI option definitions

### How `opusplan` Works in Claude Code

In Claude Code's internal implementation:
1. `opusplan` is recognized as a special model alias
2. When passed as `--model opusplan`, Claude Code internally:
   - Uses Opus for planning subagent operations
   - Uses Sonnet for code execution tasks
3. The switching is handled by Claude Code itself - the model alias is passed directly

### Implementation Strategy

Since `opusplan` is handled by Claude Code internally:
1. **Model validation**: Add `opusplan` as a valid alias that maps to itself (passthrough)
2. **CLI option**: Add `--plan-model` for explicit plan model specification
3. **Execution**: When `--plan-model` is specified, set `ANTHROPIC_DEFAULT_OPUS_MODEL` env var

## Known Issues and History

- [Issue #6108](https://github.com/anthropics/claude-code/issues/6108): Automatic model switching was non-functional (fixed Oct 2025)
- [Issue #8358](https://github.com/anthropics/claude-code/issues/8358): `opusplan` was removed from UI in v2.0.0, but continued working via settings
- [Issue #5990](https://github.com/anthropics/claude-code/issues/5990): `opusplan` fell back to Sonnet 3.7 instead of Sonnet 4 (fixed)
- As of current Claude Code versions, `opusplan` is a stable, first-class model alias

## Sources

- [Model configuration - Claude Code Docs](https://code.claude.com/docs/en/model-config)
- [CLI reference - Claude Code Docs](https://code.claude.com/docs/en/cli-reference)
- [What Actually Is Claude Code's Plan Mode? - Armin Ronacher](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/)
- [Bring back "opusplan" - Issue #8358](https://github.com/anthropics/claude-code/issues/8358)
