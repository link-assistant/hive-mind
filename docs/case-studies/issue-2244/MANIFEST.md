# Issue #2244 Evidence Manifest

All paths are relative to this case-study directory. `evidence/SHA256SUMS`
provides a sorted SHA-256 inventory. JSON captures are raw GitHub API responses
unless stated otherwise.

| Path                                                    | Description and provenance                                                                                                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence/issue-2244.json`                              | Full issue metadata/body fetched with `gh api repos/link-assistant/hive-mind/issues/2244`.                                                                                                                                       |
| `evidence/issue-2244-comments.json`                     | All issue comments fetched with the paginated GitHub API.                                                                                                                                                                        |
| `evidence/pr-2245.json`                                 | Existing PR metadata captured before implementation.                                                                                                                                                                             |
| `evidence/pr-2245-conversation-comments.json`           | PR conversation comments endpoint.                                                                                                                                                                                               |
| `evidence/pr-2245-review-comments.json`                 | Inline PR review comments endpoint.                                                                                                                                                                                              |
| `evidence/pr-2245-reviews.json`                         | PR reviews endpoint.                                                                                                                                                                                                             |
| `evidence/task-log-gist.json`                           | Authenticated GitHub Gist metadata for the linked task log.                                                                                                                                                                      |
| `evidence/task-start.log`                               | Raw original start-command log downloaded from the issue's Gist. This is the primary execution evidence.                                                                                                                         |
| `evidence/task-status.png`                              | Authenticated download of the issue screenshot. PNG magic/type was verified before visual inspection.                                                                                                                            |
| `evidence/related-prs/pr-*.json`                        | Metadata, descriptions, and file lists for merged PRs #1915, #1940, #1989, #2137, #2197, and #2227. These cover native isolation, diagnostics, the size baseline, kill handling, resume behavior, and recent Docker launch work. |
| `evidence/upstream/hive-mind-2.22.0-*`                  | Exact Hive Mind v2.22.0 package, DinD Dockerfile, and isolation runner source from commit `412e00da227d51dfb2b21a568914f380cf4d0047`.                                                                                            |
| `evidence/upstream/hive-mind-dind-2.22.0-manifest.json` | Registry manifest for the reported image tag; the reproduction pins its amd64 digest.                                                                                                                                            |
| `evidence/upstream/box-v2.4.0-dind-entrypoint.sh`       | Exact Box DinD entrypoint version included by Hive Mind v2.22.0.                                                                                                                                                                 |
| `evidence/upstream/start-command-0.33.0-*.js`           | Exact start-command isolation and Docker-cleanup implementation used by Hive Mind v2.22.0.                                                                                                                                       |
| `evidence/upstream/gh-manager-issue-4*.json`            | Target issue metadata/comments as visible to the authenticated investigator.                                                                                                                                                     |
| `evidence/reproduction/summary.json`                    | Consolidated result of the exact-image reproduction.                                                                                                                                                                             |
| `evidence/reproduction/*-inspect.json`                  | Complete Docker state/config for normal, fixed-helper, deliberate-SIGKILL, and verbose runs.                                                                                                                                     |
| `evidence/reproduction/*-console.log`                   | Docker console output for each reproduction run.                                                                                                                                                                                 |
| `evidence/reproduction/*-dockerd.log`                   | Internal daemon output when it was written to the default file. The verbose file is empty by design because the daemon was redirected to stderr.                                                                                 |
| `evidence/reproduction/normal-size-rw*`                 | Output and 10-second observation marker for the unbounded pre-fix `docker inspect --size` request.                                                                                                                               |
| `evidence/reproduction/fixed-size-probe.log`            | Verbose fixed-helper timeout message and measured 10.028-second duration.                                                                                                                                                        |
| `evidence/upstream/moby-inspect-size-issue.md`          | Body submitted to the Moby project, including reproducer, workaround, environment, and suggested fix.                                                                                                                            |
| `evidence/upstream/moby-issue-53641.json`               | API response for the filed [moby/moby#53641](https://github.com/moby/moby/issues/53641).                                                                                                                                         |
| `evidence/upstream/moby-issue-53641-comments.json`      | Upstream issue comments at capture time.                                                                                                                                                                                         |
| `evidence/reproduction-environment.txt`                 | Host engine/runtime, immutable image, and release identifiers used for reproduction.                                                                                                                                             |
| `evidence/logging/before/*`                             | Pre-fix measurement of the logging pipeline: session log, empty `docker logs`, container inspect, three `$ --status` queries, and the decoded store record. Produced by `experiments/issue-2244-start-command-log-gaps.sh`.      |
| `evidence/logging/after/*`                              | Post-fix verification: session log with the narrated gate, the generated task command, the host snapshot directory, and the pass/fail summary. Produced by `experiments/issue-2244-verify-full-logs.sh`.                         |
| `evidence/logging/upstream-repro/*`                     | Standalone start-command reproduction (no Hive Mind code involved) supporting the upstream reports: container inspect, session log, two `--status` queries four seconds apart, and the persisted store record.                   |
| `evidence/upstream/start-issue-170*`                    | Body submitted to link-foundation/start and the API response for [#170](https://github.com/link-foundation/start/issues/170) (terminal state not persisted, `endTime` fabricated).                                               |
| `evidence/upstream/start-issue-171*`                    | Body submitted to link-foundation/start and the API response for [#171](https://github.com/link-foundation/start/issues/171) (post-mortem facts omitted from the retained log).                                                  |

## Acquisition notes

- GitHub resources were fetched with authenticated `gh api`, `gh gist view`, or
  `curl -L -H "Authorization: token …"` requests.
- The screenshot was validated as PNG rather than HTML before inspection.
- The container image was pulled and run as
  `docker.io/konard/hive-mind-dind@sha256:b5e71481abcc540a881d805007051211c09661911379f40e248fa4bd064fe6d7`,
  avoiding mutable-tag ambiguity.
- The reproduction was generated by
  `experiments/issue-2244-reproduce-dind-startup.sh`. Each run's inspect JSON is
  preserved before a cleanup trap removes its test container.
- The `logging/` captures use `alpine:3.20` rather than the 19.7 GB DinD image:
  the incident's _shape_ (a gated, detached Docker session SIGKILLed a few
  seconds in) is what they measure, and the small image makes each run
  repeatable in seconds. The one consequence is recorded in the after-summary —
  a plain alpine container has no nested daemon, so `dockerd.log` is absent.
- `logging/upstream-repro/` was produced by
  `experiments/start-command-detached-terminal-state.sh`, which invokes only
  `$`, `docker`, and `node`, so the upstream reports do not depend on any Hive
  Mind code being installed.
- The issue status references a retained container from September 9. That
  original container was unavailable on the investigation host; its inspect,
  internal daemon log, Docker events, host journal, kernel log, and cgroup
  memory events could not be recovered.
