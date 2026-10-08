# Case study: cheapest pricing tier by default (issue #2771)

- Issue: https://github.com/link-assistant/hive-mind/issues/2771
- Pull request: https://github.com/link-assistant/hive-mind/pull/2772
- Date: 2026-10-08
- Tool versions checked locally: claude-code 2.1.293, codex-cli 0.161.0, gemini-cli 0.63.0, qwen-code 0.25.0

Files in this folder:

- [`online-research.md`](./online-research.md): vendor pricing, speed tiers and compaction settings, with sources and confidence levels.
- [`codex-service-tier-capture.txt`](./codex-service-tier-capture.txt): what Codex CLI actually puts on the wire, captured with [`experiments/issue-2771/codex-service-tier-capture.sh`](../../../experiments/issue-2771/codex-service-tier-capture.sh).

## 1. Problem

Every per-token price that hive-mind pays is multiplied by two things that the CLIs choose silently:

1. **Context length.** Several models bill a whole request at a higher rate once its prompt crosses a threshold (table below). The CLIs compact at 85-95% of a window of up to 1M tokens, so a long task runs straight into the expensive tier.
2. **Speed tier.** Fast / priority / Ultrafast cost 2x-8x the standard rate. Codex turns Fast on by default for some ChatGPT plans. Claude Code fast mode persists once a user enables it.

What hive-mind did before this change (base commit `d2f33b93`):

- Claude and Codex were already held below their cliffs. Since issue #1706, `--disable-1m-context` defaulted to `true` and `--sub-session-size` to `150k`. But Codex's window was clamped to 200K, below the 272K cheap tier. Reaching long context took two flags: a large `--sub-session-size` alone was silently clamped to 200K.
- Gemini and Qwen ignored `--sub-session-size` and kept their own 0.5 and 0.85 compaction fractions of a ~1M window, so long tasks crossed their cliffs.
- No speed option existed, so the speed tier was inherited from the user's plan or config.
- `opus` resolved to Opus 5 although Opus 5.5 is newer and cheaper.

## 2. Requirements from the issue

| #   | Requirement                                                                                                                                 | Where it is handled                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Use only short context for all models by default. Never use long context unless the user explicitly configures a bigger auto-compact limit. | `resolvePricingTier` / `resolveLongContext` in `src/pricing-tier.lib.mjs`; `--disable-1m-context` is now tri-state (default auto)             |
| R2  | Double check Anthropic, including older models, and every supported provider.                                                               | §3 audit table; per-model rules in `SHORT_CONTEXT_RULES`                                                                                      |
| R3  | Use exactly the maximum short context, the cheapest tier's whole size.                                                                      | Short windows are set to the tier boundary (200K / 100K / 272K / 200K / 256K); compaction defaults to 90% of it                               |
| R4  | Use the slowest / cheapest speed by default, in Claude, Codex and other tools.                                                              | New `--speed` option, default `standard`; Claude `CLAUDE_CODE_DISABLE_FAST_MODE=1`; Codex `-c service_tier=default`                           |
| R5  | Never use Fast / Ultrafast / priority by default, but keep them configurable.                                                               | `--speed fast` / `--speed ultrafast` (and `--speed flex` for the cheaper OpenAI tier)                                                         |
| R6  | Use default model names rather than `[1m]` names; add `[1m]` in the background only when the user asks for a much bigger sub-session.       | `resolveClaudeModelForContext`                                                                                                                |
| R7  | Default to the latest and cheapest Opus and Sol, and fully support all previous versions.                                                   | `opus` → `claude-opus-5-5` ($4/$20, cheaper than every other Opus); Codex default resolves to `gpt-6.1-sol` ($2/$10); all pinned aliases kept |
| R8  | Audit all currently available models.                                                                                                       | §3 and §5                                                                                                                                     |
| R9  | Write this case study, including online research and existing libraries.                                                                    | This folder                                                                                                                                   |
| R10 | Do everything in one pull request.                                                                                                          | PR #2772                                                                                                                                      |

