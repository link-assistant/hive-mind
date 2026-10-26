# Issue 3785 CI investigation

The initial `43ea0960` release run required approval and had no jobs or downloadable
logs. The other initial dispatched checks passed; this was not evidence of a
code assertion failure. Initial run metadata and the unavailable-log response are
retained alongside this note.

The first implementation head was `56a57e046fb249b85ce47e5bf7df40af428378da`.
[Broken Link Checker run 40271384218](https://github.com/link-assistant/hive-mind/actions/runs/40271384218)
started at 2026-10-26 04:53:43 UTC, after that head was pushed. Its downloaded
`links-40271384218.log` has 636 lines. Line 351 reports HTTP 404 for the pinned
Codex refresh-manager citation; lines 369–371 identify
`experiments/issue-3785/upstream-report.md:29`. The same bad link was present in
the case study. This is an introduced documentation error.

Both citations were corrected from `login/src/auth.rs` to
`login/src/auth/manager.rs`. The pinned GitHub API source has SHA-256
`e650a5d08b98a919bbdfe0035d527b0b8480554b2de406961ed6355f47cf1c60`, matching
the source used for the investigation. The corrected browser URL returns HTTP
200. The already-posted upstream report was edited to fix its citation as well.
Raw CI logs stay local because link-checker redirect output can contain expiring
signed asset URLs. This note preserves the error, location, head and resolution.
