## Summary

`scripts/publish-release.sh` packs the `.nupkg` with `scripts/package_release.py --nuget` and pushes it with `dotnet nuget push`, without checking its size first. `scripts/check-nuget-package.sh` checks the package layout, not its size.

nuget.org refuses packages above about 250 MB with `413` ("package file exceeds the size limit"). A native package that bundles prebuilt libraries for several platforms can cross that limit. The failure would surface only at the final push, after every build has passed. The same file is refused the same way on every run until something changes.

The Rust template gates its upload size before publishing (`scripts/check-crate-size.rs`). The JS pipeline without such a gate lost two releases to npm's `E413 Payload Too Large` (link-assistant/hive-mind#4050).

## Reproduce

1. Make `package_release.py --nuget` include a payload above 250 MB, for example a large file in the packed directory.
2. `bash scripts/check-nuget-package.sh` passes.
3. `dotnet nuget push` to nuget.org is refused with 413.

## Workaround

Before the push, check `stat -c %s "$nupkg"` against a budget.

## Suggested fix

1. In `scripts/check-nuget-package.sh` (or `pack_nuget.py`), fail with a `::error` annotation when the `.nupkg` exceeds a configurable budget (default just under 250 MB), listing the largest zip entries.
2. Run the check on pull requests and immediately before `dotnet nuget push`.
3. Treat a 413 from the push as non-retryable.

References:
- nuget.org package size limit: https://learn.microsoft.com/en-us/nuget/nuget-org/publish-a-package
- Downstream incident and reference gate: https://github.com/link-assistant/hive-mind/pull/4051
