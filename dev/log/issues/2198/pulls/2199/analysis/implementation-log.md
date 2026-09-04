# Implementation log — issue #2198 / PR #2199

What changed, why, and how each change was proven. Findings are numbered as in
[`../README.md`](../README.md).

The discipline required by the task brief: **a test that reproduces the defect is written
and seen to fail before the fix**. Where the finding is a missing gate rather than a
behavioural defect, there is no failing execution to reproduce — so the enforcement test
is instead **mutation-checked**: the tree is deliberately broken and the assertion is
verified to fail. A guard whose test cannot be made to fail is not evidence of anything.

| Finding | Class | Commit | Reproduced before the fix | Guard mutation-checked |
| --- | --- | --- | --- | --- |
| F1 | Error | `5e918d50` | yes — `../local/repro-before-fix.txt` | yes |
| F2 | False negative (aggregate) | `2cf01935` | yes — 25 findings in `../local/actionlint-before.txt` + `../local/zizmor-before.txt` | yes |
| F3 | False negative (missing gate) | `e6152f95` | n/a¹ | yes — the gate reports F2's 25 findings |
| F4 | Warning (upstream defect) | `ca8eacd6` | yes — `../local/npm-link-allow-scripts.txt` | yes — the test re-derives the warning from scratch |
| F5 | False negative | `515843e8` | yes — `git status` mode flip after `npm link` | yes |
| F6 | Warning | `bcc3df08` | yes — 2 `::warning` annotations in the run log | yes |
| F7 | False positive | `e5e99f32` | yes — the existing test failed on the correct change | n/a² |
| F8 | False negative (missing gate) | `b1479a18` | n/a¹ | yes — 22 findings on first scan, `../local/secretlint-before.txt` |
| F9 | False negative + live defect | `d1832ad6` | yes — the new test fails on the pre-fix tree | yes |
| F10 | Fragility | `6501cdd3` | n/a³ | yes — `not ok 2 - checks out before referencing the local composite action` |
| F11 | False positive | `6501cdd3` | yes — both `uses:` forms tried, both gates observed | n/a⁴ |
| F12 | False negative (missing gate) | `19a25d4d` | n/a¹ | yes — 4 failing assertions on the pre-fix tree |
| F14 | False negative (4 dead links) + false positive (13 by design) | this commit | yes — the gate’s first CI run, 18 errors | yes — 3 mutations, each caught |
| R7 | Guide gap (both gates undocumented) | `a4bea2c6` | yes — the new test fails on the 3 untranslated files | yes — 3 mutations of the English text, each caught |

¹ A missing gate has no failing execution: nothing was running, so nothing could fail.
The evidence is what the gate reports the moment it exists.
² The finding *is* a failing test; there is nothing further to mutate.
³ No red run of this repository exists. The finding comes from the template comparison
(F13), and the mitigation is prophylactic. What *is* proven is the bug the port itself
introduced (late checkout) and its guard.
⁴ A documented, scoped ignore with a stated removal condition, not a code change.

---

## The recurring mechanism

Four of these findings are the same mistake wearing different clothes, and it is worth
stating once: **a control that looks like coverage and checks nothing.**

- `secretlint` in `dependencies`, never invoked as a linter (F8).
- `security.yml` with two jobs, neither of which audits the dependency tree (F12).
- `build:pre`, which chmods bins and is referenced by nothing, with a list drifted to 5 of
  10 (F5).
- `tests/ci-integrity-2150.test.mjs`, asserting `permissions: read-all` — pinning the
  defect it was written to prevent (F7).

None of these is visible to an audit that asks *"is there a secret scanner / a security
workflow / a chmod step / a CI-integrity test?"*. All four answer yes. The question that
finds them is *"what happens if I break the thing it claims to protect?"* — which is why
every guard added here is mutation-checked rather than merely written.

---

## Per-finding notes

### F1 — `5e918d50`

Removed `bun.lock`; declared `devEngines.packageManager`; added
`scripts/check-package-manager.mjs` to the lint job and made lockfile changes count as
package changes in `detect-code-changes.mjs` so the guard cannot be gated out of a run
that touches only lockfiles. The `LOCKS` probe order was confirmed by running
`package-manager-detector` directly
(`experiments/issue-2198/detect-package-manager.mjs`), not inferred from its README.

### F2 — `2cf01935`

The 14 shellcheck findings were mostly four byte-identical copies of the manifest merge.
Extracting them to `scripts/create-manifest-list.sh` fixed the word-splitting bug once
instead of four times, and added two refusals that did not exist in any copy: fail when
there are no tags, and fail when there are no digests, rather than pushing an untagged
manifest. `DRY_RUN` makes the exact command line assertable.

### F3 — `e6152f95`

