## Summary

`scripts/detect-code-changes.rs` classifies a pull request by the diff of its **last commit only**. In `get_changed_files_in_repo` (lines 110-130 at 88fd935) a `pull_request` merge commit is diffed as `HEAD^2^..HEAD^2`:

```rust
println!("Comparing {base} to HEAD^2 (per-commit diff of PR head)");
exec_in("git", &["diff", "--name-only", "--no-renames", base, "HEAD^2"], ...)
```

When the last commit of a push is documentation only, every job gated on `any-code-changed` skips, whatever the earlier commits changed. The same applies when a newer push cancels the run that saw the code commit (`cancel-in-progress`). The pull request goes green without running tests. js-ai-driven-development-pipeline-template#156 is the same defect, fixed there by diffing the whole pull request.

## Reproduction

```bash
set -euo pipefail
work=$(mktemp -d); cd "$work"
git init -q --initial-branch=main
git config user.email test@example.com; git config user.name test
echo '[package]' > Cargo.toml; git add -A; git commit -qm base
git checkout -qb feature
mkdir -p src; echo 'fn main() {}' > src/main.rs; git add -A; git commit -qm code
mkdir -p docs; echo notes > docs/notes.md; git add -A; git commit -qm docs
git checkout -q main; git merge -q --no-ff -m merge feature
git diff --name-only HEAD^2^ HEAD^2   # what the detector sees: docs/notes.md
git diff --name-only HEAD^1 HEAD^2    # what the pull request changes: docs/notes.md src/main.rs
```

## Workaround / suggested fix

For `pull_request` events, diff the pull request against its base: `git diff --name-only HEAD^1 HEAD` (the merge commit against the base parent), as js#156 does. Add a test with the two-commit fixture above.
