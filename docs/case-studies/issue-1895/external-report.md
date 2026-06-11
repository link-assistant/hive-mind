# External Reporting Decision — Issue #1895 (R-11)

The issue asks: _"If issue related to any other repository/project, where we can
report issues on GitHub, please do so. Each issue must contain reproducible
examples, workarounds and suggestions for fix the issue in code."_

The "other repository" is **`link-foundation/meta-language`** (PRs #65/#66,
issues #49/#50).

## Decision: no external issue is filed — here is why

After investigation, **there is no defect in `meta-language` and no bug in GitHub
to report**:

1. **Not a GitHub bug.** Empty `closingIssuesReferences` and no auto-close for a
   PR whose base is a non-default branch is GitHub's **documented, intended**
   behavior (see [`analysis.md`](./analysis.md) §1). Filing it as a bug would be
   incorrect.
2. **Not a `meta-language` source bug.** PRs #65/#66 contained correct closing
   keywords (`Fixes #49`, `Fixes #50`). The repository's code and PR bodies were
   fine; nothing in `meta-language` needs a code change.
3. **It is a hive-mind workflow consequence.** The reason the issues stayed open
   is that hive-mind created the PRs against a non-default branch
   (`issue-47-76af108c0f24`) and then neither diagnosed nor compensated for the
   consequence. **That is fixed in this PR (#1896).**

Filing a duplicate "issue not closed" report on `meta-language` would therefore
be noise. The single actionable fix lives in hive-mind and is implemented here.

## Reproducible example (for completeness)

```bash
# Default branch of the repo
gh api graphql -f query='{ repository(owner:"link-foundation", name:"meta-language") {
  defaultBranchRef { name }
  pr65: pullRequest(number:65){ baseRefName merged closingIssuesReferences(first:5){ nodes{ number } } }
}}'
# => defaultBranchRef.name = "main"
# => pr65.baseRefName = "issue-47-76af108c0f24" (NON-default)
# => pr65.merged = true
# => pr65.closingIssuesReferences.nodes = []   <-- empty: GitHub did not register the link
# => issue #49 remains OPEN
```

Raw captured evidence: [`data/meta-language-graphql-evidence.json`](./data/meta-language-graphql-evidence.json).

## Workaround (for anyone hitting this manually)

Either:

- **Re-target the closing PR onto the default branch** (`main`) before merging, so
  GitHub registers the link and auto-closes the issue; or
- **Close the issue manually after the non-default-base merge**
  (`gh issue close <n> --reason completed`).

hive-mind now performs the second workaround automatically.

## Suggested code fix

Implemented in this PR — see [`analysis.md`](./analysis.md) §3 and
[`requirements.md`](./requirements.md). The remediation (classify the non-default
base case + explicit post-merge close) is wired into every hive-mind merge path.

## Note on the now-open meta-language issues #49 / #50

These two issues are currently still open as a direct artifact of the original
bug. This PR does **not** reach out and close them on the external repository,
because that is an action on a third-party repo outside the scope of this code
fix; closing them is a one-line manual `gh issue close` (or will be handled
automatically by hive-mind on any future qualifying merge). The maintainer can
close them at will using the workaround above.
