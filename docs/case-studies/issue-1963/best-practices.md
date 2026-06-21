# Best Practices & Lessons Learned — Issue #1963

What this case study teaches, framed so the *class* of defect cannot recur — not
just the five instances.

## 1. The systemic root cause: no design tokens

Four of the five defects (P1, P3, P4, P5) live in `src/web/styles.css`, and the
single fact that connects P4 and P5 is that **the stylesheet has zero CSS custom
properties.** Light and dark are *manually duplicated hex* across three layers (light
base, `:root[data-theme="dark"]`, `@media (prefers-color-scheme: dark)`), and every
interactive treatment is written per element.

Consequences observed:
* **P4** — a new surface (the services/update panel) was added with light rules
  only; nobody hand-duplicated the dark rules, so it rendered light-on-dark.
* **P5** — new topbar buttons were added without copying the older buttons' hover
  rules, so feedback was partial.

> **Recommendation.** Introduce design tokens (CSS custom properties) defined once
> per theme: `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`,
> `--accent`, `--accent-weak`. A new element then *inherits* correct theming and
> only has to consume tokens, not re-derive colors. This is the prerequisite step of
> the Chakra migration (`solution-plans.md`) and removes the P4/P5 root cause on its
> own.

## 2. "Fix it in all places" requires knowing where the places are

The issue's M1/M7 ("if the issue is one place it should be fixed in all places")
only works if you can enumerate the duplication. Here that meant:
* P2 lives in **two runtimes** — Rust core and the JS worker. Both were changed and
  cross-referenced with a `keep both constants in sync` comment.
* P4/P5 live in **two dark layers** — the explicit `data-theme` override and the
  `prefers-color-scheme` fallback. Both were changed.

> **Recommendation.** When a value is intentionally duplicated across runtimes or
> theme layers, leave a comment at each site pointing at the others, so the next
> editor changes all of them. Better: collapse the duplication (single token / single
> shared constant) so there is only one place.

## 3. Reuse selectors before reaching for new components

P5's fix grouped every topbar control under one selector list instead of adding yet
another per-button rule. This is the CSS-level expression of the issue's "reuse our
own components" (M2): one rule, uniform behavior, no drift. The component-level
version (`<IconButton>`) is the next step, but consolidating the selector captures
most of the benefit immediately and with no build changes.

## 4. Test at the layer where the defect lives

* P2 is logic (a character cap) → **Rust unit tests** (`tests/unit/issue_1963.rs`)
  that are fast and deterministic.
* P1/P3/P4/P5 are *computed style and interaction* → **Playwright** tests
  (`issue-1963.spec.js`) that read `getComputedStyle`, real hover/focus states, and
  dark-mode colors. A unit test could not have caught "the mask is on the wrong
  element" or "this button doesn't change on hover"; only a rendered DOM can.

> **Recommendation.** Match the test medium to the defect medium. Pixel/computed-style
> regressions need a browser; pure logic does not. The Playwright spec here was
> validated to fail (9/10) when the CSS fix is stashed — a test that cannot fail
> proves nothing.

## 5. Gotcha: the `semantic_grounding` scanner and "P<number>" tokens

A real trap hit during this work, worth recording so it doesn't recur:

* formal-ai's `tests/unit/semantic_grounding.rs` scans `src/` and `data/seed` for
  Wikidata-style IDs via the regex `\b[QLP][0-9]+\b`. Any `Q`/`L`/`P` followed by
  digits is treated as a Wikidata entity/lexeme/property that **must** have a
  checked-in cache file (`<ID>.lino` + `<ID>.json`).
* Writing the problem label **"P2"** in a comment in `src/thinking.rs` made the
  scanner think property **P2** was referenced → it demanded `P2.json`/`P2.lino`,
  which don't exist → two grounding tests failed.

> **Recommendation.** In scanned source (`src/**`, `data/seed/**`), refer to the
> issue's problems as **"problem 2"**, never **"P2"**. `.js`/`.css`/`tests/**` are not
> scanned, so the bare `P<n>` label is safe there — but the safest habit is to avoid
> the `letter+digits` shape in any first-party source comment. (Verified: rewording
> restored `semantic_grounding` to 5/5 and the full unit suite to 1021/0.)

## 6. Respect the canonical branch / placeholder convention

formal-ai auto-creates a `[WIP]` solution-draft PR per issue, on a branch whose
first commit is a `.gitkeep` placeholder. The repo's convention (seen in the merged
PR for the predecessor issue) is: *placeholder commit → real work → "Revert
'Initial commit with task details'" → merge*.

> **Recommendation.** Adopt the existing draft PR and its branch instead of opening a
> second PR (one PR per issue); add the real work, then revert the placeholder so the
> `.gitkeep` ends up byte-identical to `main`. Don't leave orphan branches.

## 7. Don't perturb generated artifacts

CI runs `git diff --exit-code` on the committed `vendor.bundle.js` / `ocr.bundle.js`.
The fixes deliberately touched only hand-written `app.js`/`styles.css`/Rust and left
the bundle *entry* files alone, so a rebuild produced no bundle diff.

> **Recommendation.** Before committing web changes, rebuild and confirm the
> generated bundles are unchanged (or regenerate and commit them intentionally) —
> never let an incidental bundle diff ride along with a logic fix.

## 8. Make the repro production-faithful

`experiments/issue-1963-harness.html` links the **shipped** `styles.css` (not a
hand-copied snippet), so the before/after renders in `assets/` reflect real
production CSS. A repro that forks the styles can "prove" a fix that production
doesn't actually have.

> **Recommendation.** Repro harnesses should import the real stylesheet/component, so
> the harness and production cannot drift.
