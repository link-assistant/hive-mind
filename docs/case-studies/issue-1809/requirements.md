# Requirements Extracted From Issue #1809

The issue text packs several distinct asks. Each requirement below is keyed so
it can be linked from `solutions.md`, code comments, and the PR description.

## R1 — Produce meaningful JSON output from the Gemini tool

> "We don't get gemini tool to produce any meaningful json output so we can see,
> what it actually does."

Acceptance criteria:

- When `gemini` runs successfully, the wrapper consumes the JSONL stream and
  extracts session id, messages, tool uses, result summary, and per-model
  token statistics.
- When `gemini` fails (auth, transient, validation), the wrapper records an
  explicit error message AND propagates `success: false`. No more silent
  "command completed" on a failed run.
- The wrapper logs the upstream's plain-text errors when they arrive without a
  JSON envelope (this is the upstream-bug fallback documented in
  [`upstream-issue-draft.md`](./upstream-issue-draft.md)).

## R2 — Recheck gemini-cli docs and support every option

> "Please recheck docs for the latest version, and make sure every option for
> Gemini CLI is supported correctly."

Acceptance criteria:

- All currently-used flags (`--output-format`, `--model`, `--approval-mode`,
  `--skip-trust`, `--resume`) are still valid in the latest gemini-cli.
- New flags that the wrapper should expose:
  - `--debug` (mirror our `--verbose` mode).
  - `--include-directories` (mirror `workspaceTmpDir`).
  - `--allowed-mcp-server-names` (mirror Claude `--mcp-config`).
  - `--extensions` (allow opt-in to gemini extensions).
  - `--sandbox` (already supported in the CLI; wire it through argv).
- Flags we deliberately do NOT pass:
  - `-i` / `--prompt-interactive` (interactive mode is incompatible with
    headless solve).
  - `--screen-reader` (TUI-only).

## R3 — Feature parity with Claude and Codex wrappers

> "Make all our features of claude and codex, should also perfectly work with
> gemini-cli."

Concrete parity items:

- Detection of usage limits and structured retry (`tool-retry.lib.mjs`).
- Verbose mode propagating to the underlying CLI process.
- Workspace `--include-directories` to mirror Claude's "add directory" behavior.
- MCP allow-list / disable Playwright when not present.
- Surfaced session id for resume support.
- Pipeline-safe execution (`set -o pipefail`-equivalent) so a non-zero exit
  code from `gemini` is not swallowed by `cat`.
- Robust error message capture from stderr when no JSON is produced.

## R4 — Reproduce, document and store the data

> "Make sure we compile that data to `./docs/case-studies/issue-{id}` folder,
> and use it to do deep case study analysis."

Acceptance criteria:

- Failing run log is committed to `docs/case-studies/issue-1809/logs/`.
- Case study reconstructs the timeline (see `timeline.md`).
- Root causes documented (see `root-causes.md`).
- Solution plan with mapping to commits (see `solutions.md`).

## R5 — File upstream issues when the bug crosses repos

> "If issue related to any other repository/project, where we can report
> issues on GitHub, please do so. Each issue must contain reproducible
> examples, workarounds and suggestions for fix the issue in code."

Acceptance criteria:

- Draft upstream issue ready to submit (see `upstream-issue-draft.md`) with
  reproducible reproduction, workaround in our wrapper, and a precise pointer
  to the change required in `packages/cli/src/validateNonInterActiveAuth.ts`.

## R6 — Add debug/verbose output if data is insufficient

> "If there is not enough data to find actual root cause, add debug output and
> verbose mode if not present, that will allow us to find root cause on next
> iteration."

Acceptance criteria:

- `--verbose` toggles the upstream gemini `--debug` flag.
- Wrapper logs raw chunks under `argv.verbose` so future failures can be
  diagnosed from the solve log even without re-running.
- Wrapper logs the full command actually being executed (already does).

## R7 — Ship the fix and case study in PR #1810

> "Please plan and execute everything in this single pull request."

Acceptance criteria:

- All work happens on `issue-1809-ad1b428698b3` against PR #1810.
- Tests updated to lock in the new behavior.
- Version bumped / changeset entry added if required by release tooling.
- PR description references the case study and the upstream report.
