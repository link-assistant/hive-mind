## Summary

`scripts/detect_code_changes.py` does not count `scripts/requirements-ci.txt` or `scripts/requirements-security.txt` as code. `.txt` is not in `CODE_EXTENSIONS`, and neither file is in `CODE_FILENAMES` (lines 33-40 at 29d8cf2). A pull request that changes only the pinned CI tools therefore skips every check and reports green.

Observed: Dependabot PR #21 ("Bump the ci-tools group across 1 directory with 5 updates") changes only those two files. Its run 42463434826 has Lint and Format Check, Test, Sanitizers, Code Coverage, Validate Documentation, Release Script Tests and Build Packages all `skipped`, and Pipeline Status `success`. The tool upgrades were never run before they would be merged.

## Reproduction

```bash
gh run view 42463434826 --repo link-foundation/cpp-ai-driven-development-pipeline-template --json jobs --jq '.jobs[] | "\(.name)=\(.conclusion)"'
python3 -c 'import sys; sys.path.insert(0, "scripts"); import detect_code_changes as d; print(d.is_code_file("scripts/requirements-ci.txt"))'   # False
```

## Workaround / suggested fix

Count dependency manifests as code. For example, add `requirements*.txt` (or any `scripts/requirements-*.txt`) to the code patterns in `is_code_file`. Add a test asserting `is_code_file("scripts/requirements-ci.txt")` is `True`. Re-run PR #21 afterwards so the bumped tools are actually exercised.
