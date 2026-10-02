# Issue completion before automated merging

An issue-scoped solve now repairs the pull request description after every working session and checks completion even without `--finalize` or `--ensure-all-sub-issues-addressed`. The original issue, nested native sub-issues, and the generated combined issue's required reference list must all have positive closing references in the description. References in examples, comments, titles, or negated sentences do not certify a link. Foreign issues require their exact repository.

Repository mode includes every open issue in the combined issue's body. GitHub permits only 100 native children per parent; remaining issues stay in the required body reference list. They are still part of the same pull request's scope.

All six tool prompts require complete implementation and verification in this pull request. Codex runs with `features.goals=true`; prompts ask tools to set the objective through a supported native goal API, with a persistent checklist when that API is unavailable. The completion restart loop uses five attempts by default; `--ensure-all-sub-issues-addressed=N` also controls this limit. Exhaustion, usage limits, and unreadable GitHub data leave the pull request unmerged.

## Creating a requirements report

After the final push, generate a template from the current issue descriptions, all issue comments, and all three pull request feedback endpoints:

```bash
node /path/to/hive-mind/src/issue-requirements-snapshot.mjs OWNER/REPO ISSUE_NUMBER PR_NUMBER
```

The tool prompts provide the installed script's absolute path. The command only reads GitHub and prints a template; every entry starts as `pending`. Add prose requirements that the explicit checklist extractor cannot identify. Record reviewable implementation and verification evidence for each requirement, and change its status to `done` only when it is complete. Retain `blocked` for unresolved requirements. Paste the entire report, including its supplied markers, into the PR description:

```text
<!-- hive-mind:requirements:start -->
...the generated JSON report...
<!-- hive-mind:requirements:end -->
```

Regenerate after a new commit or changed issue/review feedback. Preserve this report when editing the description. Do not put the closing references inside the report's code block; repeat a positive closing keyword per issue in the surrounding description.

## What permits a merge

The shared merge function checks every automated entry point, including the merge queue. It requires:

- Positive closing references for the complete required issue set.
- Exactly one valid requirements report covering exactly that set.
- The current PR head SHA and current source digests.
- All explicit acceptance criteria, `done` statuses, and nonempty evidence.
- GitHub-confirmed native closing links when targeting the default branch.

GitHub reads, pagination, and response validation must succeed. The merge command also uses `--match-head-commit` to reject a concurrent code push. For a merge into a non-default branch, GitHub does not auto-close issues; hive-mind explicitly closes every verified issue after the merge and reports individual failures. PR-only maintenance without an issue context continues to use the existing merge workflow.

Verbose mode records the verified issue count and commit SHA; verification failures always name the blocking condition. Completion-blocked comments ask for the missing work and evidence instead of recommending a manual merge.

## Verification limits

The report is a required, current evidence inventory, not a theorem proving arbitrary prose or the truth of agent-written evidence. Humans must review that evidence. A repository administrator can still merge through GitHub outside hive-mind; source comments and PR descriptions can change in the interval between their last read and the merge. GitHub provides a commit guard but no atomic lock for all those external records. Large issue inventories also remain subject to GitHub's body-size and API limits; failed publication or verification must remain blocked.

The [issue 2406 case study](case-studies/issue-2406/README.md) documents the reproduced failure, implementation, tests, and these practical limits.
