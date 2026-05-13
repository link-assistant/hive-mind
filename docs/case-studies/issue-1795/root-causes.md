# Root causes — Issue #1795

## Symptom

When `solve` is invoked on an issue in a **private** repository where the
caller has only `pull: true` access, the run aborts with:

```
❌ --auto-fork failed: Repository is private and you don't have write access
❌ Auto-fork failed - private repository without access
```

despite the caller still having enough access to (a) read the issue and
(b) post comments on it. The downstream consequence is that legitimate
contributors with read-only access cannot use Hive Mind at all on private
upstreams — even when a fork would have been the obvious workaround.

## Root cause

`handleAutoForkOption` short-circuited on `!isPublic` without checking
whether the upstream allowed forking.

Pre-fix `src/solve.fork-detection.lib.mjs:50-68`:

```js
if (!hasWriteAccess) {
  const { isPublic } = await detectRepositoryVisibility(owner, repo);

  if (!isPublic) {
    // …actionable error…
    await safeExit(1, 'Auto-fork failed - private repository without access');
    return;
  }

  await log('✅ Auto-fork: No write access detected, enabling fork mode');
  argv.fork = true;
}
```

The branch confuses two distinct conditions:

1. **You cannot fork a private repository.** False in general. GitHub
   allows forking a private repository to a private fork when the upstream
   has `allow_forking: true` and the user has `pull` access (see
   <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-forking-policy-for-your-repository>).
2. **You cannot push to a private repository.** True when `push` is false,
   but this only matters _if_ we plan to push directly to the upstream;
   the whole point of `--auto-fork` is to avoid that.

The pre-fix code conflated (1) and (2), so any private repo where the user
had read-only access was treated as if the repo were inaccessible.

## Contributing factors

- **`auto-fork` defaults to `true`.** `src/solve.config.lib.mjs:93` sets
  `auto-fork` to `true` by default, so the buggy branch ran without any
  explicit user opt-in. Users with read-only access on private repos hit
  this 100% of the time.
- **No coverage for the "private + read-only + fork allowed" scenario.**
  `tests/test-issue-1716-private-repo-skip-fork.mjs:158` only tests
  _"private upstream + no write access → no bypass"_ (i.e. the existing
  fail-fast branch), implicitly endorsing it.
- **Documentation framing.** The CLI description literally says
  _"Automatically fork public repositories without write access (fails for
  private repos)."_ — confirming the developers had assumed private repos
  could not be forked.

## Why posting a comment still worked

The post-failure path in `src/solve.mjs` (after `safeExit` schedules an
exit) is intentionally permissive: it sanitises the log, formats a comment,
and posts it via `gh api`. Posting a comment only requires `pull` access
(GitHub treats issue comments as a read-side action for permission
purposes — see the
[Issues API docs](https://docs.github.com/en/rest/issues/comments)). This
proves the caller has enough access to do _something_ useful, which is the
core ask in the issue.
