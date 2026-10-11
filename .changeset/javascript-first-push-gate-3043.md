---
'@link-assistant/hive-mind': patch
---

Document JavaScript-first parity and the single push gate in `docs/CI-CD-BEST-PRACTICES.md` (all four languages), as principle 18: native JavaScript behavior parity instead of carried source or WASM wrappers, a strict inventory that rejects missing, partial or carried features, deterministic regeneration from pinned sources, a reusable gate that every Rust build/test/package/container/publish job `needs:` and whose `tested-sha` it checks out, the `workflow_run` pitfalls, and one coordinator that pushes once per validated batch. Active writers keep `cancel-in-progress: false`. A new test pins the guidance (issue #3043, link-assistant/router#759).
