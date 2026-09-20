# Experiments — issue #2144

Closed issues should not block preparation to merge.

## `repro-closed-issue-stops-loop.mjs`

Replays the exact GitHub state from the incident
(`docs/case-studies/issue-2144/data/runs/original-run.log.txt`, lines 11419-11422):
an open, mergeable, clean pull request (`link-assistant/formal-ai#927`) whose
linked issue (`#905`) is closed.

```bash
node experiments/issue-2144/repro-closed-issue-stops-loop.mjs
```

Before the fix `checkGitHubTerminalState` returned `terminal: true` /
`reason: 'issue_closed'`, so `--auto-restart-until-mergeable` printed
`❌ GITHUB TARGET UNAVAILABLE: Issue #905 has been closed.` and exited `0`
without posting any comment. The script exits non-zero if that behaviour
returns.

After the fix the same state is non-terminal and carries a single merge blocker,
and the script prints the two comments the tool now publishes: the
"auto-merge blocked" comment (issue closed) and an "automation stopped" comment
(pull request closed — a genuine stop).

The permanent regression coverage lives in
`tests/test-closed-issue-merge-blocking-2144.mjs`.