## 3. Audit: where the price cliffs are

Prices are USD per 1M tokens. Details and sources are in `online-research.md`.

| Tool             | Model(s)                                                              | Long-context price cliff                                     | Tool's default compaction point                     | Crossed by default before this change?                                                                                                  | Short tier hive now holds to                                        |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Claude Code      | Opus 4.6+, Sonnet 4.6+, Fable, Mythos                                 | None at the API (1M at standard price since 2026-03-13)      | ~95% of 1M on native-1M models                      | No: since #1706 hive defaulted to `--disable-1m-context` (200K window) and `--sub-session-size 150k`                                    | 200K (`CLAUDE_CODE_DISABLE_1M_CONTEXT=1`)                           |
| Claude Code      | **Haiku 5.5** (the `haiku` alias since 2026-10-07)                    | **5x input and output above 100K input**                     | ~95% of 1M                                          | **Yes once `haiku` points to Haiku 5.5**: the 150k default compaction is above the 100K cliff                                           | 100K window, compacting at 90%                                      |
| Claude Code      | Opus 4.5, Sonnet 4.5, Haiku 4.5 and older                             | Former 1M beta premium above 200K; no 1M on Haiku 4.5        | ~95% of 200K                                        | No                                                                                                                                      | 200K                                                                |
| Codex CLI        | gpt-5.4 and later (gpt-5.5, 5.6-_, 6-_, 6.1-sol)                      | **2x input, 1.5x output above 272K input**                   | 90% of the catalog window (1.05M on current models) | No: hive clamped the window to 200K and compacted at 150K, so 72K of the cheap 272K tier went unused and percentages were taken of 200K | 272K (`-c model_context_window=272000`), so Codex compacts at ~245K |
| Codex CLI        | gpt-5.2, 5.1, 5, 5-mini, 5.4-mini/nano                                | None listed                                                  | 90%                                                 | No                                                                                                                                      | 272K (harmless: their windows are not larger)                       |
| Gemini CLI       | Pro models (2.5 Pro, 3.1 Pro)                                         | **2x input, 1.5x output above 200K**                         | 0.5 x 1,048,576 = 524K                              | **Yes**: `--sub-session-size` was not applied to Gemini at all                                                                          | `model.compressionThreshold` = 0.9 x 200K / 1,048,576 ≈ 0.1717      |
| Gemini CLI       | Flash, Flash-Lite (the hive default)                                  | None                                                         | 524K                                                | No                                                                                                                                      | Tool default (0.5)                                                  |
| Qwen Code        | qwen3-coder-plus / -flash (the hive default)                          | Four tiers; 256K-1M costs 6x input / 12x output of the first | 0.85 x 1M = 850K                                    | **Yes, into the top tier**: `--sub-session-size` was not applied to Qwen at all                                                         | `context.autoCompactThreshold` = 0.9 x 256K / 1M ≈ 0.2304           |
| OpenCode / agent | Default models are free (`grok-code-fast-1`, `nemotron-3-super-free`) | Inherits the provider                                        | Context almost full                                 | n/a for the free defaults                                                                                                               | Not changed (see §6)                                                |

Speed tiers:

| Tool          | Tiers and multipliers                                                      | Default before this change                                                                                                                                                     | Evidence                               |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Claude Code   | Fast mode 2x on Opus 4.8 / 5 / 5.5                                         | Off, but it persists once enabled (`/fast`) and can come from user settings                                                                                                    | Claude Code docs, §2.3 of the research |
| Codex CLI     | `flex` 0.5x, standard 1x, `fast` (sent as `priority`) 2x, `ultrafast` 6-8x | Fast on eligible ChatGPT plans; the gpt-6-sol and gpt-6-luna catalog entries carry `default_service_tier: "priority"`; any `service_tier` in `~/.codex/config.toml` is honored | Capture below and §5.3 of the research |
| Gemini / Qwen | No speed tier in the CLIs                                                  | n/a                                                                                                                                                                            | §6, §7                                 |

