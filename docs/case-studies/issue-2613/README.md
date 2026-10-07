# Issue #2613: failed sessions, leaked probes and missing logs

Investigated on 2026-10-07 for [issue #2613](https://github.com/link-assistant/hive-mind/issues/2613) and [PR #2614](https://github.com/link-assistant/hive-mind/pull/2614). The issue references both a Claude exit-137 incident and failed Formal AI drafts. They have different immediate failures, with a common need to preserve diagnostic evidence.

## Evidence and timeline

All times below are UTC. Full downloaded logs, comments, run metadata, upstream source and bounded replays are in [evidence](evidence/). [log-manifest.json](evidence/log-manifest.json) records published sizes, line counts and SHA-256 digests; [publication-sanitization.json](evidence/publication-sanitization.json) records the original hashes and publication sanitizer results. Originals had already been redacted by GitHub or Hive Mind; the publication sanitizer was applied again before committing. Line references remain valid.

| Time               | Event                                                                                                                                                 | Evidence                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 07:14–07:18        | Formal AI attempt for issue #2591 reads nonexistent `e.g`, cannot upload a Gist, then fails label creation, checks dispatch and artifact preservation | [formal-job-2591.log](evidence/formal-job-2591.log), lines 2654–2843, 4334–4349, 4387–4391, 4414, 4444; [run 37585287501](https://github.com/link-assistant/hive-mind/actions/runs/37585287501) |
| 09:07:44           | Claude container starts with approximately 2.92 GiB memory and equal memory-swap limit                                                                | [killed-session.log](evidence/killed-session.log), final post-mortem and isolation limit                                                                                                        |
| 09:09–09:41        | Claude investigates model aliases; it starts the default test suite and another version-info test while work continues                                | [claude-failure.log](evidence/claude-failure.log); [log-findings.json](evidence/log-findings.json)                                                                                              |
| 09:41:08           | Claude exits 137                                                                                                                                      | [claude-failure.log](evidence/claude-failure.log), line 41895                                                                                                                                   |
| 09:41:14           | Cleanup finds 105 live processes, including repeated Gemini, Copilot, Agent and OpenCode version probes                                               | Same log, lines 41915–42019                                                                                                                                                                     |
| 09:41:58–09:42:46  | Work is saved on recovery branch, then the failure log is successfully uploaded using a user token                                                    | Same log, line 42066 onward; [recovery-commit.json](evidence/recovery-commit.json); [comment 6035301295](https://github.com/link-assistant/hive-mind/pull/2592#issuecomment-6035301295)         |
| 09:42:47           | Container exits 1 with sticky `OOMKilled: true`; later host memory figures are healthy after child cleanup                                            | [killed-session.log](evidence/killed-session.log), final post-mortem                                                                                                                            |
| 09:54              | Wrapper reports and resumes the failed attempt                                                                                                        | [PR #2592 comments](evidence/pr-2592-comments.json), comments 6035478435 and 6035478778                                                                                                         |
| 10:01–10:05        | Formal AI repeats the same file-read and log-preservation failures on issue #2613                                                                     | [formal-job-2613.log](evidence/formal-job-2613.log), lines 4268, 4331–4346, 4384–4386, 4413, 4443; [run 37603515653](https://github.com/link-assistant/hive-mind/actions/runs/37603515653)      |
| 10:01:37–38        | Initial PR security and release checks report `action_required` for `f77d772a`; there are no job logs to download                                     | [initial-ci-runs.json](evidence/initial-ci-runs.json), initial run metadata                                                                                                                     |
| 14:23              | Exact Formal AI abbreviation bug is reported upstream by a related investigation                                                                      | [formal-ai #1189](https://github.com/link-assistant/formal-ai/issues/1189), [saved report](evidence/upstream-formal-ai-1189.json)                                                               |
| This investigation | Bounded subprocess/Gist/log-directory regressions fail before changes; fixes pass; installed Formal AI replay reproduces the upstream bug             | [experiments](../../../experiments/issue-2613/), validation evidence                                                                                                                            |

The first `gh run view --log` downloads stopped early at terminal-control-sequence protection. These incomplete files are retained as `formal-draft-*.log` to explain that acquisition failure. The authoritative `formal-job-*.log` files were downloaded directly from the job-log API with `gh api --allow-escape-sequences`; each has about 4460 lines and contains the actual final failures. Both artifact APIs returned zero artifacts. The solve logs named in those vanished containers cannot be recovered separately; the complete workflow console logs retain their diagnostics.

The 105 processes are not all version probes: the list also includes the agent's shell, test runner and pipelines. This investigation attributes the repeated version probes to the version library, not every listed process.

## Root causes and fixes

### 1. Unbounded version checks leak subprocesses

`getVersionInfo()` launches roughly 65 commands using `Promise.all`. Several commands start shells, Node/Bun CLIs and additional grandchildren. The helper used `child_process.exec` with a five-second timeout, which kills the shell but leaves grandchildren alive. Two version-info unit files repeatedly queried the real environment, multiplying that resource use. The incident's live-process list includes both the default suite and a separate version-info run.

The minimal reproduction starts one Node process with a 32 MB heap and a finite four-second lifetime, then times out its shell after 600 ms. Before the fix, the child remains alive. The regression explicitly cleans up that child even when the assertion fails. The fix runs probes in dedicated POSIX process groups, kills the group on timeout, excess output or shell exit, and waits for pipe closure with a bounded cleanup grace period. Output remains capped at 1 MiB. A shared four-command limit applies across simultaneous callers; its test uses eight small finite probes. Missing commands and invalid output still return `null`, and version normalization/exports remain compatible.

The two unit files inject command results instead of starting all installed runtimes for schema/format assertions. Existing parser tests cover the unchanged normalization module. Version-probe PID, deadline, elapsed time, result and output-size diagnostics are enabled for verbose version reports and are off by default. Solve's startup banner uses a separate package/Git-version reader and does not launch these probes.

[Node's child-process documentation](https://nodejs.org/download/release/latest-jod/docs/api/child_process.html#subprocesskillsignal) explicitly documents surviving grandchildren when killing a shell on Linux; [detached process groups](https://nodejs.org/download/release/latest-jod/docs/api/child_process.html#optionsdetached) provide the group boundary used here. The process-group regression runs on Linux. Windows retains direct-child termination; Windows job-object cleanup and children that deliberately escape their process group are not established by this test.

**Exit-137 evidence limit:** 137 indicates SIGKILL; the wrapper also records a cgroup OOM event and a roughly 3 GB container limit. The reproduced leak is a concrete source of accumulating pressure. The old run has no OOM-victim PID, kernel event timestamp or before-kill cgroup peak sample, so it cannot prove that Claude itself was the OOM victim rather than another child, or exclude another SIGKILL source. Healthy host memory and the solve process's 92 MB heap after cleanup do not describe memory pressure inside that limited container before the kill. Current main already includes cgroup resource snapshots and event/cause separation from [PR #2499](https://github.com/link-assistant/hive-mind/pull/2499); those fixes are preserved. No host-exhausting OOM experiment was run.

### 2. Gist permissions do not become available through retries

The Actions installation token can write to its repository, but Gist creation and `GET /user` fail with `Resource not accessible by integration`. The logs show the same failures three times, separated by 30 and 120 seconds. gh-upload-log's repository fallback asks `/user` for an owner and therefore also fails with this token.

[GitHub's Gist API](https://docs.github.com/en/rest/gists/gists#create-a-gist) lists user access tokens, not installation tokens, for Gist creation. This is expected platform permission behavior. Retrying and splitting cannot change it; generic HTTP 403 rate-limit failures remain retryable.

The uploader stops on explicit permanent permission/authentication failures and missing executables. If Gist/repository uploads fail and the existing PR checkout is available, it publishes the **complete sanitized** log with the existing development-log collector. It verifies the PR head, local branch and origin head repository before writing, refuses base/main/master branches and unrelated checkouts, commits only the log artifacts, pushes only the verified branch, and returns a commit-specific blob URL after a successful push. It never reports partial uploads as complete. Transport failures retain the existing retry/line-aligned multipart behavior.

A real local-Git test confirms that unrelated staged changes remain staged and do not enter the log commit. A separate test verifies that secrets are removed before the fallback receives bytes. PR-less failures still rely on inline comments or the workflow artifact; a repository with no usable PR branch cannot publish a branch attachment. Push failures remain explicit failures.

The repository-fallback limitation is reported as [gh-upload-log #47](https://github.com/link-foundation/gh-upload-log/issues/47), with the real workflow reproduction, workaround and a proposed explicit repository/branch target that avoids `/user`.

### 3. Formal AI logs never reach the mounted artifact directory

The workflow bind-mounts `/home/box/logs` and passes `--log-dir`, but solve initialized its log with `null` before parsing and never applied the parsed log directory. The logs were written elsewhere inside a disposable container. The final artifact step correctly says no files were found; this was a location bug, not an artifact-service failure.

The fix resolves only the startup log-directory option before initialization, while retaining strict yargs validation for the complete CLI. It supports `--log-dir DIR`, `--log-dir=DIR`, `-l DIR`, `-l=DIR`, repeated options and the `--` separator. It does not mistake a following option for a directory. The CLI regression uses an invalid argument to prove that both startup and parsing diagnostics survive in the requested directory; its PATH fixture avoids launching installed AI tools.

Formal drafts also pass `--development-log`, so failed attempts preserve repository/session artifacts through the existing finalizer. The runtime branch attachment fallback works for other tools without requiring that flag. The workflow still uploads its mounted session log when no PR can be opened.

### 4. Label creation and checks dispatch are incomplete

`gh pr edit --add-label formal-ai-draft` fails because the repository label does not exist. The draft finalizer now creates that label only on the matching missing-label error and retries the assignment; simultaneous creation is handled without overwriting an existing label. Other permission errors propagate. The script uses the shared rate-limit-aware GitHub runner.

The checks action dispatches `release.yml` with `mode=checks`, but `bump_type` is required and had no default. A patch default makes a checks-only dispatch valid without changing the existing release-mode gate. The tests verify both command behavior and the required input default. Docker invocation, token forwarding, draft retention and forbidden auto-merge/auto-close flags remain covered by the existing formal-draft tests.

### 5. Formal AI mistakes an abbreviation for a file

The model runs and accepts tools; successful startup does not establish useful issue-solving capability. The upstream file-read recipe tokenizes `(e.g.,`, strips punctuation to `e.g`, accepts the dot as a filename extension, and uses a read cue elsewhere in the prompt to request that nonexistent file. The saved [upstream source](evidence/upstream-file-read.rs) and [upstream report #1189](https://github.com/link-assistant/formal-ai/issues/1189) explain the path-shape root cause. Related PR #2626 overlaps the label/log-dir/upload/dispatch investigation; it has not been assumed merged into this branch.

The independent replay uses installed formal-ai 0.352.1, temperature zero, three local API requests, a 2 GiB address-space limit, 16 MiB stack limit, 30-second CPU/watchdog limits and five-second request deadlines. `Read README.md (e.g., the project documentation).` produces two reads: `README.md` **and `e.g`**. Replacing `e.g.` with “for example” produces only the intended read. Returning a real tool error for `e.g` results in that error being formatted as file contents in this minimal recipe. The actual Agent sessions instead emit a terminal error and perform no useful work. The full responses and server trace are [saved here](evidence/formal-ai-replay.json).

Replacing abbreviations is a limited prompt workaround. It cannot reliably cover arbitrary issue text, paths or upstream planning failures, so this PR does not rewrite every user's issue or claim that Formal AI can solve arbitrary issues. The upstream suggested fix is to distinguish dotted abbreviations from file paths in the shared path predicate and add Rust tests for `e.g`, `i.e`, `a.k.a` and real filenames. This requirement remains dependent on the upstream implementation; the failure and evidence are reported rather than hidden by an empty `e.g` file or a false success classification.

The independent replay and tool-error observation are reported in [this upstream comment](https://github.com/link-assistant/formal-ai/issues/1189#issuecomment-6041117942); the original report and follow-up are preserved in the evidence directory.

## Requirements and validation

| Requirement                                              | Result                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thoroughly analyze both linked incidents and comments    | Full comments, two Gists, two complete job logs, recovery commit and upstream source preserved; unavailable artifacts identified                                                |
| Find and fix exit-137 root causes                        | Process-leak mechanism reproduced and fixed; exact historical OOM victim cannot be reconstructed                                                                                |
| Preserve logs when the Actions token cannot create Gists | Complete sanitized PR-branch fallback plus formal-draft development logs and working mounted log destination                                                                    |
| Fix observed warnings/errors and avoid false claims      | Missing-label and dispatch-input errors fixed; “no artifacts” warning addressed; successful startup and sticky OOM flags are not equated with successful work or an exact cause |
| Improve diagnostics when evidence is insufficient        | Default-off version-probe traces; existing cgroup/phase snapshots retained; full bounded replay and acquisition records                                                         |
| Report reproducible external bugs                        | Existing Formal AI report reused with independent evidence; gh-upload-log installation-token fallback limitation tracked upstream                                               |
| Use reusable library fixes throughout the project        | Shared version runner and upload attachment path; no Claude-only workaround                                                                                                     |
| Prevent regressions and prepare release                  | Default-suite regressions, existing suites, patch changeset; latest-head CI and final verification recorded with the PR                                                         |

Reproduction and regression commands:

```sh
node tests/issue-2613-regressions.test.mjs
node tests/test-version-info.mjs
node tests/version-info.test.mjs
node tests/formal-ai-draft-2233.test.mjs
node experiments/issue-2613/replay-formal-ai.mjs
python3 experiments/issue-2613/analyze-evidence.py
```

The initial regressions failed for surviving descendants, repeated permanent-permission attempts, missing branch publication and missing log-directory artifacts. `log-dir-before.log` records the corrected CLI reproduction; the earliest `regressions-before.log` used a help-path fixture with an incomplete PATH and is not evidence for the CLI parsing bug. Validation captures distinguish that fixture problem from the actual implementation failure. No full-memory stress test, paid model invocation or live production bot deployment is needed for these regressions.

Local validation on Node.js 26.10.0 passed all **563 default test files**, all **nine focused regressions**, both version-info suites, the existing formal-draft suite, the live CI template inventory, ESLint, repository formatting, secret scanning, duplication checks (11.20%, below the existing 12% limit), syntax checks, file line limits and changeset validation. The focused regressions were rerun after the final code changes; their branch test also rejects mismatched origins and unsuccessful pushes. [Sanitized validation captures](evidence/validation/) preserve the complete output and hashes. The CI feedback integration test creates live repository fixtures and runs in the dedicated CI step rather than being added to the default local suite.

The final CI state is recorded with the PR, separately from the initial approval-gated runs. The release changeset prepares a patch release; package versions are managed by the existing release workflow.
