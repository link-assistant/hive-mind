---
'@link-assistant/hive-mind': patch
---

docs: expand best practices with CI/CD guide, universal prompts, and architecture improvement (Issue #1403)

Splits the existing `docs/BEST-PRACTICES.md` into two focused documents:

- **`docs/CI-CD-BEST-PRACTICES.md`** (renamed from the original) — Updated and expanded CI/CD guide covering all key points from existing workflow templates, including: running checks only on relevant file changes, fast-fail job ordering, fresh merge simulation, concurrency control, changeset exemptions for docs-only PRs, secrets detection, documentation validation, and OIDC trusted publishing.

- **`docs/BEST-PRACTICES.md`** (new general guide) — Universal best practices for AI-driven development including: deep analysis bug/feature prompts, universal validation prompt, plan mode prompt, issue writing guidelines with acceptance criteria patterns, an architecture improvement prompt linking to the Code Architecture Principles repository, CI/CD summary with link to the CI/CD guide, and subagent coordination patterns.

Also updates `README.md` to link to both new documents in the Best Practices section.
