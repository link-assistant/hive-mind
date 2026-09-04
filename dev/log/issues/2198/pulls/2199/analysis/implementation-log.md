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

## Merging `main`

`main` moved while this PR was open (`3b7c4eaf`, issue #2186). Two of its changes met this
branch head-on, and both are recorded here because each is an instance of what the issue
asks about.

**`bun.lock` — modify/delete.** #2186 *regenerated* the lockfile ("stale enough to still
list `@changesets/cli ^2.27.0`"); F1 *deletes* it. Regenerating does not address F1: the
release died on `spawn bun ENOENT`, which is the `bun` binary being absent from the runner,
not the lockfile being stale — a freshly generated `bun.lock` makes `@changesets/format`
spawn `bun` just the same. Nothing in `main`'s workflows, `package.json` or `scripts/`
references bun (`git grep` on `origin/main` returns nothing), so the file is still what F1
found it to be: inert input that only one tool reads. Resolved in favour of the deletion,
which `devEngines.packageManager` and `tests/no-bun-lockfile-2198.test.mjs` hold down.

**`actions/checkout@v6` → `@v7`.** #2186 bumped every `uses:` in the tree; the nine that
remained on v6 after the merge were, all nine, steps *this branch added* (`workflows.yml`,
`links.yml`, the new `security.yml` audit job, four new `release.yml` checkouts). Git
merged both sides cleanly and produced a pipeline running two major versions of the same
action — no conflict, no warning, nobody's mistake. Bumped to v7 to match.

**`src/agent.lib.mjs` 1309 → 1357.** See [F6](F6-file-line-limit-warnings.md#the-guard-earning-its-keep):
the merge reintroduced the warning class F6 removed, `tests/extracted-modules-2198.test.mjs`
caught it locally before CI, and the Agent CLI version floors moved to
`src/agent.version-gates.lib.mjs` (1357 → 1309, every name re-exported).

---

## F15 — found by distrusting our own green

Every workflow was green at `d871d1f9`, which is where this PR could have stopped. Opening
the job list instead of the run summary showed why it should not have:
`test-suites`, `test-compilation`, `check-file-line-limits` and `memory-check-linux` all
**skipped**, because the head commit was documentation-only. The commit before it —
`237acd2d`, the extraction of `src/agent.version-gates.lib.mjs` — had its run cancelled
one minute in, with zero jobs recorded.

Green over untested code, produced by two mechanisms this repository deliberately added:
#1665's incremental diff and #2082's `cancel-in-progress`. Neither is wrong. Their
composition is. Full analysis in
[`F15-incremental-detection-trusts-untested-head.md`](F15-incremental-detection-trusts-untested-head.md).

Three things are worth recording about the fix itself.

**The reproducing test came first and was seen to fail.** It drives the real
`scripts/detect-code-changes.mjs` against a stub of the Actions API bound to
`GITHUB_API_URL` — the lookup runs end to end, offline, with nothing in the code under
test mocked out.

**The first draft introduced a worse false negative.** Returning `null` for an unverified
head let `getChangedFiles` fall through to its full-PR branch, which without a base SHA
falls through *again* to `HEAD^..HEAD` — one commit, narrower than the range it replaced.
`tests/test-detect-code-changes-1528.mjs` failed on it immediately (*"multi-commit push …
Expected output to include `src/feature.mjs`"*), which is the whole return on keeping an
old suite green. The rule is now explicit in the code and asserted in the test: widening
must never narrow.

**The stub deadlocked the test.** The stub server lives in the test process, so
`execFileSync` blocked the event loop that had to answer the child's request — parent
waiting on child, child waiting on parent, no output from either. Async `execFile` with an
explicit timeout; the comment above `run()` says why, since the synchronous form is the
obvious thing to reach for and fails silently by hanging.

Both directions are mutation-checked: forcing `previousHeadWasTested` to `true` reproduces
the original defect, and restoring the `return null` draft fails the widening assertion.

The template has the same hole through two routes, one of which needs no cancellation at
all — reproduced with its own detector in
[`experiments/issue-2198/template-detect-changes-untested-commits.sh`](../../../../../../../experiments/issue-2198/template-detect-changes-untested-commits.sh)
and reported as
[js-ai-driven-development-pipeline-template#156](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/156).

## F16 — the first run F15 let through, and what it caught

The F15 fix did the thing it was built to do on run
[33890315861](https://github.com/link-assistant/hive-mind/actions/runs/33890315861):
`test-suites`, `test-compilation`, `check-file-line-limits` and
`memory-check-linux` all ran, where the run before it had skipped them. The
first thing they found was a defect in this PR's own work.

`test-suites` failed with four assertions from
`tests/test-issue-2198-npm-link-scripts.mjs`, the test written for F4, saying
npm had fixed `linkPkg()`. It had not. The runners had moved 11.17.0 → 11.19.0,
renaming the log prefix `npm warn allow-scripts` to `npm warn install-scripts`;
the test matched the old label as a literal.

Checked rather than inferred, because the CI log truncates the warning at 400
characters: `experiments/issue-2198/npm-allow-scripts-warning-rename.sh` links
the same fixture under both npms, and a policy probe re-ran all four knobs under
each. Every behaviour is identical across the two releases — bare `npm link`
warns, no `allowScripts` form covers it, `--ignore-scripts` silences it and
skips `prepare`. Only the labels moved. The `test-execution` job, the one that
actually runs the workaround, printed zero warnings under 11.19: the fix was
never in question, only its detector.

The detector now keys on `not yet covered by allowScripts`, the sentence that
states the defect and is byte-identical across both releases, with either
shipped prefix as a fallback signal. Both labels are pinned as samples and
asserted against the matcher, so narrowing it back fails at once rather than on
the runners' next bump — verified by mutating it back and watching the 11.19
sample assertion fail, and by forcing the matcher to never match and watching
the bare-link assertion fail. 11 passed, 0 failed under each npm.

The failure message was the other half of the defect. It named one cause — "npm
fixed linkPkg()" — for a symptom with two, and the wrong one was the one that
happened. It now names both and points at the experiment that separates them.

## F17 — the alerts that were already on this PR

Checking PR #2199 for review comments before finishing turned up two, both from
`github-advanced-security[bot]`, both high severity, both on
`tests/setup-buildx-resilient.test.mjs` — the test written for F10 in this same
PR. They had been sitting there since 14:27.

CodeQL called `result.calls.includes('mirror.gcr.io')` incomplete URL
sanitization. It is not sanitization at all: `result.calls` is a file the
test's own mock `docker` wrote, and nothing downstream trusts it. But the
assertion really was loose — "the mirror was contacted" should mean a pull
whose registry *is* the mirror, and a substring search says only that the name
appeared somewhere.

Rewriting it as a structured comparison over parsed `docker` calls retires both
alerts without suppressing anything, and failed on the first run: with both
registries down the mirror is attempted twice, once per `PREPULL_ATTEMPTS`, and
the loose assertion could not tell one attempt from two. The retry budget is now
pinned — mutating `PREPULL_ATTEMPTS` from 2 to 3 fails the test.

The wider state came out while checking whether the rule fired elsewhere.
`analyze@v4` carries no severity threshold and does not fail a job on findings,
so `Security` is green while `main` carries 130 open alerts — 1 critical, 106
high. That is this issue's own shape, and it is also outside this PR's reach:
the threshold lives in repository settings, and enabling it today would fail
every PR against a backlog nobody has triaged. Inventoried in
`analysis/F17-codeql-alerts-never-gate.md` so the decision can be made
deliberately; the alerts themselves are application-code findings and belong in
their own issue.

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
| `npm run check:duplication` (jscpd) | exit 0 at **10.32 %** against the configured 11 % threshold — and the threshold is real, not decorative: re-running the same config with `threshold: 1` exits **1**, so this gate does fail when the property it guards is broken |

