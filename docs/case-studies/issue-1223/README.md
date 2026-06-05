# Case Study: Issue #1223 - Support `opusplan`

## Summary

Add support for `opusplan` mode - a special model alias in Claude Code that uses Opus during plan mode and switches to Sonnet for execution. Additionally, support a separate `--plan-model` CLI flag for flexible model pairing.

## Background

### What is `opusplan`?

`opusplan` is a model alias in Claude Code that provides an automated hybrid approach to model selection:

- **In plan mode**: Uses the `opus` model (currently Opus 4.6) for complex reasoning and architecture decisions
- **In execution mode**: Automatically switches to `sonnet` (currently Sonnet 4.6) for code generation and implementation

The rationale is cost optimization while maintaining quality: Opus's superior reasoning for planning, and Sonnet's speed and cost efficiency for execution.

### Claude Code Documentation

From the [official docs](https://code.claude.com/docs/en/model-config):

```
opusplan  Special mode that uses opus during plan mode, then switches to sonnet for execution
```

### Configuration Methods in Claude Code

| Method               | Example                    |
| -------------------- | -------------------------- |
| At startup           | `claude --model opusplan`  |
| During session       | `/model opusplan`          |
| Environment variable | `ANTHROPIC_MODEL=opusplan` |
| Settings file        | `{ "model": "opusplan" }`  |

### Environment Variables

| Variable                         | Role                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`   | Model used for `opus` or for `opusplan` when Plan Mode is active       |
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

- `src/models/index.mjs` - Model registry, CLAUDE_MODELS map, validation logic (consolidated, Issue #1473)
- `src/claude.lib.mjs` - mapModelToId(), executeClaudeCommand()
- `src/config.lib.mjs` - isOpus46OrLater(), max output tokens, thinking budget, getClaudeEnv()
- `src/solve.config.lib.mjs` - CLI option definitions (--plan, --plan-model, --worker-model)
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
3. **Auto-switch to opusplan**: When `--plan-model` is specified, automatically switch to `opusplan` mode
4. **Dual env vars**: Set `ANTHROPIC_DEFAULT_OPUS_MODEL` (plan model) and `ANTHROPIC_DEFAULT_SONNET_MODEL` (execution model)

## Known Upstream Bug: `opusplan` Does NOT Actually Switch Models

### Discovery

On 2026-03-28, a real-world test using `solve --plan` (which expands to `--plan-model opus --model sonnet`) revealed that **Claude Code CLI does not actually switch to Opus during plan mode** when using `opusplan`.

### Evidence from Log Analysis

Full log: [`data/solution-draft-log-pr-1774738604493.txt`](data/solution-draft-log-pr-1774738604493.txt)

**Command executed** (line 8):

```
solve https://github.com/linksplatform/trees-rs/issues/20 --plan --attach-logs --verbose --no-tool-check --auto-accept-invite --tokens-budget-stats
```

**What hive-mind did correctly** (line 214, 452-453):

```
claude --output-format stream-json --verbose --dangerously-skip-permissions --model opusplan -p "..."
```

```
📊 opusplan: plan=claude-opus-4-6, exec=claude-sonnet-4-6
```

- Passed `--model opusplan` to Claude CLI
- Set `ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-6`
- Set `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6`

**What Claude Code CLI reported** (line 502):

```json
"model": "claude-sonnet-4-6"
```

**All API calls used sonnet** (never opus):

```
model: 'claude-sonnet-4-6'   (main model, lines 555, 769+)
model: 'claude-haiku-4-5-20251001'  (sub-agents, lines 769+)
```

**No Opus model was ever called in the entire session.**

### Timeline of Events

| Time      | Event                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| 22:51:44  | `solve --plan` invoked                                                                                           |
| 22:52:12  | hive-mind correctly builds command: `claude --model opusplan` with env vars                                      |
| 22:52:12  | Env vars set: `ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-6`, `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6` |
| 22:52:14  | Claude Code CLI v2.1.86 init event reports `"model": "claude-sonnet-4-6"` (NOT opus)                             |
| 22:52:14+ | All API calls use `claude-sonnet-4-6` (main) and `claude-haiku-4-5-20251001` (sub-agents)                        |
| 22:56:43  | Session ends. Models used: `claude-sonnet-4-6, claude-haiku-4-5-20251001`. Zero opus usage.                      |

### Root Cause Analysis

The bug is in **Claude Code CLI itself**, not in hive-mind. Claude Code CLI v2.1.86 does not properly implement the `opusplan` model switching when:

- Using the `-p` (print/non-interactive) flag
- Potentially in interactive mode as well (per upstream reports)

**Key finding**: The `opusplan` model alias is accepted by the CLI, but it simply resolves to `claude-sonnet-4-6` without enabling the plan-mode model switching behavior.

### Upstream Issues Confirming This Bug

Multiple users have reported this same bug across Claude Code versions 2.1.2 through 2.1.86:

| Issue                                                                                  | Version | Description                                                            |
| -------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------- |
| [anthropics/claude-code#16982](https://github.com/anthropics/claude-code/issues/16982) | 2.1.2+  | opusplan doesn't switch to Opus during plan mode (7+ confirmations)    |
| [anthropics/claude-code#35650](https://github.com/anthropics/claude-code/issues/35650) | Latest  | `/model opusplan` maps entirely to `claude-sonnet-4-6` for both phases |
| [anthropics/claude-code#33401](https://github.com/anthropics/claude-code/issues/33401) | Latest  | System prompt reports sonnet-4-6 in plan mode instead of opus-4-6      |
| [anthropics/claude-code#27183](https://github.com/anthropics/claude-code/issues/27183) | Latest  | 100% traffic routed to Opus (opposite problem in some configs)         |
| [anthropics/claude-code#25866](https://github.com/anthropics/claude-code/issues/25866) | 2.1.42  | Case-sensitive model name doesn't switch                               |
| [anthropics/claude-code#8358](https://github.com/anthropics/claude-code/issues/8358)   | 2.0.0+  | opusplan was removed from UI, had to be re-added                       |

### Impact

- Users expecting Opus-quality planning get Sonnet-quality instead
- No cost savings from the hybrid approach (or worse, some users report 100% Opus billing)
- The feature is documented but non-functional in many configurations

## Hive-Mind Implementation Status

### What Was Implemented (working correctly)

1. `opusplan` model alias in `src/models/index.mjs` - maps to 'opusplan' (passthrough)
2. `--plan` flag in `src/solve.config.lib.mjs` - shortcut for `--plan-model opus --worker-model sonnet`
3. `--plan-model` option - sets ANTHROPIC_DEFAULT_OPUS_MODEL
4. `--worker-model` alias for `--model` - sets ANTHROPIC_DEFAULT_SONNET_MODEL
5. `getClaudeEnv()` in `src/config.lib.mjs` - sets both env vars correctly
6. `executeClaudeCommand()` in `src/claude.lib.mjs` - passes `--model opusplan` with correct env

### What Needs to Be Added

1. **Runtime verification logging** - Log the model reported in Claude CLI's init event and warn if it doesn't match expectations
2. **Documentation of known upstream bug** - Make the limitation visible to users
3. **Upstream issue filed** - Track the bug on anthropics/claude-code specifically for `-p` mode

## Workarounds

Since `opusplan` is broken upstream, the practical workaround is:

- Use `--model opus` directly if Opus-quality is needed for the entire session
- The `--plan` / `--plan-model` flags are ready for when the upstream bug is fixed
- Runtime verification logging alerts users when opusplan silently falls back to sonnet

## Sources

- [Model configuration - Claude Code Docs](https://code.claude.com/docs/en/model-config)
- [CLI reference - Claude Code Docs](https://code.claude.com/docs/en/cli-reference)
- [What Actually Is Claude Code's Plan Mode? - Armin Ronacher](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/)
- [anthropics/claude-code#16982 - opusplan doesn't switch to Opus](https://github.com/anthropics/claude-code/issues/16982)
- [anthropics/claude-code#35650 - opusplan maps to sonnet for both phases](https://github.com/anthropics/claude-code/issues/35650)
- [anthropics/claude-code#33401 - system prompt reports wrong model](https://github.com/anthropics/claude-code/issues/33401)
- [anthropics/claude-code#8358 - opusplan removed in v2.0.0](https://github.com/anthropics/claude-code/issues/8358)
- [Gist: Full solution draft log](https://gist.github.com/konard/052ae6094a32e9e58e4aa8389766020b)
