# Verification record

Baseline branch head `9021ba8f987a81a6727ff6bd9c0fee13c8641bdc` had no cache defaults in the managed environment, generated settings or stock images. The first three tests in `tests/issue-4124-prompt-cache.test.mjs` failed on that head for those missing values. The final four tests pass, including the regression for projecting explicit overrides into isolated Docker tasks.

## Native Claude Code wire reproduction

```bash
node experiments/issue-4124/probe-claude-cache.mjs /path/to/claude
```

The fixture uses a fresh temporary home per run, a synthetic key and a localhost-only Anthropic Messages API. It has the actual CLI invoke its Agent tool and inspects `cache_control` on the resulting requests. A marker without a TTL field represents `5m`. The fixture makes no live model calls.

| Claude 2.1.316 and 2.1.319                           | Main TTL | Subagent TTL |
| ---------------------------------------------------- | -------- | ------------ |
| Empty settings and upstream defaults                 | `5m`     | `5m`         |
| Hive Mind managed environment                        | `1h`     | `1h`         |
| Generated native settings alone                      | `1h`     | `1h`         |
| Managed environment with subagent set to `5m`        | `1h`     | `5m`         |
| Managed environment with `FORCE_PROMPT_CACHING_5M=1` | `5m`     | `5m`         |

## Local regression set

The following Node test run passed all 78 tests. The existing cache-cost cases also verify that 5m, 1h, mixed and untagged usage are priced correctly.

```bash
node --test --test-concurrency=1 \
  tests/issue-4124-prompt-cache.test.mjs \
  tests/test-configure-claude-bin.mjs \
  tests/test-agent-commander-option.mjs \
  tests/test-organize-workflow.mjs \
  tests/test-task-split.mjs \
  tests/test-issue-1951-cache-ttl-cost.mjs \
  tests/test-docker-dind-variant.mjs \
  tests/test-docker-release-order.mjs \
  tests/issue-3785-router-connection-admission.test.mjs \
  tests/issue-3785-router-task-environment.test.mjs \
  tests/test-build-resume-command.mjs
```

The initial PR head had a Security PR run awaiting action with no jobs or downloadable log. A checks-only dispatch on the same SHA passed. This was a workflow admission result and supplied no evidence about Claude caching. [PR Security run](https://github.com/link-assistant/hive-mind/actions/runs/45008046583) · [Security checks-only run](https://github.com/link-assistant/hive-mind/actions/runs/45008058383)

The first run with the implementation stopped before testing at the dependency freshness gate. Its log reports 29 stale declarations and lockfile entries shared with the base branch. The pins and lockfile were refreshed in a separate commit so the normal PR checks could run. [Dependency freshness job](https://github.com/link-assistant/hive-mind/actions/runs/45027447484/job/137223454216)
