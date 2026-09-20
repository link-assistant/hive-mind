# Existing Components & Prior Art — Issue #1883

The issue asked us to "check known existing components/libraries" before building.
This documents what was reused from inside the repo and what external prior art
informed the design.

## Reused from within this repository

| Component                                                                | File                                                                    | How it was reused                                                                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--finalize` auto-ensure loop (`runAutoEnsureRequirements`, issue #1383) | `src/solve.auto-continue.lib.mjs` family                                | Architectural template for a post-solve detect→restart loop. The keep-working loop mirrors its structure (collect signal → restart `executeToolIteration` → re-check). |
| `executeToolIteration` restart primitive                                 | `src/solve.*`                                                           | Each auto-restart drives one more tool iteration through the existing primitive instead of a new mechanism.                                                            |
| `isApiError`, `isUsageLimitReached`                                      | `src/solve.restart-shared.lib.mjs`                                      | Reused to detect terminal failures and break the loop (consecutive-error cap).                                                                                         |
| Pure-helper module idiom                                                 | e.g. `src/auto-iteration-limits.lib.mjs`                                | Pattern of a network-free `.detect.lib.mjs` paired with an orchestration `.lib.mjs`, so detection is unit-testable.                                                    |
| Central option registry + `lino-arguments`/yargs                         | `src/solve.config.lib.mjs`                                              | New flag registered here to inherit help, alias, typo-suggestion, and docs-sync support.                                                                               |
| Option typo suggestions                                                  | `src/option-suggestions.lib.mjs`                                        | `KNOWN_OPTION_NAMES` extended with the four new spellings.                                                                                                             |
| Docs-sync tests                                                          | `tests/test-docs-options-sync.mjs`, `tests/test-docs-language-sync.mjs` | Drove the requirement to document the flag in `CONFIGURATION.md` and its `.ru/.zh/.hi` siblings.                                                                       |

Reusing `--finalize`'s shape means the new feature inherits its battle-tested
restart/error handling instead of reinventing it.

## External prior art evaluated

### Regex-based TODO/deferral scanners (directly analogous)

- **[NikkelM/Todo-PR-Checker](https://github.com/NikkelM/Todo-PR-Checker)** and the
  **[PR Todo Checker Action](https://github.com/marketplace/actions/pr-todo-checker)** —
  GitHub Actions that scan a PR's changed files for `TODO`/`FIXME`-style markers
  with configurable regexes and post a comment. This validates the issue's
  "regular expressions … (partial parsing, find occurrence)" direction and the
  "scan only the changed content" cost model.
  **Why not just use them:** they only _report_ code markers in a comment; they do
  not act, they run as a separate CI Action (not inside `solve`), and they target
  code `TODO`s rather than natural-language deferrals ("out of scope", "future
  PR"). We needed in-process detection that _drives a restart_.

### Long-horizon agent loops (informed the safety bounds)

- **[LOOP — RL for long-horizon interactive LLM agents](https://medium.com/@sarthak221995/paper-explained-easy-reinforcement-learning-for-long-horizon-interactive-llm-agents-76d613de4b6e)**
  and general agent-loop write-ups (e.g.
  **[avante.nvim tool-execution / agent loop](https://deepwiki.com/yetone/avante.nvim/4.3-tool-execution-and-agent-loop)**)
  describe loops that "continue until the agent produces no further tool calls or
  hits an error" and warn that agents can "get stuck in infinite loops." This
  directly motivated the dual bound: a configurable restart limit **and** a
  consecutive-error cap even in unlimited mode.

### Scope-creep / out-of-scope literature (problem framing)

- **[What Is Out Of Scope Work? (Ignition)](https://www.ignitionapp.com/blog/what-is-out-of-scope-work-and-how-to-avoid-it)** —
  confirms "out of scope" / deferral language is a recognised signal that agreed
  work is being pushed out, which is exactly the human phrasing our patterns
  target.

## Why a bespoke implementation (not an off-the-shelf library)

No existing library combines the three things this feature needs:

1. **In-process** detection inside the `solve` run (not a separate CI Action).
2. **Natural-language deferral** detection (not just code `TODO` markers).
3. **Acting** on detection by restarting the agent with a reinforcement prompt,
   under bounded restarts.

The detection itself is ~14 regexes — small enough that a dependency would add
more surface than it removes. The design borrows the _idea_ (regex occurrence
scanning of changed content) from the TODO-checker actions and the _safety
bounds_ from agent-loop research, while reusing the repo's own restart
infrastructure for execution.
