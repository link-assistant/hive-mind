---
'@link-assistant/hive-mind': patch
---

Document JavaScript-first parity and the single push gate in `docs/CI-CD-BEST-PRACTICES.md` (all four languages), as principle 18: native JavaScript behavior parity instead of carried source or WASM wrappers, a strict inventory that rejects missing, partial or carried features, deterministic regeneration from pinned sources, a reusable gate that every Rust build/test/package/container/publish job `needs:` and whose `tested-sha` it checks out, the `workflow_run` pitfalls, and one coordinator that pushes once per validated batch. Active writers keep `cancel-in-progress: false`. The case study `docs/case-studies/issue-3043/README.md` integrates draft PR #3044, including its proposed (not implemented) single-owner solve scheduler, checked against the current code. A new test pins the guidance (issue #3043, link-assistant/router#759).

Refresh the pins the dependency-freshness gate flagged on this pull request (same change as #3000): Box 2.10.3 -> 2.10.4 in the Docker images, lino-objects-codec ^0.9.1 -> ^0.9.2, and the use-m pin command-stream 2.1.0 -> 2.3.0.
