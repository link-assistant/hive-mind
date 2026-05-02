# Repository Requirements

This directory is the persistent requirements ledger for hive-mind. `README.md` is the main index; additional `*.md` files can be added when a requirement area grows too large for this file.

## Requirements Tracking

- `--requirements-tracking` is experimental and disabled by default because it changes repository files.
- When `--requirements-tracking` is enabled, every supported AI tool prompt must tell the agent to read and maintain `docs/requirements/*.md`.
- `docs/requirements/README.md` is the required main index for repository requirements.
- When an issue, issue comment, pull request comment, or review adds, modifies, or removes a repository-level requirement, the same pull request must update `docs/requirements/*.md`.
- If requirements tracking is enabled and a pull request does not modify `docs/requirements/*.md`, solve post-processing should auto-restart the tool once with feedback asking it to update the requirements documentation or justify why no repository requirement changed.
- Requirements entries should be short, factual, repository-level statements. They should not duplicate full issue or pull request transcripts.

## Case Study Documentation

- When a task requires a case study, issue-related data should be collected under `docs/case-studies/issue-{id}/`.
- Case studies should preserve raw issue and pull request data when practical, list extracted requirements, describe solution options, and record the selected implementation and verification plan.
