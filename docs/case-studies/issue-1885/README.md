# Case Study — Issue #1885

**Title:** `--escalate` mode

**Issue:** https://github.com/link-assistant/hive-mind/issues/1885
**Pull Request:** https://github.com/link-assistant/hive-mind/pull/1890
**Status:** Implemented (experimental)

This folder is the deep case study for issue #1885, compiled as required by the
issue itself ("make sure we compile that data to `./docs/case-studies/issue-{id}`
folder, and use it to do deep case study analysis ... also make sure to search
online for additional facts and data"). It contains:

| File                                                 | Purpose                                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`README.md`](./README.md)                           | Overview, the verbatim problem, and the shipped solution at a glance                                                   |
| [`requirements.md`](./requirements.md)               | The exhaustive, numbered list of every requirement extracted from the issue, each mapped to where it is satisfied      |
| [`analysis.md`](./analysis.md)                       | Root-cause framing, design decisions, trade-offs, the early-stop heuristic, and the range-parsing ambiguity resolution |
| [`existing-components.md`](./existing-components.md) | Survey of existing in-repo components reused, plus external prior art / research evaluated (with online sources)       |
| [`model-ladder.md`](./model-ladder.md)               | The model ladder (haiku < sonnet < opus < fable), alias handling, and worked plan examples                             |

---

## The problem (verbatim from the issue)

> We should have `--escalate-from haiku` or `--escalate-from sonnet`
>
> So we first try to solve task fast and cheap using haiku, if it fails we do
> restart with sonnet, not haiku. And if sonnet fails again we switch to opus,
> and then if it also fails, we go to fable.
>
> That way we will try to iterate cheaply at first, so the more expensive models
> will use more reading and less writing. As there is a probability for small
> models to do everything mostly right, but now quite right.
>
> We should also be able to set upper bound like `--escalate sonnet-opus`, where
> `-` is just delimiter between lower and upper bound of models.
>
> By default `--escalate` should go as `--escalate sonnet-fable`.
>
> We also need to support `--escalate-steps` (which is by default 1), for example
> we can set it to 2 or more, so each level will be keep for longer for example 2
> working sessions of sonnet, after that 2 working sessions of opus and after that
> 2 working sessions of fable.
>
> We need to collect data related about the issue to this repository, make sure we
> compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do
> deep case study analysis (also make sure to search online for additional facts
> and data), list of each and all requirements from the issue, and propose
> possible solutions and solution plans for each requirement (we should also check
> known existing components/libraries, that solve similar problem or can help in
> solutions).
>
> Please plan and execute everything in this single pull request, you have
> unlimited time and context, as context auto-compacts and you can continue
> indefinitely, until it is each and every requirement fully addressed, and
> everything is totally done.

## The problem in one sentence

When a difficult task is handed straight to the most capable (most expensive)
model, we pay top-tier token prices for **all** of the writing — even though a
cheaper model often gets the bulk of the work **mostly** right. We want to
**start cheap and escalate only when work remains**, so the expensive models
spend their budget _reading and refining_ an existing draft instead of writing
everything from scratch.

## The solution at a glance

A new experimental option family on `solve`:

```bash
# Start on sonnet, escalate sonnet → opus → fable while unfinished work remains
solve <issue-url> --escalate

# Explicit range; '-' delimits the lower and upper bound
solve <issue-url> --escalate sonnet-opus

# Shortcut: start from haiku, escalate up to the top of the ladder
solve <issue-url> --escalate-from haiku

# Keep each tier for 2 working sessions before escalating
solve <issue-url> --escalate --escalate-steps 2
```

The model ladder, cheapest → most capable, is:

```
haiku  →  sonnet  →  opus  →  fable
```

**How it works.** The first regular solve session runs on the **lower bound** of
the range (the cheapest tier in the plan). After it finishes, the escalate loop
(`runEscalation` in `src/solve.escalate.lib.mjs`) re-scans the pull request for
**deferred / unfinished-work indicators** — reusing the exact detector that
powers `--keep-working-until-all-requirements-are-fully-done` (issue #1883). If
nothing remains, escalation **stops early** (the cheap model succeeded — we do
not waste the expensive models). If indicators remain, it restarts the AI tool on
the **next tier up**, with a prompt that tells the more capable model to review
what exists and finish everything in this single pull request. `--escalate-steps`
repeats each tier N times before climbing.

Because the loop builds directly on the same restart chokepoint
(`executeToolIteration`) as `--finalize` and `--keep-working`, it inherits PR
sync, error/usage-limit handling, and cleanup for free.

### Files changed

| File                            | Change                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/solve.escalate.lib.mjs`    | **New.** Pure parsing/planning helpers + the `runEscalation` orchestrator.                               |
| `src/solve.config.lib.mjs`      | New `--escalate`, `--escalate-from`, `--escalate-steps` options; normalization + initial-model override. |
| `src/solve.mjs`                 | Invoke `runEscalation` after the main solve (before finalize / keep-working).                            |
| `tests/test-escalate-1885.mjs`  | **New.** 41 network-free tests for the helpers, option definitions, and CLI integration.                 |
| `docs/CONFIGURATION*.md`        | Document the three options (en + ru/zh/hi siblings).                                                     |
| `docs/case-studies/issue-1885/` | **New.** This case study.                                                                                |
