# Validation record

Environment: Node.js 26.10.0, npm 11.19.1, Codex CLI 0.160.0.

## Regression evidence

- Original effort test: `none !== low`, retained in `data/before.log`.
- Claude commander: explicit `MAX_THINKING_TOKENS=0` instead of an omitted manual budget, retained in `data/claude-before.log`.
- Gateway cache: CLI `low` instead of gateway `auto`, retained in `data/cache-before.log`.
- Fixed pure, cache and native new/resumed command tests pass. The selector exhausts 255 nonempty subsets × 8 requested levels (2,040 cases).
- The existing real-process cancellation probe failed because its fake binary did not implement `debug models`: it waited for stdin instead of returning metadata, exceeded the existing 10-second bound, and left its shared cache lock when killed. The fixture now answers the metadata request and isolates state in its temporary directory. The bound is unchanged; all 25 automation tests pass. Before/after evidence is retained in `data/cancellation-{before,after}.log`.

## Local checks

Targeted reasoning/capability/native, commander, organization, default-off, dynamic-model, dependency-pin, start-command, preinstall, use-with-retry, command-stream and cancellation tests pass. The final complete default-suite run passed all 547 selected test files with exit code 0 after correcting the bounded fixture.

Completed checks:

| Check                                                              | Result                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `npm ci`                                                           | Success; 266 installed packages, zero audit vulnerabilities        |
| `node scripts/run-tests.mjs --suite default --continue-on-failure` | Pass; all 547 selected test files                                  |
| `npm run lint`                                                     | Pass                                                               |
| `npm run format:check`                                             | Pass                                                               |
| `npm run check:duplication`                                        | Pass; 11.33%, below the 12% threshold                              |
| `npm run check:secrets`                                            | Pass; archived evidence also scanned with the ignore file disabled |
| `node --check` for repository `.mjs` files                         | Pass                                                               |
| Repository file/workflow line limits                               | Pass; all within 1,500 lines                                       |
| `node scripts/check-package-manager.mjs`                           | Pass; npm declaration and lockfile agree                           |
| `node scripts/validate-changeset.mjs`                              | Pass; exactly one patch changeset                                  |
| `node scripts/check-version.mjs`                                   | Pass; release workflow manages the package version                 |
| Documentation validation and language synchronization              | Pass                                                               |
| `node scripts/check-dependency-freshness.mjs`                      | Pass; 168/168 declarations current                                 |

Raw local logs remain in ignored `ci-logs/`. The first full suite encountered one dependency-fixture regex still expecting `command-stream@1.3.0`; that expectation was corrected and its targeted test passes. The next run was stopped after exposing the cancellation fixture's metadata-read timeout; its failure is retained. Neither result is presented as a passing full suite.

## Dependency freshness

The approved CI run found five stale declarations already present on `main`: three Dockerfile pins of `start-command@0.35.1`, the runtime `command-stream@1.3.0` pin, and the runtime `@dotenvx/dotenvx@2.32.4` pin. Registry metadata reports 0.35.3, 1.4.0 and 2.33.0 respectively. The pins and fixtures are refreshed together as a separate maintenance step so the PR can pass the existing check. The change does not relax freshness enforcement. The initial local check found four stale pins before the dotenvx release; the later CI run provides the complete five-pin result. Original and fixed local output is retained under `data/dependency-freshness-{before,after}.log`.

## Initial CI investigation

| Run                                                                                                    | Created UTC, 2026-10-05 | Head SHA                                   | Initial conclusion | Approved attempt 2 |
| ------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------ | ------------------ | ------------------ |
| [Checks and release 37339179788](https://github.com/link-assistant/hive-mind/actions/runs/37339179788) | 16:13:40                | `424601c69f80806d3ff11336f296aab777a9346f` | action_required    | failure            |
| [Security 37339179190](https://github.com/link-assistant/hive-mind/actions/runs/37339179190)           | 16:13:39                | `424601c69f80806d3ff11336f296aab777a9346f` | action_required    | success            |

Both creation timestamps follow the prepared commit's 16:12:51 timestamp; both reference that exact head SHA. Their actor/triggering actor is `github-actions[bot]`. Initially no jobs or check runs were created, and log downloads returned `failed to get run log: log not found`; these responses are retained under `data/initial-ci-*.log`.

The authenticated Actions approval endpoint accepted both runs at 18:45 UTC, creating attempt 2 without requiring user intervention. Security's npm audit, dependency review and both CodeQL jobs passed. Checks failed in `detect-changes` on freshness before its implementation checks could run. The complete downloaded log is retained in `data/ci-checks-37339179788-attempt-2.log`:

- Line 2489: `STALE Dockerfile:309: start-command 0.35.1 -> 0.35.3`.
- Lines 2491–2492: the same stale pin in `Dockerfile.dind:324` and `Dockerfile.e2e:14`.
- Line 2493: `@dotenvx/dotenvx 2.32.4 -> 2.33.0`.
- Line 2494: `command-stream 1.3.0 -> 1.4.0`.
- Lines 2495–2496: `Dependency freshness failed: 5 stale, 0 unresolved`, exit code 1.

`Pipeline Status` propagated that failure; the release preflight passed. CI's synthetic merge checkout is `f1a43f971aa3a33b20724f78f571c6804fb9733b`; the event/run head SHA above identifies the prepared PR commit. This was a baseline dependency failure, not an effort regression. Fresh runs after the implementation push are matched to the new head SHA and checked independently.
