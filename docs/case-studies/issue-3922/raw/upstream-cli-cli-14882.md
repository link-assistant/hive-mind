### Describe the bug

`gh pr checks <pr>` on a pull request whose head commit has no check runs or statuses prints `no checks reported on the '<branch>' branch` and exits **1**. Failed checks also exit 1, so a script or an AI coding agent that runs `gh pr checks` just to *look at* CI state cannot tell "nothing ran" from "something failed" without parsing the message.

This was asked for in #9390, but #9452 closed that issue by documenting only exit code `8` (pending). The "no checks" case still exits 1 in gh 2.102.0, and `gh pr checks --help` doesn't document it. #9682 covers only the `--required` variant ("no required checks reported").

### Steps to reproduce the behavior

On any pull request without checks, for example a merged PR in a repository whose Actions did not run for it:

```console
$ gh --version
gh version 2.102.0 (2026-09-30)
$ gh pr checks 414 --repo G-Ivan-A/mango_ba_prompts; echo "exit=$?"
no checks reported on the 'issue-413-e424ca2a7c62' branch
exit=1
$ gh pr view 414 --repo G-Ivan-A/mango_ba_prompts --json statusCheckRollup --jq '.statusCheckRollup | length'; echo "exit=$?"
0
exit=0
```

A PR with a failing check gives the same `exit=1`.

### Expected vs actual behavior

- Expected: "no checks" can be told apart from "checks failed" by exit code, and the code is documented under "Additional exit codes" in `gh pr checks --help`.
- Actual: both exit 1, and only the message text tells them apart.

### Impact

In [link-assistant/hive-mind#3922](https://github.com/link-assistant/hive-mind/issues/3922), an AI agent ended a successful session with `…; gh pr checks 414 --repo …` to look at the PR state. Because the shell exited 1, the orchestrator treated the last tool call as a failed verification and marked the whole session as failed. [electron/electron#49630](https://github.com/electron/electron/pull/49630) hit the same problem in CI scripts.

### Workarounds

- `gh pr view <pr> --json statusCheckRollup --jq '.statusCheckRollup | length'` returns `0` with exit 0 when there are no checks.
- Match the exact text `no checks reported on the '<branch>' branch` on exit 1. This is what hive-mind now does.

### Suggested fix

In `pkg/cmd/pr/checks/checks.go`, `populateStatusChecks` returns a plain error:

```go
if len(statusCheckRollup.Nodes) == 0 {
    return nil, checkCounts{}, fmt.Errorf("no checks reported on the '%s' branch", pr.HeadRefName)
}
```

Either of these would fix it:

1. Return `cmdutil.NewNoResultsError(fmt.Sprintf("no checks reported on the '%s' branch", pr.HeadRefName))`. `internal/ghcmd/cmd.go` already maps `NoResultsError` to exit 0 and prints the message on a TTY, as `gh label list`, `gh workflow list` and others do. The `--watch` loop would need to keep treating "no checks yet" as "keep waiting" (see #7401).
2. If changing exit 1 → 0 is too breaking for scripts that rely on it, return a distinct, documented code for "no checks". This mirrors exit 8 for pending, and the same code could serve the `--required` case in #9682.

In both cases, add the code to the "Additional exit codes" help text.