Ported `.github/workflows/workflows.yml` from the template. actionlint runs as the Docker
image so shellcheck is present; zizmor reports annotations rather than SARIF so it fails
loudly on forks. The 29 low-confidence `artipacked` findings were surveyed rather than
suppressed — five jobs and two scripts genuinely use the persisted credential
(`../local/zizmor-low-confidence.txt`).

### F4 — `ca8eacd6`

`--ignore-scripts`, the only lever that works, and it costs nothing: the skipped script is
this package's own `prepare: husky`, already run by the install step of the same job.
The test re-derives the warning against whatever npm is on `PATH`, so when npm fixes
`linkPkg()` the test fails and says the workaround can go. The workaround is dated, not
permanent.

### F5 — `515843e8`

`build:pre` regenerated from the bin map. The test reads modes from the **git index**, not
the working tree — `npm link` rewrites the working tree, so a working-tree assertion would
pass by accident on any machine that has run it.

### F6 — `bcc3df08`

Extraction, not threshold-raising: `solve.repository.lib.mjs` 1373 → 1316,
`telegram-bot.mjs` 1377 → 1307. The enforcement test reads the threshold from
`scripts/check-file-line-limits.sh` so the two cannot disagree. Adding F8's step later
pushed `release.yml` itself over the threshold, which the same test caught; the
memory-check smoke blocks moved out (1360 → 1322).

### F7 — `e5e99f32`

The interesting part is that the *test* was wrong, not the workflow. Its own message said
"least-privilege"; its assertion said `read-all`. Now it rejects `read-all` outright and
requires `contents: read`, applied to all four workflows.

### F8 — `b1479a18`

Fail-closed. `.secretlintignore` exempts only files whose entire purpose is holding a fake
secret; the two token-shaped placeholders in the coolify docs were rewritten instead of
exempted, so those files stay in scope. The test fails if the ignore list grows a blanket
or source-tree entry — because the cheapest way to make a secret scan pass is to widen its
ignore file.

### F9 — `d1832ad6`

Two complementary checks (offline test, network workflow) and one design point that is
the whole finding: `fail: false` plus a separate `exit 1` step. The test asserts **both**,
because keeping the first without the second is how a link checker becomes a silent pass.

The one genuine false positive found while writing it — `CHANGELOG.md:2155` — was a code
span wrapping a soft line break, fixed by masking code document-wide instead of line by
line, replacing masked characters with spaces so line numbers stay accurate.

### F10 / F11 — `6501cdd3`

The port introduced a real bug (a local composite action referenced before checkout in
four jobs) which its own test caught. The test drives the pre-pull script **extracted from
`action.yml`**, not a transcription, so it cannot pass after the real script drifts.

F11 is the cost of F3 having two gates: they now disagree, and no `uses:` form satisfies
both. Resolved by keeping the form that works, scoping the ignore to one file, and writing
down the removal condition.

### F12 — `19a25d4d`

`npm audit --package-lock-only --audit-level=high`, ported from the template's
`security.yml` without its workspace matrix. `--package-lock-only` means the job reports
what a consumer would get, and cannot be turned green by a resolution that only happens on
this runner. Because it lives in `security.yml` it inherits the `schedule:` trigger — the
only thing that can notice an advisory published after the code stopped changing.

### R7 — `a4bea2c6`

The issue requires the work to follow `docs/CI-CD-BEST-PRACTICES.md`. Two of the findings
above are gates that guide never described — workflow linting (F3) and dependency auditing
(F12) — so following it could not have prevented either. Both are now written into it as
§14 and §15, in all four translations, with the detail that actually costs time to learn:
actionlint run as a bare binary skips every `run:` block and exits 0, which is
indistinguishable from passing.

`tests/cicd-best-practices-pipeline-gates-2198.test.mjs` pins them the way #2152 pins §13.
It was seen to fail on the three untranslated files, and three separate weakenings of the
English text — removing `exits 0`, deleting the schedule bullet, and changing
`--audit-level=high` in one translation only — were each verified to fail the suite.

---

## Verification state

All run locally against the branch tip:

| Check | Result |
| --- | --- |
| `actionlint 1.7.12` (Docker image, shellcheck included) | exit 0, no output |
| `actionlint 1.7.7` (the template's pin) | exit 0 |
| `zizmor 1.30.0 --min-confidence medium .github/` | exit 0 — `No findings to report. Good job! (67 ignored, 70 suppressed)` |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run check:secrets` | exit 0 |
| `npm audit --package-lock-only --audit-level=high` | `found 0 vulnerabilities` |
| `scripts/check-file-line-limits.sh` | all files within the limit, no warnings |
| Full test suite (`scripts/run-tests.mjs`) | see `../local/full-test-run.txt` |
