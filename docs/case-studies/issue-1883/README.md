# Case Study — Issue #1883

**Title:** Auto restart/resume on "out of scope", "future work", "deferred", "delayed", planned for other pull requests

**Issue:** https://github.com/link-assistant/hive-mind/issues/1883
**Pull Request:** https://github.com/link-assistant/hive-mind/pull/1884
**Status:** Implemented (experimental)

This folder is the deep case study for issue #1883, compiled as required by the
issue itself ("make sure we compile that data to `./docs/case-studies/issue-{id}`
folder, and use it to do deep case study analysis"). It contains:

| File                                                 | Purpose                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`README.md`](./README.md)                           | Overview, the verbatim problem, and the shipped solution at a glance                                              |
| [`requirements.md`](./requirements.md)               | The exhaustive, numbered list of every requirement extracted from the issue, each mapped to where it is satisfied |
| [`analysis.md`](./analysis.md)                       | Root-cause framing, design decisions, trade-offs, and the false-positive / infinite-loop risk analysis            |
| [`existing-components.md`](./existing-components.md) | Survey of existing in-repo components reused, plus external prior art / libraries evaluated                       |
| [`indicators.md`](./indicators.md)                   | The catalogue of deferred-work indicator patterns, with rationale and real-world examples                         |

---

## The problem (verbatim from the issue)

> For example: https://github.com/link-assistant/model-in-browser/pull/12#issuecomment-4668421995
>
> ```
> Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.
> ```
>
> We should use this prompt in addition to detected reason.
>
> We should find in pull request description and in everything that is unfinished or planned or delayed to next pull request and do auto-restart.
>
> We should have this as experimental option `--keep-working-until-all-requirements-are-fully-done`.
>
> And we should use regular expressions or peg grammar or similar (partial parsing, find occurrence), to find strong indicators for delayed and deferred work.
>
> So we don't waste any tokens, we just check pull request description, solution summary (posted as comment by AI and auto extracted) and also markdown documents that were changed.
>
> Also we should ignore false positives for now [...] But we should limit it with 5 auto-restarts by default in case of errors.
>
> By default if `--keep-going-until-all-requirements-are-fully-done` is provided we treat it as `--keep-going-until-all-requirements-are-fully-done 5` [...] we should also support values like `forever`, `unlimited` and so on [...]

## The problem in one sentence

When an AI solver finishes a run, it frequently **declares partial victory** — it
writes "this is out of scope", "left as future work", "will be addressed in a
follow-up PR", or sprinkles `TODO`s — instead of finishing the whole task in the
single pull request it was given. There is no follow-up PR in this workflow, so
that deferred work is simply **lost**.

## The shipped solution at a glance

A new **experimental** flag for `solve`:

```bash
solve <issue-url> --keep-working-until-all-requirements-are-fully-done
solve <issue-url> --keep-working-until-all-requirements-are-fully-done 5
solve <issue-url> --keep-working-until-all-requirements-are-fully-done forever
# short aliases:
solve <issue-url> --keep-working
solve <issue-url> --keep-going unlimited
```

After the main solve (and any `--finalize` cycle) completes, the feature:

1. **Collects three cheap, token-free sources** — the PR description, the
   in-memory AI solution summary, and the _added_ lines of changed markdown
   documents.
2. **Scans them with ~14 deferred-work regular expressions** (`out of scope`,
   `future work`, `follow-up PR`, `deferred`, `delayed`, `TODO`, `TBD`, ... — see
   [`indicators.md`](./indicators.md)).
3. If indicators are found, **auto-restarts the AI tool** with the concrete
   detected reasons **plus the verbatim reinforcement prompt** from the issue.
4. Repeats until **no indicators remain** or the **restart limit** is reached.

Limit semantics: bare flag → **5**; an explicit number → that many; `forever` /
`unlimited` / `infinite` / `0` → **no limit** (with a hard safety cap of 3
_consecutive_ errors so a broken tool can never spin forever).

### Where it lives in the code

| Concern                                                  | File                                            |
| -------------------------------------------------------- | ----------------------------------------------- |
| Pure detection + normalization (unit-tested, no network) | `src/solve.keep-working.detect.lib.mjs`         |
| Orchestration (source collection + restart loop)         | `src/solve.keep-working.lib.mjs`                |
| CLI option + value normalization                         | `src/solve.config.lib.mjs`                      |
| Wiring into the post-solve flow                          | `src/solve.mjs`                                 |
| Typo suggestions for the new option names                | `src/option-suggestions.lib.mjs`                |
| Tests                                                    | `tests/test-keep-working-until-done-1883.mjs`   |
| User docs                                                | `docs/CONFIGURATION.md` (+ `.ru`, `.zh`, `.hi`) |

## Online prior art consulted

- **Todo PR Checker** and **PR Todo Checker** GitHub Actions detect `TODO`/`FIXME`
  items in PR diffs using configurable regexes and report them in a comment —
  confirming that simple regex/"find occurrence" scanning of PR changes is the
  established, low-cost approach (the issue explicitly asked for "regular
  expressions or peg grammar or similar (partial parsing, find occurrence)").
  Our feature generalises this from code `TODO`s to natural-language deferral
  indicators and, crucially, _acts_ on them by restarting the agent rather than
  only commenting.
- Research on long-horizon LLM agents (e.g. the LOOP / Agent-R1 lines of work)
  notes that autonomous agent loops "continue until the agent generates no tool
  calls (task completion) or encounters an error" and warns that agents can "get
  stuck in infinite loops" — which is exactly why this feature pairs aggressive
  recall with **bounded** restarts and a consecutive-error cap.

Sources:

- [Todo PR Checker (GitHub Marketplace)](https://github.com/marketplace/todo-pr-checker)
- [NikkelM/Todo-PR-Checker](https://github.com/NikkelM/Todo-PR-Checker)
- [PR Todo Checker Action](https://github.com/marketplace/actions/pr-todo-checker)
- [What Is Out Of Scope Work? (Ignition)](https://www.ignitionapp.com/blog/what-is-out-of-scope-work-and-how-to-avoid-it)
- [Reinforcement Learning for Long-Horizon Interactive LLM Agents (LOOP)](https://medium.com/@sarthak221995/paper-explained-easy-reinforcement-learning-for-long-horizon-interactive-llm-agents-76d613de4b6e)
- [Tool Execution and Agent Loop (DeepWiki)](https://deepwiki.com/yetone/avante.nvim/4.3-tool-execution-and-agent-loop)
