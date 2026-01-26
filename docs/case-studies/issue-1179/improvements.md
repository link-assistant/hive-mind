# Proposed Improvements for System Prompts

This document outlines the specific changes to be made to the system prompts to emphasize reproducible automated testing.

## New Section: Reproducible Testing

The following new section should be added to all prompt files (`claude.prompts.lib.mjs`, `agent.prompts.lib.mjs`, `codex.prompts.lib.mjs`, `opencode.prompts.lib.mjs`) in the "Solution development and testing" area:

### Proposed Text

```
Reproducible testing (CRITICAL).
   - When fixing a bug, ALWAYS create a test that reproduces the problem BEFORE implementing the fix. This is fundamental: if you cannot reproduce the problem, you cannot verify the fix.
   - When encountering logic bugs, write an automated test that fails due to the bug, then implement the fix to make it pass.
   - When encountering UI bugs, capture a screenshot showing the problem state, then create a visual regression test or manual verification screenshot after the fix.
   - When creating tests, prefer minimum reproducible examples - the simplest test case that demonstrates the issue.
   - When submitting a fix, include in the PR description: (1) how to reproduce the issue, (2) the automated test that verifies the fix, (3) before/after screenshots for UI issues.
   - When a bug fix doesn't have a reproducing test, the fix is incomplete - regressions can silently occur later.
```

## Enhanced UI Testing Guidelines

For prompts that support Playwright MCP (`claude.prompts.lib.mjs` with `promptPlaywrightMcp` flag), enhance the section:

### Current Text

```
Playwright MCP usage (browser automation via mcp__playwright__* tools).
   - When you develop frontend web applications (HTML, CSS, JavaScript, React, Vue, Angular, etc.), use Playwright MCP tools to test the UI in a real browser.
   - When WebFetch tool fails to retrieve expected content (e.g., returns empty content, JavaScript-rendered pages, or login-protected pages), use Playwright MCP tools (browser_navigate, browser_snapshot) as a fallback for web browsing.
   - When you need to interact with dynamic web pages that require JavaScript execution, use Playwright MCP tools.
   - When you need to visually verify how a web page looks or take screenshots, use browser_take_screenshot from Playwright MCP.
   - When you need to fill forms, click buttons, or perform user interactions on web pages, use Playwright MCP tools (browser_click, browser_type, browser_fill_form).
   - When you need to test responsive design or different viewport sizes, use browser_resize from Playwright MCP.
   - When you finish using the browser, always close it with browser_close to free resources.
```

### Enhanced Text

Add the following after the existing Playwright MCP guidelines:

```
   - When reproducing UI bugs, use browser_take_screenshot to capture the problem state BEFORE implementing any fix.
   - When fixing UI bugs, take before/after screenshots to provide visual evidence of the fix.
   - When creating UI tests, save baseline screenshots to the repository for visual regression testing.
   - When verifying UI fixes, compare screenshots to ensure the fix doesn't introduce unintended visual changes.
```

## Enhanced Visual UI Work Section

For prompts with `modelSupportsVision`, update the visual work section:

### Current Text

```
Visual UI work and screenshots.
   - When you work on visual UI changes (frontend, CSS, HTML, design), include a render or screenshot of the final result in the pull request description.
   - When you need to show visual results, take a screenshot and save it to the repository (e.g., in a docs/screenshots/ or assets/ folder).
   - When you save screenshots to the repository, use permanent raw file links in the pull request description markdown.
   - When uploading images, commit them to the branch first, then reference them using the raw GitHub URL format.
   - When the visual result is important for review, mention it explicitly in the pull request description with the embedded image.
```

### Enhanced Text

Add the following:

```
   - When fixing UI bugs, capture BOTH the "before" (problem) and "after" (fixed) screenshots as evidence.
   - When reporting UI bugs, a screenshot of the problem state is essential for human verification.
   - When the fix is visual, the PR description should include side-by-side comparison of before/after states.
   - When possible, create automated visual regression tests to prevent the UI bug from recurring.
```

## Implementation Files

The following files need to be updated:

1. **`src/claude.prompts.lib.mjs`** - Main Claude prompts (includes Playwright MCP and vision support)
2. **`src/agent.prompts.lib.mjs`** - Agent prompts (includes vision support)
3. **`src/codex.prompts.lib.mjs`** - Codex prompts
4. **`src/opencode.prompts.lib.mjs`** - OpenCode prompts

## Placement

The new "Reproducible testing" section should be placed at the **beginning** of the "Solution development and testing" section to emphasize its importance. The guideline that currently reads:

```
   - When issue is solvable, implement code with tests.
```

Should be modified to:

```
   - When issue is solvable, FIRST create a test that reproduces the problem, THEN implement the fix.
```

## Rationale

1. **Test-First Approach**: Industry research shows TDD principles are especially effective with AI agents, providing safety nets against hallucinations.

2. **Visual Evidence**: UI bugs require visual proof - words alone can be ambiguous about what "looks wrong."

3. **Regression Prevention**: Without reproducing tests, fixed bugs can silently return in future changes.

4. **Documentation**: Tests serve as living documentation of what was broken and how it was fixed.

5. **CI/CD Integration**: Automated tests integrate with CI pipelines for continuous verification.

## Examples

### Good Practice (Logic Bug)

```
Issue: calculateTotal() returns wrong value for empty cart

Step 1: Create failing test
test('calculateTotal returns 0 for empty cart', () => {
  const cart = [];
  expect(calculateTotal(cart)).toBe(0);
});

Step 2: Run test - confirms it fails (returns undefined instead of 0)

Step 3: Fix the bug
function calculateTotal(cart) {
  if (!cart || cart.length === 0) return 0;  // Added check
  return cart.reduce((sum, item) => sum + item.price, 0);
}

Step 4: Run test - now passes
```

### Good Practice (UI Bug)

```
Issue: Submit button is not visible on mobile

Step 1: Capture screenshot of the problem
[browser_take_screenshot showing button hidden at mobile viewport]

Step 2: Save to repository as evidence
docs/screenshots/issue-123-before.png

Step 3: Fix the CSS
.submit-button { display: block; } /* Changed from inline */

Step 4: Capture screenshot of the fix
[browser_take_screenshot showing button now visible]

Step 5: Save and include both in PR
docs/screenshots/issue-123-after.png
PR includes before/after comparison
```

### Poor Practice (Avoid)

```
Issue: Something is broken

"I looked at the code and fixed it. It should work now."

Problems:
- No reproduction of the issue
- No test to verify the fix
- No evidence the fix works
- Risk of regression in future
```

---

**Document Version:** 1.0
**Last Updated:** 2026-01-26
