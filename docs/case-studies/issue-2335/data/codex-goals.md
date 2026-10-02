# Codex native-goal research notes

Source: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex

Checked: 2026-09-30. These are investigation notes, not a copy of the source article.

The official cookbook describes persistent thread objectives with measurable completion conditions, evidence and constraints. Goals can be paused, resumed, cleared or completed, and token budgets constrain their execution. The examples cover long investigations and repeated implementation/verification work. Goal state complements a task prompt and survives work across turns.

The documented interactive commands include `/goal`, `/goal pause`, `/goal resume` and `/goal clear`. App-server goal handling is separate from an arbitrary command-line flag. The local Codex 0.159.2 generated schema archived beside these notes confirms `thread/goal/set` with `threadId`, `objective`, `status` and `tokenBudget`; `codex exec --help` does not expose `--goal`.

Implementation choice: enable `features.goals=true` in both existing Codex adapters. Prompt the running tool to set the complete-delivery objective through an exposed native API. Where that interface is unavailable, retain the objective and checklist in the work plan. Keep the merge-time evidence guard independent of model stopping behavior.
