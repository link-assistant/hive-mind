# Issue 1743: Requirements Tracking

## Scope

Issue: https://github.com/link-assistant/hive-mind/issues/1743

Pull request: https://github.com/link-assistant/hive-mind/pull/1744

The request is to add an experimental `--requirements-tracking` option. When enabled, the solver should ask AI tools to maintain repository requirements in `docs/requirements/*.md`, use `docs/requirements/README.md` as the main index, collect issue case-study data under `docs/case-studies/issue-{id}/`, and auto-restart when a pull request omits requirements-document updates.

## Evidence

Raw evidence collected for this case study is in `data/`:

- `issue-1743.json`: issue metadata and body.
- `issue-1743-comments.json`: issue comments, currently empty.
- `pr-1744.json`: prepared pull request metadata before implementation.
- `pr-1744-issue-comments.json`, `pr-1744-review-comments.json`, `pr-1744-reviews.json`: pull request feedback, currently empty.
- `pr-1744-initial-files.txt`: initial changed files in the prepared pull request.
- `online-sources.md`: external references checked during analysis.

Online research used three stable sources:

- GitHub Docs describes linked pull requests and issue-closing keywords, which supports keeping PR descriptions tied to issue requirements and fixes.
- ISO/IEC/IEEE 29148:2018 is the current ISO requirements-engineering standard page; its abstract covers requirements processes, information items, contents, and format guidance.
- NIST SP 500-204 notes software requirements quality attributes including completeness, correctness, consistency, verifiability, modifiability, traceability, understandability, and robustness.

## Requirements

- Add `--requirements-tracking`.
- Keep the option disabled by default because it changes repository files.
- When enabled, prompt AI tools to read existing `docs/requirements/README.md` and referenced requirement documents before work.
- When enabled, prompt AI tools to create or update `docs/requirements/*.md` when repository-level requirements are added, modified, or removed in issues, issue comments, PR comments, or reviews.
- Treat `docs/requirements/README.md` as the main requirements index.
- Enforce the prompt guidance for all supported solve tools: `claude`, `codex`, `gemini`, `qwen`, `opencode`, and `agent`.
- If requirements tracking is enabled and the pull request does not change `docs/requirements/*.md`, auto-restart once or auto-resume with feedback.
- Collect issue-related data under `docs/case-studies/issue-1743/`.
- Include requirements, solution options, selected plan, and verification notes in the case study.

## Existing Behavior

`src/architecture-care.prompts.lib.mjs` already has optional guidance for root-level `REQUIREMENTS.md` and `ARCHITECTURE.md`, behind `--prompt-architecture-care`. That option is broader and uses root files, so it does not satisfy this issue's dedicated `docs/requirements/*.md` ledger requirement.

`--prompt-case-studies` already asks agents to collect case-study data under `docs/case-studies/issue-{id}/`, but it is a prompt-only feature and does not create a persistent requirements ledger or enforce requirements-document updates.

`verifyResults()` already detects placeholder PR titles and descriptions, then allows `solve.mjs` to restart once when `--auto-restart-on-non-updated-pull-request-description` is set. This is the closest existing enforcement pattern.

## Solution Options

### Option 1: Extend `--prompt-architecture-care`

This would reuse the existing prompt module, but it would mix root `REQUIREMENTS.md` and `ARCHITECTURE.md` guidance with the new `docs/requirements/*.md` ledger. It also would not provide the requested `--requirements-tracking` flag.

Decision: rejected.

### Option 2: Add a prompt-only `--requirements-tracking`

This would be simple and would satisfy part of the issue, but it would not auto-restart when a pull request forgets to update requirements documents.

Decision: rejected.

### Option 3: Add a dedicated option, prompt module, and PR-file enforcement

This keeps the behavior explicit and off by default, reuses the existing prompt wiring style for all supported tools, and extends the existing verification/restart pattern with a focused `docs/requirements/*.md` changed-file check.

Decision: selected.

## Implementation Plan

1. Add `requirements-tracking` to `SOLVE_OPTION_DEFINITIONS` with `type: "boolean"` and `default: false`.
2. Add `src/requirements-tracking.prompts.lib.mjs` with gated prompt guidance.
3. Include the gated sub-prompt in every supported tool prompt module.
4. Add helpers in `src/solve.results.lib.mjs` to parse PR changed files and detect `docs/requirements/*.md`.
5. Make `verifyResults()` avoid exiting when requirements tracking is enabled and the PR lacks requirements-doc changes.
6. Add a one-time restart block in `src/solve.mjs` before `--finalize`, using feedback that points the agent to `docs/requirements/*.md`.
7. Add regression coverage for option defaults, prompt gating, supported tool prompt wiring, file detection, and restart-hook ordering.
8. Create `docs/requirements/README.md` and this case study as the first tracked requirements update.

## Verification Plan

- Run the issue-specific test: `node tests/test-requirements-tracking-1743.mjs`.
- Run documentation option sync: `node tests/test-docs-options-sync.mjs`.
- Run lint: `npm run lint`.
- Run the default suite: `npm test`.

## Notes

The enforcement check intentionally keys off pull request changed files rather than local working-tree state. The requirement in the issue is about the final pull request, and checking the PR diff avoids false confidence from uncommitted local files.
