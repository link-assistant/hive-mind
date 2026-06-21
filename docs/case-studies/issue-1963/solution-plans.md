# Solution Plans — Issue #1963

For each requirement: the options considered, the option chosen for this PR, and
(where relevant) the larger follow-up. Implemented choices are marked **[shipped]**.

---

## P1 — container-level scroll fade

**Goal.** One continuous "more content below" fade across the whole collapsed
thinking stack, not a separate fade per step line.

| Option | Assessment |
|---|---|
| **A. Container `mask-image` gradient** **[shipped]** | Move the gradient onto `.thinking-preview-collapsed:has(.thinking-preview-previous)` as `linear-gradient(to bottom, transparent 0, #000 1.4em)`; remove the per-line mask. `:has()` scopes it so a lone first step (no previous) is never masked. Minimal, declarative, GPU-composited, no JS. |
| B. `::after` gradient overlay | A positioned overlay with a `background: linear-gradient(...)` over the container. Works, but needs a matching background color per theme (re-introduces the duplication problem) and sits above text (z-index fiddling). Rejected. |
| C. Scroll-driven `animation-timeline: scroll()` | Newer CSS; could fade based on actual scroll position. Overkill for a fixed two-line preview and weaker browser support than `mask-image`. Deferred. |

**Chosen: A.** The fade is presentation-only and belongs in CSS; moving it from the
line to the container is the literal expression of the requirement.

---

## P2 — render thinking detail in full

**Goal.** Stop clipping a normal step's detail mid-sentence while keeping an upper
bound so the preview cannot grow unbounded.

| Option | Assessment |
|---|---|
| **A. Raise the cap 120 → 600 in both surfaces** **[shipped]** | Smallest change that fixes the symptom; keeps a bound so a pathological multi-KB detail still truncates with an ellipsis. Rust `truncate_thinking_detail` + JS `thinkingDetailText` kept in sync with cross-referencing comments. |
| B. Remove the cap entirely | Risks an unbounded preview height from a runaway step; the panel relies on a predictable height for the P1 fade. Rejected. |
| C. Word-boundary truncation at the cap | Nicer truncation, but the real complaint is *legitimate detail being cut*, not *ugly cut points*. 600 chars already clears realistic single-step content; word-boundary polish is a possible later refinement. Deferred. |

**Chosen: A.** Single source of truth would be ideal (see M-series below), but Rust
core and the browser worker are genuinely separate runtimes; the comment-linked
constant pair is the pragmatic in-repo answer.

---

## P3 — stable pending message width

**Goal.** No width jump when a message transitions from thinking-only to having a
body.

| Option | Assessment |
|---|---|
| **A. Remove the `width: 116px` clamp** **[shipped]** | The clamp was a leftover typing-indicator dimension; deleting it (and the dead `.typing::after`) lets the pending body use the same width as a settled body, so there is nothing to jump. |
| B. Animate the width transition | Masks the jump instead of removing it, and animating `width` is layout-thrashing. Rejected — the correct width is "the same width", not "a smoothly-growing width". |

**Chosen: A.**

---

## P4 — services/update dark theming

**Goal (immediate).** Every services/update surface is readable in dark mode.
**Goal (systemic).** New surfaces stop silently missing dark rules.

| Option | Assessment |
|---|---|
| **A. Hand-write the missing dark rules in both dark layers** **[shipped]** | Directly fixes the symptom now, in both `:root[data-theme="dark"]` and the `prefers-color-scheme` media query (per "fix in all places"). Matches the file's existing convention so the diff is reviewable. |
| **B. Introduce CSS custom properties (design tokens)** *(recommended follow-up)* | Define `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--accent` … once per theme; rewrite component rules to consume them. Removes the manual hex duplication that is the **root cause** of P4 (and a future-proofing for P5). Larger diff touching the whole stylesheet — best as its own PR so it can be reviewed as a refactor with no behavior change. |
| C. Chakra color-mode tokens | Subsumes B; see the migration plan below. |

**Chosen for this PR: A.** **Recommended next: B**, then C. The shipped fix is
written to be a drop-in for tokens later (consistent property names, both layers).

---

## P5 — uniform topbar hover/focus

