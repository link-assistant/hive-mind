# Upstream source notes (accessed 2026-07-10)

These notes record the primary-source facts used in the issue 2038 case study.
Every claim below is quoted or paraphrased from the URLs cited. They are the
basis for the `--think` off / adaptive / effort-level decisions.

## OpenAI — Reasoning guide

Source: https://developers.openai.com/api/docs/guides/reasoning

- OpenAI reasoning models expose a `reasoning.effort` (a.k.a.
  `model_reasoning_effort`) parameter with **six** levels:
  - `none` — no reasoning; for latency-critical tasks.
  - `minimal` — minimal reasoning (support is model-dependent).
  - `low` — efficient reasoning with a modest latency increase.
  - `medium` — balanced quality/reliability/performance (the default for
    `gpt-5.5`).
  - `high` — deep reasoning for complex tasks.
  - `xhigh` — extensive reasoning for research / async workflows.
- `none` is an explicit, supported effort value: thinking can be fully turned
  **off** on OpenAI reasoning models. `minimal` sits just above `none` and is
  only available on some models (model-dependent).
- Reasoning models named in the guide: **GPT-5.6** (default recommendation),
  **GPT-5.5-Pro**, **GPT-5.5**, **GPT-5.4**, **GPT-5.4-Mini**. The o-series and
  Codex reasoning models are the same `reasoning.effort` family. Codex CLI
  exposes the same ladder plus `max`/`ultra` for GPT-5.6 Sol (see issue 2027).

Implication for hive-mind: for Codex/OpenAI, `--think off` maps cleanly to
`model_reasoning_effort=none` — a real, structural off. `minimal` is a genuine
missing level between `none` and `low` that should be mappable.

## Anthropic — Adaptive thinking

Source: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking

- Adaptive thinking (`thinking: {type: "adaptive"}`) lets Claude decide when and
  how much to think per request. It is the recommended mode on Opus 4.8, Opus
  4.7, Opus 4.6, Sonnet 5, and Sonnet 4.6, and the **only** mode on Fable 5 and
  Mythos 5.