### Wire capture: Codex `service_tier`

`experiments/issue-2771/codex-service-tier-capture.sh` points Codex at a local mock Responses endpoint (`experiments/issue-2771/mock-llm-server.mjs`) with a throwaway `CODEX_HOME` and records each request body. The excerpt below is from `codex-service-tier-capture.txt`:

```
codex codex-cli 0.161.0 model=gpt-6-sol
no override (before #2771)                       requests:  1  service_tier: (omitted = standard)
hive default: -c service_tier=default            requests:  1  service_tier: (omitted = standard)
hive --speed fast: -c service_tier=fast          requests:  1  service_tier: priority
hive --speed flex: -c service_tier=flex          requests:  1  service_tier: flex
config.toml service_tier=fast, no override       requests:  1  service_tier: priority
config.toml service_tier=fast + hive default     requests:  1  service_tier: (omitted = standard)
```

What the capture shows:

- With API-key auth and no user config, Codex already sends the standard tier. The catalog's `default_service_tier: "priority"` is applied for ChatGPT-login plans, which a mock endpoint cannot exercise (research §5.3, PR openai/codex#19053).
- A `service_tier = "fast"` in the user's `config.toml` turns every request into `priority` (2x). `-c service_tier=default` overrides it and puts the request back on standard. Because of this, hive-mind now pins the tier on every run.
- `default` is Codex's sentinel for explicit standard routing: the field is left out of the request.

## 4. Root causes