**Goal.** Every header control gives the same hover and keyboard-focus feedback.

| Option | Assessment |
|---|---|
| **A. One shared selector list for all topbar controls** **[shipped]** | Group every control (`report/source-code/download/memory` buttons, `sidebar-toggle`, `mobile-menu-toggle`, `mode/diagnostics` toggles) under one `:hover`, one active-state `:hover`, and one `:focus-visible` ring, in light + dark. Removes the per-button drift that caused "partial". |
| B. A reusable `IconButton` React component | The right long-term home for the shared treatment (M2); but the app ships raw `createElement`, so this rides with the Chakra migration. Documented, deferred. |

**Chosen: A** now; **B** with the migration.

---

## M2 / M3 — component reuse & Chakra UI + JSX migration

This is the strategic requirement. It is **documented here and deliberately not
executed in the polish PR.**

### Why not in this PR
* The web app currently ships **raw `React.createElement`** (`h = React.createElement`)
  with **no JSX build step**, and CI runs `git diff --exit-code` on the committed
  `vendor.bundle.js` / `ocr.bundle.js`. A Chakra+JSX transition means adding a JSX
  toolchain, a Chakra/Emotion bundle, and regenerating committed bundles — a large,
  risky change that should not be entangled with five cosmetic fixes.
* The five defects are real and worth shipping now; gating them behind a migration
  would delay them indefinitely.

### Staged migration plan (proposed, multi-PR)
1. **Tokens first.** Land P4-option-B (CSS custom properties). This alone removes
   the duplication root cause and gives a token vocabulary that maps 1:1 onto
   Chakra's semantic tokens later. *Low risk, no visual change.*
2. **Toolchain.** Introduce a JSX build (esbuild/Vite) producing the same
   `app.js`/bundles the repo already serves; wire it into `bun run build:web` and
   the bundle-diff CI gate. *Infra-only PR.*
3. **Chakra provider + theme.** Add `@chakra-ui/react` with a theme whose semantic
   tokens are the step-1 tokens; mount a `ChakraProvider`/color-mode at the root.
4. **Port leaf components** in slices — start with the topbar `IconButton` (folds in
   P5), then the services/update cards (folds in P4), then the thinking preview
   (folds in P1/P3). Each slice is one reviewable PR with before/after parity shots.
5. **Retire bespoke CSS** as each view is ported; delete the manually-duplicated
   blocks once their components consume Chakra tokens.

### Library evaluation

| Library / feature | Relevance | Verdict |
|---|---|---|
| **Chakra UI v3** (`@chakra-ui/react`) | Issue's stated target. Semantic tokens + first-class `color-mode` eliminate the manual light/dark hex duplication (P4) and give a shared `Button`/`IconButton` (P5). | **Strategic target** — adopt via the staged plan. |
| **CSS custom properties** (native) | Zero-dependency fix for the P4/P5 duplication root cause; usable today; the bridge to Chakra tokens. | **Recommended immediate follow-up.** |
| **`mask-image` + `linear-gradient`** (native CSS) | The P1 scroll-fade mechanism. | **Shipped.** |
| **`:has()` selector** (native CSS, baseline) | Scopes the P1 fade to "container that has a previous step", so a lone step isn't masked. | **Shipped.** |
| **`:focus-visible`** (native CSS) | Keyboard-only focus ring for P5 without showing rings on mouse click. | **Shipped.** |
| **Playwright** (already a dependency) | Behavioral regression for all five defects (computed colors, widths, hover/focus). | **Shipped** (`issue-1963.spec.js`). |
| Emotion / styled-components | Would come transitively with Chakra; not adopted independently. | Defer to Chakra. |
| Tailwind | Utility CSS could also centralize tokens, but the issue explicitly names Chakra; introducing a second system would fragment the styling story. | Rejected. |

---

## Summary

* **Shipped now (formal-ai#551):** P1, P2, P3, P4, P5 — each minimal, in-place, and
  token-ready, with regression tests.
* **Recommended next (separate PRs):** design tokens (removes the P4/P5 root cause),
  then the staged Chakra + JSX migration (M2/M3), which absorbs the shipped fixes
  into shared components.
