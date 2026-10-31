# 2026-10-31: native plan publication investigation

The native goal and full acceptance inventory remain active. These changes apply
only to the disposable pinned Gemini experiment. The PR stays draft/unmerged.

1. Reproduce first and replacement journal/file disagreement on stage 25 before
   implementing recovery. Both bounded actual native API owners reach durable
   journal publication and are killed. Delete the whole private home; fresh
   native readers refuse with the canonical unsafe-history diagnostic.
2. Add a checked durable full-generation intent, exact staging identity, native
   namespace/journal coordination and startup/read/write recovery. Reserve
   `.plan-` names and narrowly allow only the session-root transaction intent.
3. Reproduce a draft accepting identical bytes in another staging inode. Pin the
   writer's opened descriptor and verify its final named version before intent
   publication. The strict before control fails; final refusal preserves bytes,
   both inodes and the unchanged preceding full journal.
4. Reproduce another draft accepting a JSON array-valued staging name through
   regex coercion. Validate exact JSON field types. The added unsafe-schema case
   now refuses without changing any canonical or protected file fingerprint.
5. Run the exact CI driver locally: strict first/replacement and reserved-name
   failures, six successful recovery cases, live staging refusal, 23 unsafe
   controls, and full native plan storage. All 59 publication assertions and
   30 storage assertions pass. Logs are retained under
   `/tmp/issue-3785-recovery/gemini-plan-transaction-ci-*`.
6. Reconstruct all 26 stages from pinned constructor source. Applicability checks
   do not mutate files; all 17 tested native files match byte for byte. Final
   history helper is d522f9e84bffe3d7c9323596f3aa8914bd2ce74e73ff2be3233e6aff6b8729da.
7. Preserve all eight successful workflows at 8f9ca8867a before another push.
   Full Checks log: 73,259 lines, 49 chunks; full Codex log: 1,790 lines, two
   chunks. Neither has error annotations. Default 739 and integration two test
   files pass; Docker installed-task and nested restart checks pass. Download
   the compiled executable and all 94 native-auth build artifact files; review
   those in 95 chunks. Four assertion failures are strict before controls.
   See `docs/case-studies/issue-3785/evidence/ci-8f9ca8867.txt` for run IDs,
   exact timestamps, SHA, artifact digests and specific log line numbers.

Final surrounding tests, static checks and exact-head CI are recorded below
when complete. Whole actual CLI interrupted-plan recovery, partial intent,
pre-intent orphan staging, power loss, persisted rollback authority, remaining
writers/task memory and full production lifecycle remain unfinished.

Final reconstructed-package actual CLI checks pass healthy plan 3/5, private 2/2,
four damaged plans 2/3 each, both concurrent-child engines 3/8, child restore 5/7,
ACP and third-terminal restore 3/5. All 11 network logs have no errors. Surrounding
history 69, metadata 54 and shell 28 pass. Python AST (88 files), Prettier,
actionlint/ShellCheck, secret scanning, file limits and whitespace checks pass.
All local background commands finish and all native process groups are reaped.
