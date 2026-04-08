# Case Study: Update Free Models for `--tool agent` and Set `qwen3.6-plus-free` as Default

**Issue:** [#1543](https://github.com/link-assistant/hive-mind/issues/1543)
**Upstream PR:** [agent#234](https://github.com/link-assistant/agent/pull/234)

## Problem Statement

OpenCode Zen added two new free models (`qwen3.6-plus-free` and `nemotron-3-super-free`) that were not reflected in hive-mind's model configuration, tests, or documentation. The upstream agent repository (PR #234) already made these changes:

1. Changed the default model from `minimax-m2.5-free` (~200K context) to `qwen3.6-plus-free` (~1M context)
2. Added `nemotron-3-super-free` (~262K context) to the free models list

Hive-mind needed to sync these changes to stay aligned with the upstream agent CLI.

## New Models

### Qwen 3.6 Plus Free (`opencode/qwen3.6-plus-free`)

- **Developer:** Alibaba (Qwen team)
- **Architecture:** Hybrid linear attention + sparse Mixture-of-Experts (MoE)
- **Context Window:** ~1,000,000 tokens
- **Output Limit:** 65,536 tokens
- **Key Features:** Always-on chain-of-thought reasoning, native function calling, 1M context
- **Release:** March 31, 2026 (preview on OpenRouter)
- **Open Weights:** Yes

**Why it's the new default:** Its ~1M context window is 5x larger than `minimax-m2.5-free` (~200K), resulting in fewer compaction cycles and better long-running agent performance for issue-solving tasks.

Sources:

- [Qwen 3.6 Plus Preview on OpenRouter](https://openrouter.ai/qwen/qwen3.6-plus-preview)
- [Qwen 3.6 Blog Post](https://qwen.ai/blog?id=qwen3.6)
- [Qwen 3.6 Plus Review (BuildFastWithAI)](https://www.buildfastwithai.com/blogs/qwen-3-6-plus-preview-review)

### Nemotron 3 Super Free (`opencode/nemotron-3-super-free`)

- **Developer:** NVIDIA
- **Architecture:** Mamba2-Transformer Hybrid Latent MoE with Multi-Token Prediction (MTP)
- **Parameters:** 120B total / 12B active
- **Context Window:** ~262,144 tokens (native support up to 1M)
- **Output Limit:** 262,144 tokens
- **Key Features:** 5x throughput vs previous Nemotron, NVFP4 quantization, linear-time complexity for long sequences
- **Data Cutoff:** Pre-training June 2025, post-training February 2026
- **Open Weights:** Yes

Sources:

- [NVIDIA Nemotron 3 Super Blog](https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/)
- [NVIDIA Nemotron 3 Super on OpenRouter](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b:free)
- [NVIDIA NIM Model Card](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard)

## Context Window Comparison (OpenCode Zen Free Models, April 2026)

| Model                 | Context    | Output  | Notes                                 |
| --------------------- | ---------- | ------- | ------------------------------------- |
| big-pickle            | ~200,000   | 128,000 | Stealth model, free during evaluation |
| minimax-m2.5-free     | ~200,000   | 131,072 | Former default, general-purpose       |
| nemotron-3-super-free | ~262,144   | 262,144 | NVIDIA hybrid Mamba-Transformer       |
| gpt-5-nano            | ~400,000   | 128,000 | OpenAI, smallest GPT-5 variant        |
| qwen3.6-plus-free     | ~1,000,000 | 65,536  | **New default**, largest context      |

## Solution

### Changes Made

| Area        | File                            | Change                                                                                                         |
| ----------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Core**    | `src/models/index.mjs`          | Add new models to agentModels, AGENT_MODELS, freeToBaseModelMap, primaryModelNames; change defaultModels.agent |
| **Docs**    | `docs/FREE_MODELS.md`           | Add new models, update default references, usage examples                                                      |
| **Docs**    | `README.md`                     | Update free model examples                                                                                     |
| **Tests**   | `tests/test-free-models.mjs`    | Add new models to test arrays, update default model test                                                       |
| **Docs**    | `docs/case-studies/issue-1543/` | This case study                                                                                                |
| **Release** | `.changeset/`                   | Changeset for minor version bump                                                                               |

### Backward Compatibility

- `minimax-m2.5-free` remains fully supported as a model choice
- All existing model aliases continue to work
- The only behavioral change is the default: users who don't specify `--model` will now get `qwen3.6-plus-free` instead of `minimax-m2.5-free`

## Related Issues and PRs

- [agent#232](https://github.com/link-assistant/agent/issues/232) - Upstream issue
- [agent#234](https://github.com/link-assistant/agent/pull/234) - Upstream PR (reference for this change)
- [hive-mind#1391](https://github.com/link-assistant/hive-mind/issues/1391) - Previous default change (minimax-m2.5-free)
- [hive-mind#1473](https://github.com/link-assistant/hive-mind/issues/1473) - Model consolidation to single source of truth
