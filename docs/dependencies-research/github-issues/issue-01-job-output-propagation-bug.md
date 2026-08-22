# GitHub Actions Bug: Job Output Propagation Fails with Complex Dependencies

## Issue Summary

GitHub Actions fails to properly propagate job outputs when a job has multiple dependencies (more than ~2-3 jobs in the needs array). This causes downstream jobs to be skipped even when their conditions should evaluate to true.

## Symptoms

- Job with condition `if: needs.job-a.outputs.value == 'true'` gets skipped
- The same output value can be successfully read in other jobs (like summary jobs)
- Debug logs show the output is set correctly in the source job
- GitHub Actions UI shows the job as "skipped" without explanation

## Affected Configuration

```yaml
jobs:
  detect-changes:
    outputs:
      new-version: ${{ steps.version.outputs.new-version }}
    steps:
      - id: version
        run: echo "new-version=true" >> $GITHUB_OUTPUT

  # Multiple test jobs...
  test-1:
    needs: detect-changes
  test-2:
    needs: detect-changes
  test-3:
    needs: detect-changes
  # ... more test jobs

  publish:
    # This fails - job gets skipped even when new-version is true
    if: needs.detect-changes.outputs.new-version == 'true'
    needs: [detect-changes, test-1, test-2, test-3, test-4, test-5, test-6, test-7]
```

## Root Cause

The bug appears to be related to GitHub Actions' internal handling of job outputs when:

1. A job has many dependencies (7+ in our case)
2. The output is used in a job-level `if:` condition
3. The output comes from a job that's not the immediate predecessor

## Workaround Solutions

### Solution 1: Synthetic Aggregation Job

Create an intermediate job that aggregates all test dependencies:

```yaml
jobs:
  all-tests-complete:
    if: always()
    needs: [test-1, test-2, test-3, test-4, test-5, test-6, test-7]
    steps:
      - run: |
          if [ "${{ contains(needs.*.result, 'failure') }}" = "true" ]; then
            exit 1
          fi
          echo "All tests passed"

  publish:
    # Now only depends on 2 jobs - this works!
    if: needs.detect-changes.outputs.new-version == 'true'
    needs: [detect-changes, all-tests-complete]
```

### Solution 2: Shell Script Condition Check

Move the condition check from job-level `if:` to a shell script inside the job:

```yaml
jobs:
  publish:
    if: always() # Always run the job
    needs: [detect-changes, all-tests-complete]
    steps:
      - name: Publish
        run: |
          # Check condition in shell script instead of job-level if
          if [ "${{ needs.detect-changes.outputs.new-version }}" != "true" ]; then
            echo "Skipping publish - no new version"
            exit 0
          fi
          # Continue with publish...
```

### Solution 3: Combine Related Steps

Reduce the number of output-passing boundaries by combining related operations:

```yaml
jobs:
  detect-changes:
    steps:
      - name: Detect changes and check version
        id: changes
        run: |
          # Combine multiple checks in one step
          # All outputs from same step ID
          echo "new-version=true" >> $GITHUB_OUTPUT
          echo "version=1.2.3" >> $GITHUB_OUTPUT
```

## Verification

The workaround was verified to work in production:

- Repository: https://github.com/link-assistant/hive-mind
- Working run: #14 (after applying workaround)
- Previously failing runs: #11, #12, #13

## Timeline

- **Issue discovered**: 2025-01-14
- **Symptoms**: Publish job repeatedly skipped despite new versions 0.0.11, 0.0.12
- **Workaround applied**: Combined synthetic job + shell script check
- **Result**: Version 0.0.13 published successfully

## Recommendations for GitHub

1. Fix the output propagation logic for jobs with many dependencies
2. Provide better debugging information when jobs are skipped due to condition evaluation
3. Document the limitation if it's by design
4. Consider adding a warning in the workflow editor when this pattern is detected

## Related Issues

- Similar reports have been seen with matrix jobs and complex dependency chains
- The issue seems to affect both Ubuntu and other runners
- Both `github.event` context and `needs` context outputs can be affected

## Keywords

GitHub Actions, job outputs, needs context, job dependencies, condition evaluation, if expression, workflow skip, output propagation
