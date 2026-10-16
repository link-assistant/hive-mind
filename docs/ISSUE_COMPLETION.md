# Issue completion before automated merging

An issue-scoped solve is complete only when every requirement of the issue and of all required sub-issues is implemented and verified in the same pull request (issue #2406). Passing CI, a partial implementation or a workaround is not completion.

## Prompts and goals

The system, initial and continuation prompts of all six tools (claude, codex, opencode, agent, gemini, qwen) state this complete-delivery goal. So does the short claude prompt used with `--minimal-restart-context`. The prompts ask the tool to set the objective through a native goal API when one exists, and to keep a persistent checklist when it does not.

Codex always runs with `-c features.goals=true`, both directly and through agent-commander. `--auxiliary-model-calls-disabled` now disables only `features.personality`: goals carry the task itself and are not an auxiliary call.

## Creating a requirements report

After the final push, generate a template from the current issue, all issue comments and all pull request comments, inline comments and reviews:

```bash
node /path/to/hive-mind/src/issue-requirements-snapshot.mjs OWNER/REPO ISSUE_NUMBER PR_NUMBER
```

The tool prompts provide the installed script's absolute path. The command only reads GitHub and prints a template; every entry starts as `pending`. Add prose requirements that the checklist extractor cannot identify. Record reviewable evidence for each requirement and change its status to `done` only when it is complete. Mark a requirement that cannot be completed as `blocked`, with the evidence of the blocker. Paste the whole report, including its markers, into the pull request description:

```text
<!-- hive-mind:requirements:start -->
...the generated JSON report...
<!-- hive-mind:requirements:end -->
```

Regenerate the report after a new commit or new issue or review feedback. When hive-mind rewrites a placeholder description, it keeps an existing report.

## What permits a merge

The shared merge function, used by `--auto-merge`, the merge queue and the post-solve checks, requires:

- Positive closing references for every required issue (the existing link guard).
- Exactly one valid report covering exactly the required issues.
- The current pull request head SHA, and source digests that match the current issue and feedback.
- Every explicit acceptance criterion, with status `done` and nonempty evidence.

Every GitHub read must succeed; an unreadable or malformed response blocks the merge. The merge command also passes `--match-head-commit` so that a concurrent push cannot be merged unchecked. Pull requests without a linked issue merge as before.

## Completion restarts

After the solve, hive-mind restarts the tool until the report passes, without any optional flag. It runs three restarts by default; `--ensure-all-sub-issues-addressed=N` sets the bound. Restarts stop early on usage limits, repeated tool or verification failures, or when only `blocked` requirements remain. The pull request then stays unmerged, and the blocked-merge comment lists the remaining work instead of suggesting a manual merge.

## Limits

The report is an inventory of evidence, not proof that arbitrary prose requirements are met. People still need to review the evidence. A repository administrator can merge outside hive-mind.
