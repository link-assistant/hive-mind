## Problem

GitHub has announced that `ubuntu-latest` will migrate from Ubuntu 24.04 to
Ubuntu 26.04 beginning 2026-10-19 and completing by 2026-11-19. Current PR jobs
already emit this annotation:

> The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026.

The template currently contains 33 `ubuntu-latest` references across five
active workflow files at `e4f23d74e6679c24b584980977c74ab631f41576`.
Consumers generated from the template therefore inherit both the warning and
an unreviewed future change to their kernel, system libraries, compilers, and
preinstalled tools.

Official announcement and mitigation:
https://github.com/actions/runner-images/issues/14748

Production example showing the annotation on every Linux job:
https://github.com/link-assistant/hive-mind/actions/runs/35574886442

## Minimal reproduction

```bash
git clone https://github.com/link-foundation/js-ai-driven-development-pipeline-template.git
cd js-ai-driven-development-pipeline-template
rg -n 'ubuntu-latest' .github/workflows
```

Current result: 33 matches in `example-app.yml`, `links.yml`, `release.yml`,
`security.yml`, and `workflows.yml`.

Opening a PR that executes any of these jobs produces the runner-image
migration annotation even when the job otherwise passes.

## Workarounds

- Short term: pin `runs-on` and Linux matrix values to `ubuntu-24.04`.
- Migration test: explicitly opt selected jobs into `ubuntu-26.04` on a
  dedicated branch before changing the template default.
- Doing nothing is possible until rollout, but accepts warning noise and an
  environment change without a reviewed template commit.

## Suggested code fix

1. Replace all 33 active `ubuntu-latest` values with `ubuntu-24.04`, including
   Linux matrix `os` / `runner` values; leave macOS and Windows labels unchanged.
2. Add a small regression that scans `.github/workflows/*.yml` and fails if
   `ubuntu-latest` returns.
3. Run the Docker actionlint image and normal template smoke/integration tests.
4. Plan the Ubuntu 26 migration separately with explicit compatibility
   coverage, then change the pinned label in one reviewable commit.

GitHub lists `ubuntu-24.04` as a supported hosted-runner label, and its runner
image documentation explicitly recommends versioned labels to avoid unwanted
`-latest` migrations.
