## Summary

- restore protected-branch version releases with the existing short-lived `GITHUB_TOKEN`, without requiring `RELEASE_PULL_REQUEST_TOKEN`
- make both release modes wait for the complete pre-release validation graph, reject generated commits containing non-metadata changes, publish the required `Pipeline Status` check on the exact version SHA, and merge only after GitHub recognizes it
- refresh the three dependencies rejected by the exact-freshness gate and update their dependency-pin regression expectations
- archive the complete issue/PR/run/ruleset/template investigation under `dev/log/issues/2281/pulls/2282`

## Root cause and reproduction

Main run [35587213311](https://github.com/link-assistant/hive-mind/actions/runs/35587213311) passed all pre-release work, generated 2.31.0, and correctly received GH013 when it tried to push directly to protected `main`. The fallback then exited because PR #2280 had made an unconfigured `RELEASE_PULL_REQUEST_TOKEN` mandatory. The maintainer explicitly does not want that credential.

The initial PR run [35627852498](https://github.com/link-assistant/hive-mind/actions/runs/35627852498) independently reproduced the exact-freshness failure: `@sentry/node` and `@sentry/profiling-node` were one patch behind, as was `jscpd`.

The last fully green release, run [34792591319](https://github.com/link-assistant/hive-mind/actions/runs/34792591319), proves the built-in token could create and merge release PR #2250 before `Pipeline Status` became required. The ruleset change—not token authentication—created the later deadlock. Explicit `workflow_dispatch` validation was also ruled out by production runs because GitHub does not associate those checks with the pull request.

## Safety model

The ruleset is unchanged and direct bot pushes remain blocked. The fallback now succeeds only when:

1. all 13 pre-release jobs have completed without failure;
2. the version commit changes only `package.json`, `package-lock.json`, `CHANGELOG.md`, or consumed `.changeset/*.md` files;
3. the GitHub Actions App installation token can create the required check on that exact commit;
4. `gh pr checks --required --watch --fail-fast` reports success; and
5. the protected-branch merge succeeds.

An unexpected source path, Checks API denial, failed/missing required check, or policy failure aborts before publishing.

## Verification

- issue-2281 regression: metadata allowlist, built-in-token PR/check/watch/merge order, complete validation dependencies, and API-denial fail-closed behavior
- prior release regressions: issues #2175, #2274, #2279, and #2082
- dependency freshness: 148/148 current
- formatting, ESLint, duplication, secret scan, syntax, package-manager, line-limit, default, GitHub-integration, execution, and audit checks
- final remote check IDs and conclusions are recorded in `dev/log/issues/2281/pulls/2282/ANALYSIS.md`

This is CI/release logic only; there is no visual UI change, so screenshots are not applicable.

Fixes #2281
