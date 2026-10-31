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
when complete. Partial intent,
pre-intent orphan staging, power loss, persisted rollback authority, remaining
writers/task memory and full production lifecycle remain unfinished.

Final reconstructed-package actual CLI checks pass healthy plan 3/5, private 2/2,
four damaged plans 2/3 each, both concurrent-child engines 3/8, child restore 5/7,
ACP and third-terminal restore 3/5. All 11 network logs have no errors. Surrounding
history 69, metadata 54 and shell 28 pass. Python AST (88 files), Prettier,
actionlint/ShellCheck, secret scanning, file limits and whitespace checks pass.

Exact pushed-head CI investigation at ec03c083d0e01b4f5982669cc16ca708a555e61c:

1. Run 41168944327 starts 04:31:56Z and completes 04:45:08Z. Five Gemini jobs
   pass. ACP fails at its final surrounding authentication regression step.
2. Download all 3,874 log lines and read three chunks of at most 1,500 lines.
   The only error annotation is line 3304. Download all 722 ACP artifacts.
   The underlying error is gemini-acp-auth-writers.log:5, rejecting an unlisted
   exact manager hash before any native writer control runs.
3. Independently reproduce the same pin refusal for writers, requests and reads
   locally. The plan stage's manager hash is absent from all three allowlists.
   Add only the verified 80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733
   stage; retain all source/version checks and previous controls.
4. The preceding plan, source-reconstruction and lifecycle checks pass. All 78
   network logs have no errors. Keep this failure distinct from intentional
   strict-before assertion files and from the independent partial-proof defect.
   See evidence/ci-ec03c083-gemini.txt for exact commands and line references.
5. Re-run all three native authentication probes sequentially against the same
   package: writers 41, requests 30 and private-config reads 11 assertions pass.
   Preserve their complete local logs; fresh pushed-head CI remains required.
All local background commands finish and all native process groups are reaped.

Whole-CLI interruption extension:

1. Before repair, kill the complete actual CLI after durable journal publication
   for both first writes and replacements. Delete its whole private home; fresh
   actual resume fails with the precise expected assertion and unsafe-history
   diagnostic. Preserve both strict negative-control logs.
2. Run all six first/replacement x intent/journal/document boundaries against
   stage 26. An explicitly armed Linux-only fsync interposer invokes real fsync,
   records the selected boundary and sends SIGKILL. Native tools/provider/SDK
   remain real. Bound compilation and CLI processes and reap every group.
3. Correct a fixture assumption: first-write death after intent legitimately has
   no journal yet. Require absent or preceding generation before recovery and
   the exact complete new generation afterwards; never fabricate journal data.
4. All six controls pass twelve assertions. Fresh-home actual resume/read_file
   delivers all UTF-8 plan lines, keeps every full generation and preceding audit,
   leaves no private plan or completed metadata. First cases use three model
   requests, replacements six; healthy 3/5 and private 2/2 also pass. All eight
   network diagnostics have errors []. Logs use gemini-plan-cli-death-v2-*.
5. Add the same strict before and six after controls to the existing CI driver;
   independently reconstruct source and repeat complete CLI replacement recovery.
   Remaining partial-intent/power-loss/backend/production criteria stay open.

The exact expanded CI driver passes on a separate stage-25 package, applying
stage 26 itself: both strict whole-CLI before failures, preceding API/reserved
negative controls, 59 API assertions, 30 storage assertions and twelve whole-CLI
assertions. Six after network logs have no errors. Logs use
`/tmp/issue-3785-recovery/gemini-plan-cli-ci-*`. Python AST (89), formatting,
actionlint/ShellCheck, secret scanning, file limits and whitespace checks pass.
