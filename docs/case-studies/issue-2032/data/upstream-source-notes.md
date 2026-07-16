# Upstream source notes (accessed 2026-07-10)

## Anthropic

- Adaptive thinking: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
- Effort: https://platform.claude.com/docs/en/build-with-claude/effort

The official documentation describes `low` as the minimum adaptive-thinking
effort. Adaptive models may still think at that level; it is guidance rather
than a hard zero. Model generations differ: some support disabling thinking,
while always-adaptive models reject a disabled thinking configuration. The
portable best effort for the latter group is therefore the lowest supported
effort.

## OpenAI Codex

- Configuration source: https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs
- Protocol reasoning enum: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs

Codex exposes `model_reasoning_effort`; its source documents `none` as “no
reasoning” for an explicitly configured effort. Hive Mind can therefore
provide a hard off mapping for Codex rather than relying on the model's
provider default.

## Related Hive Mind work

- Issue 2027: https://github.com/link-assistant/hive-mind/issues/2027
- Pull request 2029: https://github.com/link-assistant/hive-mind/pull/2029

PR 2029 supplied the existing Codex resolver and `off` to `none` mapping. Issue
2032 builds on that work by normalizing the omitted CLI value and applying the
strongest safe off behavior across the shared tool contract.
