# gh-upload-log auto fallback should use shared repositories by default

Hive Mind issue: https://github.com/link-assistant/hive-mind/issues/1902

## Problem

`gh-upload-log` currently defaults to auto mode and shared repository mode, but a
gist failure for a file below the gist limit can still fall back to a dedicated
one-off repository.

That makes the default behavior inconsistent with the shared-repository contract:
repository-per-log should only happen when a caller explicitly opts into the
legacy behavior with `--no-shared-repository` or `useSharedRepository: false`.

## Reproduction

Use `gh-upload-log` 0.8.0 with a log file below the gist limit:

```bash
gh-upload-log /tmp/solution-draft-log-pr-1781180521736.txt --public --auto --shared-repository --description "Solution draft log for https://github.com/lefinepro/kefine/pull/173" --verbose
```

In the captured Hive Mind run, the file was 20,632,466 bytes. Auto mode selected
gist upload first. GitHub then returned a secondary content-creation rate limit
for gist creation, so `gh-upload-log` fell back to repository upload.

Observed result:

```text
https://github.com/konard/log-tmp-solution-draft-log-pr-1781180521736.txt
https://github.com/konard/log-tmp-solution-draft-log-pr-1781180537724.txt
```

Expected result:

```text
https://github.com/konard/public-logs/tree/main/log-tmp-solution-draft-log-pr-1781180521736-txt
https://github.com/konard/public-logs/tree/main/log-tmp-solution-draft-log-pr-1781180537724-txt
```

or a clear upload failure if repository fallback is not possible.

## Root Cause

The fallback path calls repository upload with `useSharedRepository: true`, but
shared repository mode is size-gated:

```js
export function shouldUseSharedRepositoryMode(filePath, useSharedRepository = true) {
  return useSharedRepository && getFileSize(filePath) > GITHUB_GIST_FILE_LIMIT;
}
```

For a file below `GITHUB_GIST_FILE_LIMIT`, gist fallback enters repository mode
but `shouldUseSharedRepositoryMode()` returns false, so the legacy dedicated
repository path is used.

## Suggested Fix

Decouple shared repository routing from the gist size decision. Once upload type
is repository, the repository target should depend on `useSharedRepository`, not
on whether the file originally fit in a gist.

For example:

```js
export function shouldUseSharedRepositoryMode(filePath, useSharedRepository = true) {
  return useSharedRepository;
}
```

If the size guard is still needed for a specific legacy flow, move it to the
strategy-selection layer instead of the repository-routing layer.

## Workarounds

- Callers that need strict "no repository fallback" behavior can force
  `--only-gist`, but that disables auto mode.
- Callers that can tolerate repository fallback can pass
  `--auto --shared-repository`, but with 0.8.0 this does not prevent a dedicated
  repository when gist upload fails for a file below the gist limit.
- Large files above the gist limit already use shared repositories by default
  when `useSharedRepository` is true.

## Suggested Regression Tests

1. Auto mode below the gist limit attempts gist first.
2. When that gist attempt fails and `useSharedRepository` is true, repository
   fallback writes to `public-logs` or `private-logs`.
3. Dedicated one-off repositories are used only when
   `useSharedRepository: false` or `--no-shared-repository` is set.
