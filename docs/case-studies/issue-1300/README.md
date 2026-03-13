# Case Study: Update Support for Free Models

**Issue:** [#1300](https://github.com/link-assistant/hive-mind/issues/1300)
**Related PR:** [agent#191](https://github.com/link-assistant/agent/pull/191)
**Date:** February 2026
**Status:** In Progress

## Summary

This case study documents the investigation and resolution of free model availability discrepancies in hive-mind documentation and code. The changes align with the updates made in the agent repository (PR #191).

## Problem Statement

Based on [agent PR #191](https://github.com/link-assistant/agent/pull/191), the free model offerings from OpenCode Zen and Kilo Gateway have changed:

1. `minimax-m2.5-free` replaced `minimax-m2.1-free` on OpenCode Zen
2. `glm-4.7-free` is no longer free on OpenCode Zen
3. Kilo Gateway has updated their free model offerings with new models

## Research Findings

### OpenCode Zen Current Free Models

**Source:** [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)

Current free models on OpenCode Zen (February 2026):

| Model             | Model ID                     | Status             | Notes                            |
| ----------------- | ---------------------------- | ------------------ | -------------------------------- |
| Kimi K2.5 Free    | `opencode/kimi-k2.5-free`    | Free (recommended) | Best for coding tasks            |
| MiniMax M2.5 Free | `opencode/minimax-m2.5-free` | Free               | Upgraded from M2.1               |
| GPT 5 Nano        | `opencode/gpt-5-nano`        | Free               | OpenAI-powered                   |
| Big Pickle        | `opencode/big-pickle`        | Free               | Stealth model, evaluation period |

**Discontinued free models:**

- `opencode/minimax-m2.1-free` - No longer free (replaced by M2.5)
- `opencode/glm-4.7-free` - No longer free on OpenCode Zen

### Kilo Gateway Current Free Models

**Source:** [Kilo Free Models Documentation](https://kilo.ai/docs/advanced-usage/free-and-budget-models)

Current free models on Kilo Gateway (February 2026):

| Model                 | Model ID                     | Context Window | Notes                       |
| --------------------- | ---------------------------- | -------------- | --------------------------- |
| GLM-5                 | `kilo/glm-5-free`            | 202,752 tokens | Flagship, free limited time |
| GLM 4.5 Air           | `kilo/glm-4.5-air-free`      | 131,072 tokens | Agent-centric               |
| MiniMax M2.5          | `kilo/minimax-m2.5-free`     | 204,800 tokens | Upgraded from M2.1          |
| DeepSeek R1           | `kilo/deepseek-r1-free`      | 163,840 tokens | Reasoning model             |
| Giga Potato           | `kilo/giga-potato-free`      | 256,000 tokens | Evaluation model            |
| Trinity Large Preview | `kilo/trinity-large-preview` | 131,000 tokens | Arcee AI preview            |

**Note:** `kilo/glm-4.7-free`, `kilo/kimi-k2.5-free`, and `kilo/minimax-m2.1-free` are no longer the recommended free models.

## Changes Required

### 1. Documentation Updates

**docs/FREE_MODELS.md:**

- Replace `opencode/minimax-m2.1-free` with `opencode/minimax-m2.5-free`
- Remove `opencode/glm-4.7-free` from free models
- Update Kilo Gateway free models list
- Add DeepSeek R1, GLM 4.5 Air to Kilo
- Document discontinued models

**README.md:**

- Update free model examples in Telegram Bot section

### 2. Code Updates

**src/model-validation.lib.mjs:**

- Add `minimax-m2.5-free` to AGENT_MODELS
- Add `kilo/minimax-m2.5-free`, `kilo/glm-4.5-air-free`, `kilo/deepseek-r1-free`
- Keep deprecated models for backward compatibility (with warnings)

**src/model-mapping.lib.mjs:**

- Add new model mappings
- Update Kilo Gateway model mappings

## Key Insights

1. **Model versioning differs between providers:** OpenCode Zen upgraded from M2.1 to M2.5 for the free tier, while Kilo has added new models.

2. **Free model availability is dynamic:** Free models come and go based on provider partnerships and promotional periods.

3. **Backward compatibility:** Old model names should still work but may route to different endpoints or show deprecation warnings.

4. **Provider parity:** Both OpenCode Zen and Kilo Gateway now offer `minimax-m2.5-free`, enabling provider flexibility.

## External References

- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
- [Kilo Gateway Free Models](https://kilo.ai/docs/advanced-usage/free-and-budget-models)
- [GLM-5 Announcement](https://kilo.ai/landing/new-glm-models)
- [Agent PR #191](https://github.com/link-assistant/agent/pull/191)

## Testing Recommendations

To verify free model availability:

```bash
# Test OpenCode Zen free models
solve https://github.com/owner/repo/issues/123 --tool agent --model kimi-k2.5-free
solve https://github.com/owner/repo/issues/123 --tool agent --model minimax-m2.5-free

# Test Kilo Gateway free models
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/deepseek-r1-free
```

## Resolution

This case study serves as documentation for the changes needed to update hive-mind's free model support in alignment with the upstream agent repository changes.
