---
'@link-assistant/hive-mind': patch
---

Fix the release failure and the CI/CD gaps behind issue #2198.

- `changeset version` no longer resolves `bun` from a stale root `bun.lock`:
  the lockfile is removed and `devEngines.packageManager` declares npm, so
  `@changesets/format` cannot spawn a package manager the runner does not have.
- New `scripts/check-package-manager.mjs` guard, run in the lint job, fails
  loudly if a foreign lockfile or a missing package manager declaration comes
  back.
- Lockfile changes now count as package changes in `detect-code-changes.mjs`,
  so the guard cannot be gated out.
- Every workflow now declares the narrowest default `permissions` that still
  allows checkout, instead of `read-all`, clearing zizmor's
  `excessive-permissions` findings.
- secretlint was installed on every build but never run as a linter and had no
  config; `npm run check:secrets` now runs it in the lint job, fail-closed,
  with a narrow `.secretlintignore` for the fixtures that hold fake secrets on
  purpose.
- A Broken Link Checker workflow (lychee, with a Wayback Machine fallback) and
  an offline relative-link test now cover documentation links. They catch the
  `docs/FREE_MODELS.md` case-study link that had pointed at a file which never
  existed in any commit, in all four translations.
- All eight Docker jobs booted buildx through a bare
  `docker/setup-buildx-action`, so a transient registry outage failed the
  publish; they now go through a `setup-buildx-resilient` composite action that
  pre-pulls the pinned BuildKit image with backoff and falls back to a
  pull-through mirror.
- Nothing audited the dependency tree: CodeQL analyses our own source, and
  `dependency-review-action` only runs on pull requests and only inspects the
  dependencies a PR changes, so an advisory against a long-pinned package was
  invisible to both. `security.yml` gains an `npm-audit` job running
  `npm audit --package-lock-only --audit-level=high`, which also runs on the
  existing schedule.
- actionlint is pinned to 1.7.12 instead of 1.7.7.

- Eleven links pointed at this repository under its former owner
  (`deep-assistant/hive-mind`). The GitHub API reports that name as
  `301 Moved Permanently`, but the pages a reader actually clicks answer 404,
  so every one of them was broken. All rewritten, including six in a directory
  the link checker excludes and would never have reported. The suppression list
  it needed alongside them was also wrong: it carried a `www.npmjs.com` pattern
  while the README links the bare host, so the rule matched nothing. Both are
  now asserted — the guard checks that each suppressed URL is genuinely
  *matched* by a pattern, not merely mentioned near one.
- Kept the 1350-line warning threshold met after merging `main`: issue #2186 grew
  `src/agent.lib.mjs` to 1357 lines, so the Agent CLI version floors moved to
  `src/agent.version-gates.lib.mjs` (re-exported, so no importer changed).
- The change detector no longer trusts a PR head that was never tested. Issue
  #1665's incremental `before..after` diff is correct only if the previous head
  passed, and `cancel-in-progress` means it often had not: a docs commit pushed
  minutes after a code commit cancels that commit's run and then skips the code
  jobs itself, leaving the branch green over code no job ever ran.
  `detect-code-changes.mjs` now asks the Actions API whether a successful run is
  recorded for the previous head, and widens to the full PR diff whenever the
  answer is anything else — including when the lookup itself fails, since an
  unanswerable lookup must not be read as a "yes".
