# Local evidence — issue #2198 / PR #2199

Output captured on this machine while investigating and fixing the findings in
[`../README.md`](../README.md). Every file is verbatim tool output; the commands that
produced them are recorded below and, where relevant, in the analysis document that cites
the file.

**An empty file is a result, not a missing capture.** `actionlint`, `zizmor` and
`secretlint` print nothing when they find nothing, so a zero-byte `*-after.txt` is the
evidence that the gate passes.

| File | Command | Result |
| --- | --- | --- |
| `actionlint-before.txt` | `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color` at `main` | 15 reports, all in `release.yml`: 1 `expression`, 14 `shellcheck` |
| `actionlint-after.txt` | same, at the branch tip | empty — exit 0 |
| `actionlint-template.txt` | same, in the template checkout | empty — the template is clean under 1.7.12 too |
| `zizmor-before.txt` | `zizmor --min-confidence medium .github/` at `main` | `141 findings (57 ignored, 74 suppressed)`, of which `1 medium, 9 high` were reported at this floor |
| `zizmor-after-min-confidence-medium.txt` | `zizmor --min-confidence medium .github/` at the branch tip | `No findings to report. Good job! (67 ignored, 70 suppressed)` |
| `zizmor-low-confidence.txt` | `zizmor .github/` with **no** confidence floor, taken while F3's `artipacked` survey was being written | `128 findings … 28 informational, 29 low, 0 medium, 0 high` |
| `zizmor-after.txt` | the same no-floor run at the branch tip | `127 findings … 28 informational, 29 low, 0 medium, 0 high` — the 29 low `artipacked` findings were reviewed, not suppressed |
| `zizmor-template.txt` | `zizmor --min-confidence medium .github/` in the template checkout | exit 12, 4 `self-repository` findings (`publish-dockerhub/action.yml:38`, `release.yml:379,711,751`) — the evidence behind the third upstream report |
| `secretlint-before.txt` | `npx secretlint "**/*"` before any config existed | 22 findings across 12 files |
| `secretlint-after.txt` | `npm run check:secrets` at the branch tip | empty — exit 0 |
| `repro-before-fix.txt` | F1's reproduction at `main` | `spawn bun ENOENT` |
| `repro-after-fix.txt` | the same reproduction after `5e918d50` | npm resolved, no spawn |
| `template-package-manager-detection.txt` | `package-manager-detector` probed directly | `LOCKS` insertion order, the root cause of F1 |
| `npm-link-allow-scripts.txt` | F4's attempt matrix | which npm flags silence the warning, and which do not |
| `lint.txt` | `npm run lint` | clean |
| `format.txt` | `npm run format:check` | clean |
| `actionlint-self-repository-probe.txt` | `experiments/issue-2198/actionlint-zizmor-self-repository-probe.sh` | the 2x2 matrix behind F11: `./` passes actionlint and fails zizmor, `$/` passes zizmor and fails actionlint 1.7.7 *and* 1.7.12 |
| `full-test-run.txt` | `node scripts/run-tests.mjs` | trimmed: file count, absence of the failure banner, final line |

## Reproducing

zizmor is not a repository dependency; it was installed for this investigation with:

```bash
python3 -m pip install zizmor==1.30.0
```

actionlint is run as the **Docker image**, not a bare binary, for the reason recorded in
[`../analysis/F3-no-workflow-lint-gate.md`](../analysis/F3-no-workflow-lint-gate.md): the
image bundles shellcheck, so `run:` blocks are linted. A bare binary silently skips them
and exits 0 — which is how F2's 14 shellcheck findings stayed invisible.
