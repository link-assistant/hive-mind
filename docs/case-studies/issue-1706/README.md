# Issue 1706 Case Study: Cap Claude/Codex sub-session size at 150k tokens and disable 1M context by default

## Summary

Issue #1706 asks Hive Mind to default its agent runs to compact, well-bounded
sub-sessions instead of riding new Claude/Codex 1M-token context windows. Two
behaviors are wanted out-of-the-box:

1. **Cap the sub-session size between auto-compaction events at 150k tokens**.
   The new option must accept absolute token counts (`150k`, `1m`,
   `200000`), percentages of the model context window (`50%`), and the special
   value `default` to fall back to the tool's built-in threshold.
2. **Disable the 1M extended context window by default** so models stay on
   their standard 200K-400K window. This preserves reasoning quality and
   avoids the long-context price tier. Both behaviors must be opt-out via
   explicit flags.

The fix adds two CLI options that work for both `--tool claude` and
`--tool codex`:

- `--sub-session-size` (string, default `150k`)
- `--disable-1m-context` (boolean, default `true`)

For Claude Code there are no CLI flags for either behavior, so the wrapper
sets environment variables before spawning `claude`. For Codex CLI both
behaviors are exposed via the existing `-c key=value` mechanism.

## Artifacts

- Issue data: `raw/issue-1706.json`
- Issue comments: `raw/issue-1706-comments.json`
- Research notes: `research-sources.json`

## Timeline

- 2026-04-28 — Konstantin Diachenko opens issue #1706 (labels: `bug`,
  `documentation`, `enhancement`). The issue notes that newer Claude / Codex
  versions allow up to 1M tokens, that this is expensive and degrades
  reasoning quality, and asks for a 150k default sub-session cap plus a 1M
  opt-out.
- 2026-04-28 — Branch `issue-1706-454ed5890b77` is created and PR #1707 is
  opened as a draft.
- This PR — Adds `src/sub-session-size.lib.mjs`, registers
  `--sub-session-size` and `--disable-1m-context` in `solve.config.lib.mjs`,
  wires them into Claude Code (env vars) and Codex (`-c` overrides),
  documents both options in `docs/CONFIGURATION.{md,zh.md,hi.md,ru.md}`, and
  adds `tests/test-issue-1706-sub-session-size.mjs` (50 unit assertions).

## Requirements (from issue #1706)

R1. Default `--sub-session-size 150k` so that Claude/Codex sub-sessions
between compaction events do not balloon to 1M tokens.

R2. Accept token counts (`150k`, `200000`, `1.5m`), percentages (`50%`), and
the special value `default` for `--sub-session-size`.

R3. Default `--disable-1m-context` to true so the standard 200K-400K window
is used unless the user opts in. Provide `--no-disable-1m-context` to allow
1M.

R4. Both options must apply to **both** `--tool claude` and `--tool codex`.

R5. Compile case study data, timeline, requirements, root cause analysis, and
solution plan in `docs/case-studies/issue-1706/`.

R6. If diagnostics are insufficient on a real host, add verbose output for
the new env vars / `-c` overrides so future regressions are easy to spot.

R7. If other repositories are involved (Claude Code, Codex CLI), document
the upstream feature requests they should track.

## Root Cause Analysis

Hive Mind never opted out of the default behavior in either upstream tool:

- **Claude Code** auto-compacts at ~95% of the model's context window. With
  Sonnet 4.6 / Opus 4.7 supporting 1M tokens, that means a single sub-session
  can grow to nearly 1M tokens before compaction kicks in. The 1M variant is
  also tied to higher pricing on prompts > 200K input tokens (`context_over_200k`
  pricing). For headless agent runs this is both expensive and degrades
  reasoning (longer haystack, more recall errors).

- **Codex CLI** uses model-default context windows and compaction thresholds.
  Without explicit `-c model_context_window=...` or
  `-c model_auto_compact_token_limit=...` overrides, runs inherit whatever
  default the model exposes, which on newer Codex models can also reach
  ~1M tokens.