1. **`--disable-1m-context` was a plain boolean with a fixed 200K window** (issue #1706). It kept Claude and Codex cheap, but it did not use the full 272K OpenAI tier. It also ignored an explicit large `--sub-session-size` unless `--no-disable-1m-context` was passed too. And it was never applied to Gemini or Qwen.
2. **No knowledge of per-model price cliffs.** The 272K OpenAI boundary, the Haiku 5.5 100K boundary, the Gemini Pro 200K boundary and the Qwen tiers were not modelled anywhere, so compaction thresholds were left to tools that optimise for quality, not cost.
3. **The speed tier was never set**, so it was inherited from the user's ChatGPT plan, their Codex `config.toml`, or a persisted Claude fast-mode toggle.
4. **Stale aliases.** `opus` mapped to `claude-opus-5` ($5/$25) although Opus 5.5 ($4/$20) is both newer and cheaper. `sonnet` and `haiku` lagged behind Claude Code's own alias targets (Sonnet 5.5, Haiku 5.5), so hive's metadata disagreed with what the CLI really ran.

## 5. Solution

All tier logic lives in one module, `src/pricing-tier.lib.mjs`, which every tool runner calls.

### 5.1 Deciding short vs long context

`resolvePricingTier({ tool, model, modelId, disable1mContext, subSessionSize, speed })` returns `{ speed, shortContextTokens, longContext, longContextReason }`. Long context is enabled, in this order, only by:

1. `--no-disable-1m-context` (explicit opt-in). `--disable-1m-context` forces short context.
2. A `[1m]` suffix on the model the user typed.
3. A `--sub-session-size` token count larger than the model's standard window (for example `--sub-session-size 500k`).

Anything else, including percentages and the `150k` default, stays on the short tier. A short-context run that asks for a sub-session larger than the tier allows is capped to 90% of the tier, and the cap is logged:

```
💰 Pricing tier: ... — --sub-session-size capped to 245000 tokens
```

### 5.2 Per tool

| Tool                                     | Short context (default)                                                                                                                                                                                   | Long context (opt-in)                                                                                                                                                                                                 | Speed                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Claude Code (direct and agent-commander) | `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`, `150k` default compaction; Haiku 5.5 is capped to `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=90`; plain model names                  | No `DISABLE_1M`; `[1m]` is added only for Opus 4.6 / Sonnet 4.6, the models that still need it. Rolling aliases like `opus[1m]` are passed as `opus`, because Claude Code 2.1.293 rejects `opus[1m]` and `sonnet[1m]` | `CLAUDE_CODE_DISABLE_FAST_MODE=1` unless `--speed fast/ultrafast`                                 |
| Codex CLI (direct and agent-commander)   | `-c model_context_window=272000` plus the `150k` default as `model_auto_compact_token_limit`; a larger short-context sub-session is capped at 90% of 272K (~245K); percentages are taken of 272K          | No window override; `--sub-session-size` tokens go to `model_auto_compact_token_limit`                                                                                                                                | `-c service_tier=default` (standard); `--speed flex/fast/ultrafast` maps to `flex/fast/ultrafast` |
| Gemini CLI                               | `--sub-session-size` is now applied: `150k` → `model.compressionThreshold` 0.1431. Pro is capped at 90% of 200K (0.1717); with `--sub-session-size default`, Flash gets the tool default 0.5 written back | Threshold from `--sub-session-size`                                                                                                                                                                                   | n/a                                                                                               |
| Qwen Code                                | `150k` → `context.autoCompactThreshold` 0.15. qwen3-coder-plus/flash is capped at 90% of 256K (0.2304); with `--sub-session-size default`, other models get the tool default 0.85 written back            | Threshold from `--sub-session-size`                                                                                                                                                                                   | n/a                                                                                               |

Gemini and Qwen read compaction only from settings files, so the value is written to the user settings file with the existing `ensureGeminiFamilySettings` helper (the same mechanism used for issue #2236). The file is shared between runs, so when nothing caps a run the tool's own default is written back. Otherwise a Pro run's cap would leak into a later Flash run. The trade-off: hive-mind now owns these two keys in the worker's settings file. The alternative, `GEMINI_CLI_SYSTEM_SETTINGS_PATH` / `QWEN_CODE_SYSTEM_SETTINGS_PATH`, overrides all other settings and would hide user settings entirely, so it was not used.

The values above are printed by [`experiments/issue-2771/default-compaction-table.mjs`](../../../experiments/issue-2771/default-compaction-table.mjs). The output is saved in [`default-compaction-table.txt`](./default-compaction-table.txt) and covers `150k` (the default), `default` (the tool's own threshold, capped to the tier) and `500k` (long context).

### 5.3 Models

| Alias                | Before                                            | After                                                 | Price (in/out)           |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------- | ------------------------ |
| `opus` (the default) | `claude-opus-5`                                   | `claude-opus-5-5`                                     | $5/$25 → $4/$20          |
| `sonnet`             | `claude-sonnet-5`                                 | `claude-sonnet-5-5`                                   | $2/$10 (same)            |
| `haiku`              | `claude-haiku-4-5-20251001`                       | `claude-haiku-5-5` (Claude Code's own `haiku` target) | $1/$5 → see note         |
| Codex default        | `gpt-6-sol`, resolved at runtime to `gpt-6.1-sol` | unchanged                                             | $2/$10, the cheapest Sol |

Note on Haiku 5.5: its long-prompt surcharge above 100K is why it gets the 100K window described above.

Added and kept:

- New pinned aliases: `opus-5-5`, `sonnet-5-5`, `haiku-5-5` and their `claude-*` IDs.
- New fallbacks: Sonnet 5.5 → `sonnet-5`, Haiku 5.5 → `haiku-4-5`.
- Escalation tiers know the new IDs.
- Every older alias (`opus-5`, `opus-4-8` … `opus-4-5`, `sonnet-5`, `sonnet-4-6`, `sonnet-4-5`, `haiku-4-5`, `haiku-3-5`, `haiku-3`) still resolves exactly as before.

### 5.4 Options

| Option                                             | Default      | Notes                                                                                                      |
| -------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `--disable-1m-context` / `--no-disable-1m-context` | auto (unset) | Auto = short context unless `--sub-session-size` asks for more than the short tier or the model has `[1m]` |
| `--speed flex\|standard\|fast\|ultrafast`          | `standard`   | Aliases: `default`, `normal`, `auto` → standard; `slow`, `economy` → flex; `priority` → fast               |

Both options are forwarded from `hive` to `solve` workers automatically.

#### Why `standard` and not `flex` by default

The issue asks for the slowest setting. Only OpenAI has a slower tier (`flex`, 0.5x), and it was left opt-in:

- Flex requests can fail with `429 Resource Unavailable` when capacity is short, and they can be much slower. Both would turn into failed or timed-out solve sessions.
- No vendor document confirms that ChatGPT-login Codex (the usual hive setup) honors `flex` or how it counts against plan limits (research, open question 3).
- Claude, Gemini and Qwen have no slower tier, so standard is already their cheapest.

`--speed flex` is available for anyone who wants it on API-key Codex.

## 6. Not changed, and why

- **OpenCode and `agent`.** The default models are free. OpenCode exposes only `compaction.reserved` (no threshold) and sends no service tier unless configured. A per-model limit override was not verified (research, open question 9), so no settings are written for these tools.
- **Claude `opusplan`.** It uses Claude Code's own aliases and inherits the same environment (fast mode off, 1M off).
- **Prices in hive's cost reports.** They come from models.dev, which already lists the new IDs.

## 7. Existing components and libraries considered

| Component                                                                                                                                                      | What it offers                                | Used?                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Claude Code env vars (`CLAUDE_CODE_DISABLE_1M_CONTEXT`, `CLAUDE_CODE_DISABLE_FAST_MODE`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`) | Official switches for context and speed       | Yes                                                                                                             |
| Codex `-c` overrides (`service_tier`, `model_context_window`, `model_auto_compact_token_limit`)                                                                | Per-run config without touching `config.toml` | Yes                                                                                                             |
| Gemini / Qwen settings files via `ensureGeminiFamilySettings` (issue #2236)                                                                                    | Merge-safe JSON settings writer               | Yes                                                                                                             |
| models.dev (`fetchModelInfo`)                                                                                                                                  | Context limits and prices per model           | Used only to size percentages on long-context Codex runs                                                        |
| LiteLLM `model_prices_and_context_window.json`                                                                                                                 | Community price table with some tiered prices | No: it does not model every cliff (for example Haiku 5.5 at 100K), and the vendor pages are the source of truth |
| OpenRouter / provider routers                                                                                                                                  | Can pick cheaper providers                    | Out of scope: hive talks to each vendor CLI directly                                                            |

## 8. Tests and evidence

- `tests/pricing-tier-2771.test.mjs` (15 tests) covers:
  - option defaults and speed normalization
  - short tiers per model and long-context resolution
  - sub-session capping
  - Claude env (fast mode off, 1M off, Haiku 5.5 window), and `[1m]` handling
  - catalog aliases
  - Codex args (`service_tier=default`, `model_context_window=272000`, a percentage of 272K, and the >272K opt-in)
  - agent-commander env and args
  - Gemini / Qwen thresholds and the settings-file merge
- Existing tests were updated for the new alias targets and the extra Codex args. Pinned-version assertions are unchanged.
- Experiments in `experiments/issue-2771/`:
  - `codex-service-tier-capture.sh` + `mock-llm-server.mjs`: the wire capture above.
  - `resolve-codex-default.mjs`: shows the Codex default resolves to `gpt-6.1-sol`.
  - `yargs-boolean-default.mjs`: shows a boolean with an `undefined` default stays tri-state.
  - `extract-claude-code-catalog.py`: reads the model catalog from an installed Claude Code bundle (run with `python3 -I`).
  - `debug-tier.mjs`: prints the resolved tier for a tool, model and options.

## 9. Open questions

These are documented in `online-research.md` ("Not verified"). The ones that matter for this change:

1. Which ChatGPT plans get Codex Fast by default today. The list comes from the server catalog, and hive now pins standard regardless.
2. Whether ChatGPT-login Codex honors `flex`. This is why flex is opt-in.
3. The current value of Gemini CLI's remote compression experiment. hive writes an explicit threshold, which takes precedence over the experiment default.
