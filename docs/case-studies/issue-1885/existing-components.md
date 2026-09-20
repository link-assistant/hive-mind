# Existing components & prior art — Issue #1885

The issue asks us to "check known existing components/libraries that solve similar
problems or can help in solutions" and to "search online for additional facts and
data". This file records both the **in-repo components reused** and the **external
prior art** evaluated.

## 1. In-repo components reused (no reinvention)

| Component                                                    | Where                                     | How `--escalate` reuses it                                                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executeToolIteration(params)`                               | `src/solve.restart-shared.lib.mjs`        | The single chokepoint that dispatches to the AI tool. Each escalation restart is one `executeToolIteration` call with an overridden `argv.model`/`fallbackModel`. |
| `isApiError` / `isUsageLimitReached`                         | `src/solve.restart-shared.lib.mjs`        | Classify each restart result to drive the consecutive-error cap and usage-limit stop.                                                                             |
| `collectDeferredWorkSources` / `detectDeferredWorkInSources` | `src/solve.keep-working*.lib.mjs`         | The token-cheap "did the cheap model finish?" signal (issue #1883). No indicators ⇒ stop early; indicators ⇒ escalate.                                            |
| `claudeModels` / `resolveDefaultFallbackModel`               | `src/models/index.mjs`                    | Map the short ladder names (`sonnet`→`claude-sonnet-4-6`, …) and compute the fallback model for each escalated tier.                                              |
| `SOLVE_OPTION_DEFINITIONS` + `parseArguments`                | `src/solve.config.lib.mjs`                | Single source of truth for CLI options; escalate adds three entries and a normalization block, inheriting help text, typo-suggestions and docs-sync.              |
| `runAutoEnsureRequirements` / `runKeepWorkingUntilDone`      | `src/solve.auto-ensure*`, `keep-working*` | **Architectural templates.** `runEscalation` mirrors their post-solve restart-loop shape (PR sync, feedback injection, cleanup, session bookkeeping).             |
| `applyRestartResult`                                         | `src/solve.mjs`                           | Folds the escalate loop's `{sessionId, cost, pricing}` back into the run totals, exactly like the other restart loops.                                            |

The net effect: `--escalate` is ~one new pure module plus three option entries and
a single call site. The expensive, well-tested machinery (tool dispatch, PR sync,
error handling) is **entirely reused**.

## 2. External prior art (online research)

`--escalate` is a concrete instance of the **LLM cascade** / **model routing**
pattern. The broader literature confirms both the value and the central pitfalls,
and informed several design choices.

### What the literature says

- **Cascades start cheap and escalate on low confidence.** Multi-model cascading
  tries a fast, cheap model first and escalates to a more expensive model only
  when confidence is below a threshold; a typical 3-tier cascade can cut cost
  substantially while preserving quality. This is exactly the haiku → sonnet →
  opus → fable progression the issue describes.
  ([Model Cascade — E.D.D.I docs](https://docs.labs.ai/agent-configuration/model-cascade),
  [Model Routing guide — pristren.com](https://pristren.com/blog/model-routing-guide/),
  [Top 5 LLM Routing Techniques — getmaxim.ai](https://www.getmaxim.ai/articles/top-5-llm-routing-techniques/))

- **The hard part is the escalation decision, and self-reported confidence is
  poorly calibrated.** Cascade routing's two problems are added latency (sequential
  calls) and the fact that LLM self-confidence scores are not well-calibrated.
  ([LLM Routing in production — TianPan.co](https://tianpan.co/blog/2025-10-19-llm-routing-production))
  → **Our response:** we do **not** rely on a model's self-assessed confidence.
  We use an artifact-based, token-free signal (the deferred-work detector) to
  decide whether to escalate. See [`analysis.md`](./analysis.md) §3.

- **Deciding "is this task hard enough" up front is non-trivial; letting the cheap
  model attempt first and escalating on failure is a legitimate strategy.** "The
  approach can either use static task metadata, or let the cheap model attempt
  first and escalate on failure." Getting the up-front difficulty estimate wrong
  means you either "burn frontier-API money on trivial work" or "let a cheap model
  flail on something it can't do".
  ([Agentic coding in production — TianPan.co](https://tianpan.co/blog/2026-04-09-agentic-coding-production-swebench-gap))
  → **Our response:** we deliberately chose the **attempt-then-escalate** branch,
  which matches the issue's "iterate cheaply at first" framing, and we cap retries
  and consecutive errors so a cheap model cannot "flail" unboundedly.

- **Cheap/lower-tier models benefit far more from iteration/retries than frontier
  models do.** Lower-performing models show much larger pass@1 → pass@5 gains than
  top-tier models. This supports spending the first (cheap) sessions iterating, and
  only escalating when iteration stops yielding a clean result.
  ([Beyond Resolution Rates — arXiv 2604.02547](https://arxiv.org/pdf/2604.02547),
  [Agentic coding in production — TianPan.co](https://tianpan.co/blog/2026-04-09-agentic-coding-production-swebench-gap))
  → **Our response:** `--escalate-steps` lets a tier iterate for N sessions before
  climbing, so a cheap tier gets its iteration budget before we pay to escalate.

- **A decision-theoretic treatment of cascades exists** (cost-quality frontier,
  shadow prices), and notes that a pre-generation router can sometimes beat a
  cascade by skipping the cheap model's generation cost on clearly-hard queries.
  ([Is Escalation Worth It? — arXiv 2605.06350](https://arxiv.org/abs/2605.06350))
  → **Relevance:** a pre-generation router is a possible future enhancement
  (predict the starting tier from issue features) but is out of scope here; the
  issue specifically asks for attempt-then-escalate. Noted as future work in the
  PR, not deferred work within the requested feature.

### Why not pull in an external routing library

The surveyed tools (LiteLLM routing, RouteLLM-style routers, E.D.D.I model
cascade) operate at the **single-request** layer: route one prompt/completion to a
model based on a classifier or confidence score. `--escalate` operates at the
**working-session** layer of an agentic coding loop, where the escalation signal is
"the PR still has unfinished work" rather than "this completion looks low
confidence". The repo already owns the session-restart machinery and the
artifact-based signal, so an external request-router would not fit the unit of work
and would duplicate, not replace, existing code.

## Sources

- [Model Cascade — E.D.D.I Documentation](https://docs.labs.ai/agent-configuration/model-cascade)
- [Model Routing: How to Cut LLM Costs 50–70% — pristren.com](https://pristren.com/blog/model-routing-guide/)
- [Top 5 LLM Routing Techniques — getmaxim.ai](https://www.getmaxim.ai/articles/top-5-llm-routing-techniques/)
- [LLM Routing: How to Stop Paying Frontier Model Prices for Simple Queries — TianPan.co](https://tianpan.co/blog/2025-10-19-llm-routing-production)
- [Agentic Coding in Production: What SWE-bench Scores Don't Tell You — TianPan.co](https://tianpan.co/blog/2026-04-09-agentic-coding-production-swebench-gap)
- [Is Escalation Worth It? A Decision-Theoretic Characterization of LLM Cascades — arXiv:2605.06350](https://arxiv.org/abs/2605.06350)
- [Beyond Resolution Rates: Behavioral Drivers of Coding Agent Success and Failure — arXiv:2604.02547](https://arxiv.org/pdf/2604.02547)