There was no way for a Hive Mind operator to centrally cap the sub-session
size or opt out of 1M context across the whole `hive` queue.

## Solution Plan

We add a single library, `src/sub-session-size.lib.mjs`, with a parser
(`parseSubSessionSize`) and adapters that translate the parsed descriptor to
each tool's native control surface:

| Behavior                         | Claude Code                                                                                      | Codex                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Disable 1M context               | `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (env, no CLI flag)                                            | `-c model_context_window=200000`                 |
| Cap sub-session size at N tokens | `CLAUDE_CODE_AUTO_COMPACT_WINDOW=N` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=pct`                      | `-c model_auto_compact_token_limit=N`            |
| Cap sub-session size at p%       | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=p` (clamped to ≤ 95) + `CLAUDE_CODE_AUTO_COMPACT_WINDOW=window` | `-c model_auto_compact_token_limit=window*p/100` |
| `default`                        | no env vars set; tool's built-in threshold preserved                                             | no `-c` overrides emitted                        |

### Claude Code semantics

Per https://code.claude.com/docs/en/env-vars,
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` only **lowers** the default ~95%
threshold; values above the default are silently ignored
(see [anthropics/claude-code#31806](https://github.com/anthropics/claude-code/issues/31806)).
We therefore clamp the computed percentage to 95 when projecting an absolute
token count back to a percentage. The combination of
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` lets us
treat the override as an absolute cap regardless of the model's actual
context window.

### Codex semantics

Codex exposes both knobs as ordinary `-c key=value` config entries
(https://developers.openai.com/codex/config-reference). They are appended to
the existing `-c` chain after `model_reasoning_effort`/`model_reasoning_summary`.

### Verbose diagnostics (R6)

When `--verbose` is set, `claude.lib.mjs` and `codex.lib.mjs` log the env
vars / `-c` args that were applied:

```
📊 CLAUDE_CODE_DISABLE_1M_CONTEXT: 1
📊 CLAUDE_CODE_AUTO_COMPACT_WINDOW: 150000
📊 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: 75
```

```
📊 Codex --disable-1m-context: -c model_context_window=200000
📊 Codex --sub-session-size: -c model_auto_compact_token_limit=150000
```

This makes it trivial to confirm on any real host that the option made it
all the way to the spawned tool process without re-instrumenting the code.

## Upstream / cross-repository follow-ups (R7)

The implementation depends on env vars and config keys that Anthropic and
OpenAI already document, so no new upstream issues are required. Two existing
upstream requests are worth tracking:

- [`anthropics/claude-code#34126`](https://github.com/anthropics/claude-code/issues/34126)
  – per-model auto-compact thresholds.
- [`openai/codex#16068`](https://github.com/openai/codex/issues/16068) –
  setting `model_context_window` can interact poorly with compaction; we keep
  Hive Mind's defaults conservative (`200000`) to avoid that bug.

## Verification

`tests/test-issue-1706-sub-session-size.mjs` (50 assertions) covers the
parser, the env-var adapter (`getClaudeEnv` integration), the Codex `-c`
builder, and the `SOLVE_OPTION_DEFINITIONS` defaults. All tests pass:

```
=== parseSubSessionSize === ✅ (18 assertions)
=== applySubSessionSizeToClaudeEnv === ✅ (10 assertions)
=== applyDisable1mContextToClaudeEnv === ✅ (2 assertions)
=== buildCodexSubSessionSizeConfigArgs === ✅ (5 assertions)
=== buildCodexDisable1mContextConfigArgs === ✅ (3 assertions)
=== SOLVE_OPTION_DEFINITIONS === ✅ (4 assertions)
=== getClaudeEnv integration === ✅ (8 assertions)
Results: 50 passed, 0 failed
```

In addition, the existing `tests/test-docs-options-sync.mjs` and
`tests/test-docs-language-sync.mjs` suites pass, confirming the new options
are documented in all four CONFIGURATION translations.
