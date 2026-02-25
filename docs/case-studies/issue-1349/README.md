# Case Study: Issue #1349 — Broken Image Links in PR Descriptions for Private Repositories

## Overview

**Issue:** [`link-assistant/hive-mind#1349`](https://github.com/link-assistant/hive-mind/issues/1349)
**Fix PR:** [`link-assistant/hive-mind#1350`](https://github.com/link-assistant/hive-mind/pull/1350)
**Affected Feature:** "Visual UI work and screenshots" section of system prompts
**Symptom:** Screenshot images embedded in PR descriptions as `raw.githubusercontent.com` URLs return HTTP 404 for private repositories, resulting in broken images visible to all PR reviewers.
**Root Cause:** System prompt instructions told AI agents to use `raw.githubusercontent.com` format for screenshot links without accounting for private repository visibility — these URLs are inaccessible without authentication, and GitHub does not render them inline even with auth.

---

## Evidence: The Broken PR

**PR:** [`link-assistant/money-making-machines#2`](https://github.com/link-assistant/money-making-machines/pull/2)
**Repository visibility:** Private (`"private": true, "visibility": "private"`)
**PR created:** 2026-02-24T23:43:47Z
**Cost:** $3.432003 USD (Anthropic-reported)

The PR body contained these broken image links:

```markdown
### Screenshots

Homepage:
![Homepage](https://raw.githubusercontent.com/link-assistant/money-making-machines/issue-1-92283df2d887/docs/screenshots/website-index.png)

Bandwidth Sharing method page (after running automation):
![Method page with completed automation](https://raw.githubusercontent.com/link-assistant/money-making-machines/issue-1-92283df2d887/docs/screenshots/website-method-completed.png)
```

**Verification that files exist but URLs are broken:**

```bash
# Files exist in the branch (confirmed via Git tree API):
# docs/screenshots/website-index.png          - 401,171 bytes (SHA: a799d26756d7875de1b71476ce0d56ceae1e53ca)
# docs/screenshots/website-method-completed.png - 570,837 bytes (SHA: 4103df3fa61855149fcbb829cf2baf3ef1d19260)

# But the raw URL returns HTTP 404:
$ curl -I "https://raw.githubusercontent.com/link-assistant/money-making-machines/issue-1-92283df2d887/docs/screenshots/website-index.png"
HTTP/2 404
content-type: text/plain; charset=utf-8
```

---

## Timeline of Events

### 2026-02-24T23:43:47Z — AI solver creates PR with broken images

The hive-mind AI solver worked on issue #1 in the private `link-assistant/money-making-machines` repository. Following system prompt instructions for "Visual UI work and screenshots", the solver:

1. Developed a static website prototype
2. Took screenshots using Playwright MCP browser tools
3. Saved screenshots to `docs/screenshots/` in the repository branch
4. Committed and pushed the screenshots
5. Created PR #2 with embedded screenshot images using `raw.githubusercontent.com` URLs

The solver followed the system prompt instructions verbatim:

> "When you save screenshots to the repository, use permanent raw file links in the pull request description markdown (e.g., https://raw.githubusercontent.com/${owner}/${repo}/${branchName}/docs/screenshots/result.png)."

### 2026-02-25T00:01:33Z — Solution draft log posted

A comment was posted to the PR with the full execution log. Cost: $3.432003 USD.

### 2026-02-25T00:04:50Z — PR marked as ready to merge

The `--auto-restart-until-mergeable` monitor confirmed all CI checks passed and the PR was mergeable.

### 2026-02-25 — Issue #1349 opened

The broken image links were discovered in the PR description. The issue was filed to investigate root cause and improve the system prompt to prevent future occurrences.

---

## Root Cause Analysis

### The Problematic System Prompt Instruction

The `buildSystemPrompt` function in `src/claude.prompts.lib.mjs` (and identically in `src/agent.prompts.lib.mjs`) contained:

```javascript
// Rendered when modelSupportsVision is true:
`Visual UI work and screenshots.
   - When you work on visual UI changes (frontend, CSS, HTML, design), include a render or screenshot of the final result in the pull request description.
   - When you need to show visual results, take a screenshot and save it to the repository (e.g., in a docs/screenshots/ or assets/ folder).
   - When you save screenshots to the repository, use permanent raw file links in the pull request description markdown (e.g., https://raw.githubusercontent.com/${owner}/${repo}/${branchName}/docs/screenshots/result.png).
   - When uploading images, commit them to the branch first, then reference them using the raw GitHub URL format.
   - When the visual result is important for review, mention it explicitly in the pull request description with the embedded image.`;
```

This instruction has no branching logic for repository visibility. It always tells the AI to use `raw.githubusercontent.com` links regardless of whether the repository is public or private.

### Why `raw.githubusercontent.com` Fails for Private Repos

GitHub's raw content delivery service (`raw.githubusercontent.com`) authenticates access via URL-embedded tokens or GitHub Actions OIDC — **not via browser session cookies**. This means:

1. **No public access**: Anyone who isn't authenticated cannot load the image
2. **No GitHub markdown rendering**: GitHub's markdown rendering engine does not inject authentication tokens when rendering `<img>` tags in PR descriptions, comments, or READMEs
3. **Result**: The image tag shows a broken image icon to all viewers, including the repository owner in most browser contexts

Reference: [GitHub Docs — Viewing raw files](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-a-file#viewing-or-copying-the-raw-file-contents) — explicitly notes that private repository raw content requires authentication via personal access token in the URL or request header.

### Alternative Approach: GitHub-Hosted Image Attachments

GitHub supports uploading images directly as attachments to issues/PRs via drag-and-drop or the [Upload a release asset](https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28) / content API. When uploaded this way, images are hosted at `github.com/user-attachments/assets/...` which **renders inline** regardless of repository visibility.

However, this requires:

- Using the GitHub web UI to upload attachments (no CLI/API for PR body image uploads)
- Or using the GitHub GraphQL mutation `createIssueComment` with image attachment workflow — complex and non-standard

### Practical Fix: Warn AI Agents About Private Repo Limitations

The simplest and most reliable fix is to update the system prompt to inform AI agents:

- For **public repositories**: `raw.githubusercontent.com` links work and should be used
- For **private repositories**: `raw.githubusercontent.com` links produce broken images; agents should either skip screenshot embedding or use descriptive alt text instead

---

## The Fix

### Files Changed

1. **`src/claude.prompts.lib.mjs`** — Updated `buildSystemPrompt` to:
   - Accept `repoIsPrivate` parameter
   - When repository is private: instruct agent to NOT embed images via `raw.githubusercontent.com`, and instead describe the visual results in text
   - When repository is public: keep the existing instructions (raw URLs work fine)

2. **`src/agent.prompts.lib.mjs`** — Same changes as `claude.prompts.lib.mjs`

3. **`src/claude.lib.mjs`** — Pass `repoIsPrivate` to `buildSystemPrompt`

4. **`src/agent.lib.mjs`** — Pass `repoIsPrivate` to `buildSystemPrompt`

### Before (broken — same in both claude.prompts.lib.mjs and agent.prompts.lib.mjs)

```javascript
modelSupportsVision
  ? `

Visual UI work and screenshots.
   - When you work on visual UI changes (frontend, CSS, HTML, design), include a render or screenshot of the final result in the pull request description.
   - When you need to show visual results, take a screenshot and save it to the repository (e.g., in a docs/screenshots/ or assets/ folder).
   - When you save screenshots to the repository, use permanent raw file links in the pull request description markdown (e.g., https://raw.githubusercontent.com/${owner}/${repo}/${branchName}/docs/screenshots/result.png).
   - When uploading images, commit them to the branch first, then reference them using the raw GitHub URL format.
   - When the visual result is important for review, mention it explicitly in the pull request description with the embedded image.`
  : '';
```

### After (fixed)

```javascript
modelSupportsVision
  ? `

Visual UI work and screenshots.
   - When you work on visual UI changes (frontend, CSS, HTML, design), include a render or screenshot of the final result in the pull request description.
   - When you need to show visual results, take a screenshot and save it to the repository (e.g., in a docs/screenshots/ or assets/ folder).${
     repoIsPrivate
       ? `
   - IMPORTANT: This is a PRIVATE repository. Do NOT embed screenshots using raw.githubusercontent.com URLs in pull request descriptions or comments — these URLs return HTTP 404 to all viewers (including repository owners) because GitHub does not authenticate raw content requests in markdown rendering. Instead, describe what the screenshot shows in text form (e.g., "The homepage shows a navigation bar with 3 items...").
   - When you save screenshots to the repository, commit them to the branch so they are preserved in git history for future reference, but do not attempt to display them inline in the PR description.`
       : `
   - When you save screenshots to the repository, use permanent raw file links in the pull request description markdown (e.g., https://raw.githubusercontent.com/${owner}/${repo}/${branchName}/docs/screenshots/result.png).
   - When uploading images, commit them to the branch first, then reference them using the raw GitHub URL format.
   - When the visual result is important for review, mention it explicitly in the pull request description with the embedded image.`
   }`
  : '';
```

---

## Impact

### Affected Configurations

Any execution of hive-mind where ALL of the following are true:

1. Repository is **private**
2. AI model supports **vision** (`modelSupportsVision === true`)
3. Issue involves **visual UI work** (frontend, HTML, CSS, screenshots)
4. AI agent takes screenshots and includes them in PR description

### Severity

**Medium** — The issue does not break functionality. PRs are still created and merged correctly. The broken images are a UX/documentation quality issue: reviewers see broken image placeholders instead of informative screenshots.

### Frequency

Relatively low (requires all 4 conditions above), but confusing for users who expect to see visual results in PR descriptions.

---

## Solutions Considered

### Solution 1 (Implemented): Conditional prompt based on `repoIsPrivate`

Check repository visibility before building system prompt. If private, replace the `raw.githubusercontent.com` instruction with a warning to describe visual results in text.

**Pros:**

- Minimal code change
- Uses already-available `getRepoVisibility` function
- Accurate: no broken images, text descriptions are still informative
- Can be extended later if GitHub adds API for private image uploads

**Cons:**

- Requires fetching repository metadata before building system prompt
- Text descriptions are less visually informative than actual screenshots

### Solution 2 (Not Implemented): Upload screenshots via GitHub attachment API

Use GitHub's internal image upload mechanism to host screenshots at `github.com/user-attachments/assets/...`.

**Cons:**

- GitHub's image attachment API is internal and undocumented
- No official CLI or REST API for uploading PR body images (only via web UI)
- Requires multi-step authentication workflow not suitable for AI agents

### Solution 3 (Not Implemented): Always skip screenshot embedding

Completely remove the screenshot instruction from the prompt for all repositories.

**Cons:**

- Loses valuable feature for public repositories where raw URLs work correctly
- Over-correction: public repos benefit from visual screenshots in PR descriptions

### Solution 4 (Not Implemented): Use GitHub Pages or external image host

Deploy screenshots to a public URL (e.g., GitHub Pages, imgur, or similar).

**Cons:**

- Requires additional infrastructure
- Not feasible within a single AI solver session
- Privacy concerns for screenshots of private projects

---

## Related Issues and Libraries

### GitHub Documentation

- [Raw content authentication for private repos](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-a-file#viewing-or-copying-the-raw-file-contents)
- [GitHub image attachments in issues/PRs](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/attaching-files)

### Similar Issues in GitHub Community

- GitHub Community Forum: "Images in private repo README" — well-known issue, multiple workarounds discussed
- Solution: Use `?raw=true` with `github.com` (not `raw.githubusercontent.com`) — still requires auth for private repos
- Authoritative source: Only `github.com/user-attachments/assets/...` URLs render in all markdown contexts for private repos

### External Resources

- [Stack Overflow: "GitHub private repository raw image"](https://stackoverflow.com/questions/18163003/github-raw-image-links) — confirms that raw.githubusercontent.com requires auth for private repos

---

## Test Coverage

New test file: `tests/test-private-repo-screenshots-1349.mjs`

Tests cover:

1. Public repo → screenshot instructions include `raw.githubusercontent.com` URL pattern
2. Private repo → screenshot instructions contain warning about broken raw URLs
3. Private repo → screenshot instructions do NOT contain `raw.githubusercontent.com` pattern
4. No vision model → no screenshot section in either case
5. `repoIsPrivate` defaults to `false` when not provided (backward compatibility for public repos)
6. Same behavior verified for both `claude.prompts.lib.mjs` and `agent.prompts.lib.mjs`