- Three thinking modes and their availability (from the "Adaptive vs manual vs
  disabled thinking" table):
  - **Adaptive** — `thinking: {type: "adaptive"}`.
  - **Manual** — `thinking: {type: "enabled", budget_tokens: N}`. Available on
    all models **except** Fable 5, Mythos 5, Sonnet 5, Opus 4.8, and Opus 4.7
    (they reject it with a 400). Deprecated on Opus 4.6 and Sonnet 4.6.
  - **Disabled** — `thinking: {type: "disabled"}`. Available on all models
    **except Fable 5, Mythos 5, and Mythos Preview.** These three cannot turn
    thinking off at all.
- Per-model specifics:
  - **Fable 5 / Mythos 5** — adaptive always on; `thinking:{type:"disabled"}`
    is **not supported**. Cannot disable thinking → adaptive-only.
  - **Mythos Preview** — adaptive is the default; `disabled` is **not
    supported**; manual `enabled` still accepted. Cannot disable → adaptive-only.
  - **Opus 4.8 / Opus 4.7** — adaptive is the _only_ supported mode; thinking is
    **off unless** you explicitly set `thinking:{type:"adaptive"}`; manual
    `enabled` is rejected (400). `disabled` is supported (thinking off is the
    default state).
  - **Opus 4.6** — adaptive off unless explicitly set; manual `enabled` accepted
    but deprecated; `disabled` supported.
  - **Sonnet 5** — adaptive on by default; pass `{type:"disabled"}` to turn it
    off; manual `enabled` rejected (400).
  - **Sonnet 4.6** — adaptive off unless explicitly set; manual `enabled`
    accepted but deprecated; `disabled` supported.
  - **Opus 4.5 / Sonnet 4.5 (and older)** — do **not** support adaptive; require
    manual `{type:"enabled", budget_tokens: N}`; `disabled` supported.
- Effort acts as **soft guidance** in adaptive mode. At `high` (default) and
  `max`, Claude almost always thinks; at lower efforts it may skip thinking on
  simple queries. `low` is the minimum effort — it minimizes but does not
  guarantee zero thinking.

Implication for hive-mind: `--think off` is a real off (via `disabled` or the
default off state) on every Claude model **except** Fable 5, Mythos 5, and
Mythos Preview. For those three, off is impossible and must be interpreted as
adaptive (lowest effort as the best-effort minimum). `--think adaptive` should
only succeed on adaptive-capable models and must fail fast on models that do not
support adaptive thinking (e.g. Opus 4.5 / Sonnet 4.5 and older).

## Anthropic — Effort levels

Source: https://platform.claude.com/docs/en/build-with-claude/effort

- The `effort` parameter (`output_config.effort`) is supported on Fable 5,
  Mythos 5, Opus 4.8, Mythos Preview, Opus 4.7, Opus 4.6, Sonnet 5, Sonnet 4.6,
  and Opus 4.5. No beta header required.
- Levels: `low`, `medium`, `high` (default; identical to omitting the
  parameter), `xhigh`, `max`.
  - `xhigh` availability: **Fable 5, Mythos 5, Opus 4.8, Opus 4.7, Sonnet 5**
    only.
  - `max` availability: Fable 5, Mythos 5, Opus 4.8, Mythos Preview, Opus 4.7,
    Opus 4.6, Sonnet 5, Sonnet 4.6 (i.e. broadly available).
- Effort affects **all** output tokens (text, tool calls, and thinking). It does
  not require thinking to be enabled, and it is a behavioral signal, not a strict
  token budget — at low effort Claude still thinks on hard problems, just less.
- There is **no `none` / `minimal` effort level** in the Anthropic effort API.
  The lowest control is `low`. Anthropic's off is expressed through the thinking
  mode (`disabled`), not through an effort level. Claude Code's `ultracode` is
  not a separate API level — it pairs `xhigh` with multi-agent permissions.

Implication for hive-mind: the Anthropic side cannot express `none`/`minimal`
as effort. `--think off` must use `disabled`/zero budget where allowed and fall
back to the lowest effort (`low`) on adaptive-only models. `--think minimal`, if
we add it, maps to Codex `minimal` but to the nearest Claude control (`low`
effort / a very small budget), since Anthropic has no `minimal` effort.

## Consolidated model support matrix

"Off possible?" = can thinking be fully turned off (structurally) for this
model. "Adaptive?" = does the model support adaptive thinking. "Effort levels" =
supported effort/reasoning-effort values.

### Anthropic (Claude)

| Model          | Off possible?              | Adaptive?        | Effort levels                 |
| -------------- | -------------------------- | ---------------- | ----------------------------- |
| Opus 4.8       | Yes (adaptive off default) | Yes (only mode)  | low, medium, high, xhigh, max |
| Opus 4.7       | Yes (adaptive off default) | Yes (only mode)  | low, medium, high, xhigh, max |
| Opus 4.6       | Yes (`disabled`)           | Yes (opt-in)     | low, medium, high, max        |
| Opus 4.5       | Yes (`disabled`)           | No (manual only) | low, medium, high, max        |
| Sonnet 5       | Yes (`disabled` explicit)  | Yes (default on) | low, medium, high, xhigh, max |
| Sonnet 4.6     | Yes (`disabled`)           | Yes (opt-in)     | low, medium, high, max        |
| Mythos Preview | **No** (disabled rejected) | Yes (default)    | low, medium, high, max        |
| Fable 5        | **No** (disabled rejected) | Yes (only, on)   | low, medium, high, xhigh, max |
| Mythos 5       | **No** (disabled rejected) | Yes (only, on)   | low, medium, high, xhigh, max |
| Haiku (4.x)    | Yes (`disabled`/manual)    | No (manual only) | n/a (effort not listed)       |

Models where off is IMPOSSIBLE (must be treated as adaptive): **Fable 5,
Mythos 5, Mythos Preview.**

### OpenAI (Codex / GPT-5.x reasoning models)

| Model         | Off possible? | `minimal`?      | Effort levels                                                 |
| ------------- | ------------- | --------------- | ------------------------------------------------------------- |
| GPT-5.6 / Sol | Yes (`none`)  | Yes (model-dep) | none, minimal, low, medium, high, xhigh (+max/ultra in Codex) |
| GPT-5.5-Pro   | Yes (`none`)  | Yes (model-dep) | none, minimal, low, medium, high, xhigh                       |
| GPT-5.5       | Yes (`none`)  | Yes (model-dep) | none, minimal, low, medium, high, xhigh                       |
| GPT-5.4       | Yes (`none`)  | Yes (model-dep) | none, minimal, low, medium, high, xhigh                       |
| GPT-5.4-Mini  | Yes (`none`)  | Yes (model-dep) | none, minimal, low, medium, high, xhigh                       |

For OpenAI, `none` is a real structural off on every listed model; `minimal`
is the extra low tier (support is model-dependent). Codex additionally exposes
`max` and `ultra` for GPT-5.6 Sol (issue 2027).

## Related hive-mind work

- Issue 2038 (this): https://github.com/link-assistant/hive-mind/issues/2038
- PR 2039 (this): https://github.com/link-assistant/hive-mind/pull/2039
- Issue 2032 — omitted `--think` means off:
  https://github.com/link-assistant/hive-mind/issues/2032
- Issue 2027 — GPT-5.6 Sol default + predictable levels + `ultra`:
  https://github.com/link-assistant/hive-mind/issues/2027
- Issue 1620 / 1238 — effort levels & thinking budget mapping.
- Issue 1875 / 2003 — adaptive-only models (Sonnet 5 / Fable 5 / Mythos 5).
  </content>
