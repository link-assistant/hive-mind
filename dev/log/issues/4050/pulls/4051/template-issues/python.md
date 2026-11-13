## Summary

The release pipeline builds the wheel and sdist, runs `twine check`, and uploads to PyPI without checking file sizes. `twine check` only validates metadata.

PyPI refuses any file above the project's upload limit (100 MB by default) with `400 File too large`. That refusal comes at the very end of a release, after every build has passed, and the same files fail the same way on every run until something changes.

The Rust template already guards against this: `scripts/check-crate-size.rs` checks crates.io's 10 MiB limit before `cargo publish`. The JS pipeline that lacked an equivalent gate lost two releases to npm's `E413 Payload Too Large` (link-assistant/hive-mind#4050).

## Reproduce

1. Add a file larger than 100 MB to the package data. Any data file included by the build backend works.
2. `python -m build && python -m twine check dist/*` passes.
3. `twine upload` is refused with `HTTPError: 400 Bad Request ... File too large. Limit for project '<name>' is 100 MB.`

Nothing in `scripts/` or `.github/workflows/release.yml` looks at `dist/*` sizes. `scripts/check_file_size.py` counts source lines.

## Workaround

Before uploading, run:

```bash
python -c 'import sys, pathlib; sys.exit(any(p.stat().st_size > 100_000_000 for p in pathlib.Path("dist").iterdir()))'
```

## Suggested fix

1. Add `scripts/check_dist_size.py`. It should fail with a `::error` annotation naming any `dist/*` file above a configurable budget (default just under 100 MB), list that file's largest members, and write `dist_size_bytes` to `GITHUB_OUTPUT`.
2. Run it right after `twine check` in the build job, so pull requests catch the regression, and again before upload.
3. Classify `400 ... File too large` as non-retryable if an upload retry is ever added.

References:
- PyPI storage limits: https://docs.pypi.org/project-management/storage-limits
- Downstream incident and reference gate: https://github.com/link-assistant/hive-mind/pull/4051 (`scripts/check-npm-tarball-size.mjs`)
