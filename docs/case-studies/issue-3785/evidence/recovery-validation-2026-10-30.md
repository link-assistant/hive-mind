# Recovery validation on 2026-10-30

At remote head `69b1e8a464adcfef8c00223652924870de178ce0`,
[Checks/release](https://github.com/link-assistant/hive-mind/actions/runs/41064059887),
Security, Workflows, links,
[Claude](https://github.com/link-assistant/hive-mind/actions/runs/41064060494)
and [Qwen](https://github.com/link-assistant/hive-mind/actions/runs/41064059810)
pass. Checks includes branch-package images and both daemon-backing probes.
The Claude pass includes the **expected reproduction** of consumed-predecessor
reuse after owner death; this native defect remains unfixed.

[Native Codex](https://github.com/link-assistant/hive-mind/actions/runs/41064060039)
has a passing focused-transaction job and a passing full native CLI job. The
actual compiled repair passes all nine identity scenarios, selected TUI refusal,
non-selected TUI compatibility, twelve upstream prompt-history tests, fourteen
canonical prompt-history controls, both two-client model-request auth modes,
provider overrides/constructors, owner-death refusal, malformed explicit-login
repair and named-history disposal/resume. Selected structural output is retained
in `native-codex-integration-41064060039.log`.

The same run's **separate stock-history job fails** because its cached-generation
negative control incorrectly expects ChatGPT replacement to reload automatically.
The exact stock 0.164.0 executable retains G0 in both auth modes. Commit
`5f1019136` corrects only that negative assertion; stock G0 controls and the
strong repaired G1/refuse/G2 controls both pass locally. This run is therefore
reported as failed overall. Fresh CI is required for the correction and later
production admission changes.

The complete 729-file local default suite passes. After subsequent Claude
history changes, all nineteen existing files directly using the affected
mount builders pass again and all nine new history tests pass. After the
stock-verifier cleanup change, all six new reproductions and forty-eight
existing runtime/catalog/stock/effective-root tests pass together. These
bounded tests use synthetic state and preserve protected auth bytes/inodes.

The packaged-runtime verifier had the same class of exited-leader cleanup bug
as the earlier experiment: a catalog helper survived on leader exit, malformed
IPC and catalog refusal. Version probes also leave helpers after success, nonzero
exit and oversized output. All six regressions fail before repair. Each native
probe now owns a separate process group, signals that group regardless of
leader state and waits for the leader and non-zombie Linux group members.
Cleanup is bounded; failure refuses verification and retains the private
fixture instead of deleting storage a helper may still use. This does not
certify descendants that deliberately create an independent session.

These results cover the listed paths. Production still copies scoped Codex
authentication, and the complete six-tool canonical auth/history, alternative
backend audit, global baseline, migration and release/deployment lifecycle
requirements remain unfinished. The PR must remain draft and unmerged.
