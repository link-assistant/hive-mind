## Problem and resulting behavior

`solve --tool codex --model gpt-6.1-sol --think off` previously sent `model_reasoning_effort=none`, which the API rejected with HTTP 400. Effort selection now uses the selected model's exact capabilities: unsupported disabled thinking falls back to supported `auto` or the nearest tier (`low` for GPT-6.1 Sol), supported settings are preserved, and unknown capability sets use the configured model default.

## Changes

- Preserve effort arrays/defaults in live catalogues; reuse the shared one-hour cache and retain explicit CLI/router capabilities for future models. Runtime selection does not start a router or probe inference endpoints.
- Bundle verified current Codex capabilities and GPT-6.1 Sol's model ID, while preserving documented `none` support omitted from some CLI picker lists.
- Apply the shared resolver to native execution/resume, connection checks, agent-commander and organization planning. Filter planning capabilities by its existing `xhigh` ceiling before nearest-tier selection. Reuse existing Claude configuration in commander/planning to handle adaptive-only budgets and supported `xhigh` settings.
- Keep rollout-token caps only when the final effort is `ultra`; add verbose-only fallback/source diagnostics and a patch changeset.
- Refresh existing stale `command-stream`/`start-command`/`@dotenvx/dotenvx` pins and their fixtures to satisfy the repository's mandatory dependency-freshness check.

## Reproduction and tests

The minimal regression failed before the fix with `none !== low`. Separate tests reproduced an invalid adaptive-only Claude token budget and ignored gateway capabilities. New default-suite tests cover every nonempty effort subset, explicit/default/budget settings, future/unknown models, malformed/stale/offline metadata, gateway/direct isolation, custom CLI binaries and native new/resumed command construction. Final review added failing/passing planning-ceiling and connection rollout-cap regressions; the latter captures actual fake-CLI subprocess arguments. The reproducer and native tests do not run inference.

```sh
node tests/issue-2526-reasoning-effort.test.mjs
node tests/issue-2526-model-capabilities.test.mjs
node tests/issue-2526-native-codex.test.mjs
node experiments/issue-2526/reproduce.mjs
```

All 547 default-suite test files pass locally and in CI against final source commit `220b0009`. CI also passes the GitHub integration test, Docker image/tool/nested-container verification, CodeQL, npm audit, lint, formatting, syntax, duplication, secrets, memory, documentation and release/dependency checks. All three implementation workflows are green: [Checks](https://github.com/link-assistant/hive-mind/actions/runs/37369373277), [Security](https://github.com/link-assistant/hive-mind/actions/runs/37369373033) and [link checking](https://github.com/link-assistant/hive-mind/actions/runs/37369373006). [Latest PR checks](https://github.com/link-assistant/hive-mind/pull/2527/checks) cover the final evidence update.

## Investigation

[Case study, evidence and timeline](https://github.com/link-assistant/hive-mind/blob/issue-2526-977f266926a4/docs/case-studies/issue-2526/README.md) · [Validation record](https://github.com/link-assistant/hive-mind/blob/issue-2526-977f266926a4/docs/case-studies/issue-2526/validation.md) · [Upstream metadata report with reproducer, workaround and code suggestions](https://github.com/openai/codex/issues/44219#issuecomment-6000649081).

CI exposed five pre-existing stale dependency pins, which were refreshed. A subsequent command-stream release during final CI required one additional pin/fixture update; final-head verification is in progress. The case study preserves failed reproductions, unavailable prior-solver evidence, runner-acquisition cancellations during GitHub's Actions outage, and the successful verification after service recovery. No test timeout or check was relaxed.

Fixes #2526.
