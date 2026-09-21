# Full CI/CD template comparison

Compared on 2026-09-21 against `link-foundation/js-ai-driven-development-pipeline-template` head `f2cd4d8623557241fa4127a57a77461751a2f734`. The raw full tree is `research/template-file-tree.txt`; `research/template-github.diff` and `research/template-scripts.diff` preserve complete directory comparisons rather than a hand-selected subset.

## File-tree disposition

| Area | Template | Hive-mind | Disposition |
| --- | --- | --- | --- |
| Main checks/release workflow | `.github/workflows/checks.yml` / release flow | `.github/workflows/release.yml` | Product workflow is substantially extended; compare behavior, do not replace wholesale |
| Security | CodeQL, dependency review, npm audit | `.github/workflows/security.yml` and scripts | Equivalent/harder product coverage retained |
| Broken links | Lychee plus fail-closed reporting | `.github/workflows/broken-link-check.yml` | Existing product implementation retained; cited run green |
| Workflow lint | actionlint/zizmor checks | `.github/workflows/workflows.yml` | Existing workflow and tests retained; cited run green |
| Terminal verdict | Pipeline-status job/script | `pipeline-status` + `scripts/check-pipeline-status.sh` | Equivalent best practice already present and accurately propagating failures |
| Runner images | Pinned Ubuntu 24.04 in current template | Pinned in all active owned workflows, enforced by test | Already aligned |
| Package-manager guard | Template pre-install check | `scripts/check-package-manager.mjs` | Already aligned |
| Dependency freshness | Template exact freshness checks | `scripts/check-dependency-freshness.mjs` in detect-changes | Product gate found the initial PR issue; retained and satisfied |
| Release preflight | Template credential/precondition proof | Reusable `.github/workflows/release-preflight.yml` | Product implementation retained |
| Protected-release fallback | Current template mandates `RELEASE_PR_TOKEN` | PR 2280 had equivalent `RELEASE_PULL_REQUEST_TOKEN` | Shared PAT-only assumption is incompatible with maintainer requirement; replaced locally and reported upstream |
| Version tooling | Changesets scripts/action | Changesets plus custom self-healing/publish recovery | Custom logic retained because it covers races, partial releases, npm visibility, Docker, and Helm |
| Examples and fixtures | Generic sample JS/TS projects and release fixtures | Real application, Docker, Helm, Coolify, and extensive issue regression tests | Template-only sample content is not applicable product code |
| Dependabot | Generic manifest ecosystem | Root, Docker, Coolify, and experiment scopes | Product-specific configuration retained |
| Composite actions | Generic setup | Resilient Buildx and repository-specific setup actions | Product-specific; no missing equivalent identified |

## Applicable practices verified

- fail-closed terminal status context;
- explicit job timeouts and bounded internal waits;
- pinned Actions and runner images;
- least-privilege job permissions;
- dependency freshness before expensive tests;
- package-manager/lockfile consistency;
- secret scanning, workflow linting, syntax, formatting, duplication, tests, memory checks, docs, Docker, Helm, and security gates;
- release preflight before mutation/publication;
- auditable PR landing for protected main;
- changeset/release trigger for user-visible behavior.

## Important differences that are intentional

The template is a generic scaffold. Hive-mind must keep its Docker multi-platform publish, DinD image, Helm chart, source maps, npm propagation recovery, release self-healing, dynamic change detection, and broad regression suite. Copying the template tree would delete or weaken those product requirements.

The current template's newly merged protected-release change requires a PAT/App secret. It solves recursive workflow suppression by changing actors. This repository's maintainer explicitly rejects that new secret, and current GitHub behavior also places built-in-token PR workflows into `action_required`. The local design instead makes the already validated parent run publish its result on a metadata-only child commit with the existing GitHub Actions App installation token.

## Shared defect and upstream action

Template issue 192 accurately reproduced the original deadlock; template PR 195 chose the token-based workaround. A follow-up report is required because installations that do not provision `RELEASE_PR_TOKEN` will fail exactly as hive-mind run 35587213311 did. The report includes:

- a minimal ruleset + changeset release reproduction;
- GitHub's current approval-required behavior;
- PAT/App/human-approval workarounds;
- the parent-validation + metadata-only commit + Checks API implementation plan;
- fail-closed ordering and permission constraints.

The report was submitted as [template issue 196](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/196). Its exact body, API response, initial comments response, and URL are stored as `research/upstream-follow-up-*`.
