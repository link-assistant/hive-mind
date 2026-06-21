# Requirements — Issue #1963

Every requirement extracted from [hive-mind#1963][issue] (mirrored as
[formal-ai#550][fa-issue]), traced to its fix and verification. Requirement IDs are
this case study's own labels.

## A. The five reported defects

| ID | Verbatim requirement | Fix | Verified by |
|---|---|---|---|
| **P1** | "Animation gradient does not span 2 paragraphs/steps of thinking … each paragraph/line/step has its own gradient. The gradient is to create a feeling that there is more content, so it should be applied to full scrolled container of all thinking steps." | Move the `mask-image` fade from the per-line `.thinking-preview-previous` to the container `.thinking-preview-collapsed:has(.thinking-preview-previous)` as one `linear-gradient(to bottom, transparent 0, #000 1.4em)`; drop the per-line mask. | `issue-1963.spec.js` — "P1: collapsed thinking preview fades the whole container, not each line" |
| **P2** | "Thinking steps are not fully written, some parts are omitted." | Raise the detail cap 120 → 600 in `truncate_thinking_detail` (`src/thinking.rs`) and `thinkingDetailText` (`src/web/app.js`), kept in sync. | `tests/unit/issue_1963.rs` (4 tests, covering en/ru/hi/zh) + e2e detail check |
| **P3** | "When where is no yet message body and only thinking steps we the width of message broken … UI have sudden jump in width when message starts displaying." | Remove the `.pending .message-body { width: 116px }` clamp (and the dead `.typing::after`) so the pending body uses the natural settled width. | `issue-1963.spec.js` — "P3: pending message body keeps full width (no jump)" |
| **P4** | "We still have theming issues in all `services` box" | Add complete dark rules for every services/update surface in both `:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark)`. | `issue-1963.spec.js` — "P4: services/update surfaces are dark in dark theme" |
| **P5** | "Not all buttons on top menu are reacting to hover as other buttons, so it is partial." | One shared hover + active-hover + `:focus-visible` ring for every topbar control, light and dark. | `issue-1963.spec.js` — "P5: every topbar control reacts to hover + focus" |

## B. Meta-requirements (codebase-wide & strategic)

| ID | Verbatim requirement | Disposition |
|---|---|---|
| **M1** | "double check all the UI issues (even out of scope of that I described), if the issue is one place it should be fixed in all places. So all our UI are have uniform behavior" | **Honored.** P2 fixed in both Rust + JS; P4/P5 fixed in both dark layers. Audit findings (the systemic duplication root cause) recorded in `best-practices.md`. |
| **M2** | "we should reuse our own react.js components to easily support everything" | **Partially honored / documented.** The fixes consolidate previously-duplicated per-element CSS into shared selectors (one topbar-control rule, one container fade). Full component extraction is folded into the Chakra plan (`solution-plans.md`), as the app currently ships raw `React.createElement`. |
| **M3** | "must fully transition to https://chakra-ui.com and JSX, so we can ensure everything is nice and polished" | **Documented as a staged migration** in `solution-plans.md`. Not executed in this PR: it is a multi-PR effort (build-tooling for JSX + bundle regeneration + per-view port) disproportionate to a polish fix, and the five defects are fixed in a token-ready way that the migration can absorb. |
| **M4** | "download all logs and data related about the issue to this repository … compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also … search online for additional facts and data) … reconstruct timeline/sequence of events, list of each and all requirements … find root causes of the each problem, and propose possible solutions and solution plans for each requirement … check known existing components/libraries." | **Done** — this `docs/case-studies/issue-1963/` folder (README timeline + root causes, this file, `solution-plans.md`, `raw-data/`, `data/`, `assets/`). |
| **M5** | "If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration." | **N/A this iteration** — all five root causes were located directly in the stylesheet / naturalizer source (see README §3); no additional instrumentation was required. Noted for completeness. |
| **M6** | "If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code." | **Assessed — none needed.** Every defect is in formal-ai's own first-party code (its stylesheet and naturalizer), not a dependency. Reasoning in `proposed-issues.md`. The product-repo tracker is `formal-ai#550`; the fix is `formal-ai#551`. |
| **M7** | "double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them." | **Honored** — same as M1; see the "fix it in all places" section of the README. |
| **M8** | "plan and execute everything in this single pull request … until it is each and every requirement fully addressed, and everything is totally done." | **Honored** — one fix PR (`formal-ai#551`) carries all five fixes + tests + changelog; this case study lives in the hive-mind tracking PR (`hive-mind#1964`). |

## C. Traceability — requirement → files touched

| Requirement | Source files | Test files |
|---|---|---|
| P1 | `src/web/styles.css` | `tests/e2e/tests/issue-1963.spec.js` |
| P2 | `src/thinking.rs`, `src/web/app.js` (+ mirror `tests/source/thinking.rs`) | `tests/unit/issue_1963.rs`, `tests/unit/mod.rs` |
| P3 | `src/web/styles.css` | `tests/e2e/tests/issue-1963.spec.js` |
| P4 | `src/web/styles.css` | `tests/e2e/tests/issue-1963.spec.js` |
| P5 | `src/web/styles.css` | `tests/e2e/tests/issue-1963.spec.js` |
| M4 | `docs/case-studies/issue-1963/**` (this repo) | — |
| release | `changelog.d/20260621_133148_issue_550_ui_ux_polish.md` | CI changelog gate |

[issue]: https://github.com/link-assistant/hive-mind/issues/1963
[fa-issue]: https://github.com/link-assistant/formal-ai/issues/550
