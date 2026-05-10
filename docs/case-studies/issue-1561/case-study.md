# Case Study: Broken Screenshot Attached to Pull Request

**Issue:** [#1561](https://github.com/link-assistant/hive-mind/issues/1561)
**Related PR:** [Jhon-Crow/godot-topdown-MVP#1796](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1796)
**Broken Comment:** [#issuecomment-4226047641](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1796#issuecomment-4226047641)

## 1. Executive Summary

A screenshot was generated correctly and committed to the repository, but appeared **broken** in the PR description and comment because the image URL pointed to the **original repository** (`Jhon-Crow/godot-topdown-MVP`) instead of the **fork** (`konard/Jhon-Crow-godot-topdown-MVP`) where the image was actually pushed. Since the branch `issue-1790-92dae9f72c05` only exists in the fork, GitHub returns a 404 HTML page instead of the image, resulting in a broken image display.

## 2. Timeline / Sequence of Events

| Time (UTC) | Event                     | Details                                                                                                                                                                                 |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18:16:47   | Fork mode detected        | `Auto-fork: No write access detected, enabling fork mode`                                                                                                                               |
| 18:16:49   | Fork identified           | `konard/Jhon-Crow-godot-topdown-MVP`                                                                                                                                                    |
| 18:17:09   | Remote configured         | `origin = https://github.com/konard/Jhon-Crow-godot-topdown-MVP.git`                                                                                                                    |
| 18:17:12   | Branch created            | `issue-1790-92dae9f72c05` pushed to fork                                                                                                                                                |
| 18:17:19   | PR created                | PR #1796 opened on `Jhon-Crow/godot-topdown-MVP`                                                                                                                                        |
| 18:21:25   | Initial solve log         | Solution draft completed (iteration 1)                                                                                                                                                  |
| 18:42:40   | Auto-restart #1           | Merge conflicts detected                                                                                                                                                                |
| 18:42:59   | User comment              | Jhon-Crow: "resolve conflict and attach screenshot of new combo text" (in Russian)                                                                                                      |
| 18:50:57   | Auto-restart #2           | New user comment + merge conflicts                                                                                                                                                      |
| ~18:52:00  | Screenshot generated      | Python PIL script renders combo counter using `gothic_bitmap.fnt` glyphs                                                                                                                |
| ~18:52:23  | Screenshot verified       | AI reads the PNG via Read tool — image is valid                                                                                                                                         |
| 18:53:24   | Screenshot committed      | `docs/screenshots/combo_gothic_font.png` pushed to **fork** (`konard/Jhon-Crow-godot-topdown-MVP`)                                                                                      |
| 18:53:46   | **Broken comment posted** | Comment uses URL: `https://github.com/Jhon-Crow/godot-topdown-MVP/blob/issue-1790-92dae9f72c05/docs/screenshots/combo_gothic_font.png?raw=true` — points to **original repo**, not fork |
| 18:54:00   | Solve log posted          | Iteration 2 completed                                                                                                                                                                   |

## 3. Requirements from Issue

1. Download all logs and data related to the broken screenshot
2. Compile data to `./docs/case-studies/issue-{id}` folder
3. Reconstruct timeline/sequence of events
4. List all requirements from the issue
5. Find root causes of each problem
6. Propose possible solutions and solution plans
7. Check known existing components/libraries that solve similar problems
8. If insufficient data, add debug output and verbose mode
9. Report issues to relevant repositories with reproducible examples

## 4. Root Cause Analysis

### Root Cause #1: Screenshot URL Template Uses Original Repo Instead of Fork

**Severity:** Critical
**Files affected:**

- `src/claude.prompts.lib.mjs` (line 342)
- `src/agent.prompts.lib.mjs` (line 248)

**Problem:** The system prompt template that instructs the AI how to reference screenshots uses `${owner}/${repo}` which always resolves to the **original** repository (e.g., `Jhon-Crow/godot-topdown-MVP`), even when fork mode is active and the code is pushed to a different repository (e.g., `konard/Jhon-Crow-godot-topdown-MVP`).

**The broken template (line 342 of claude.prompts.lib.mjs):**

```javascript
`https://github.com/${owner}/${repo}/blob/${branchName}/docs/screenshots/result.png?raw=true`;
```

**What should happen:** When `argv.fork` is active and `forkedRepo` is available, the URL should point to the fork:

```javascript
`https://github.com/${forkedRepo}/blob/${branchName}/docs/screenshots/result.png?raw=true`;
```

**Evidence chain:**

1. `owner = "Jhon-Crow"`, `repo = "godot-topdown-MVP"` (from issue URL parsing at `solve.mjs:176`)
2. `forkedRepo = "konard/Jhon-Crow-godot-topdown-MVP"` (detected at solve.mjs:523)
3. `buildSystemPrompt` in `claude.prompts.lib.mjs:95` destructures `params` but does NOT extract `forkedRepo`
4. The screenshot URL template at line 342 uses `${owner}/${repo}` => `Jhon-Crow/godot-topdown-MVP`
5. The actual push destination is `konard/Jhon-Crow-godot-topdown-MVP`
6. Branch `issue-1790-92dae9f72c05` exists ONLY in the fork, not in the original repo
7. GitHub returns 404 HTML for the URL, which renders as a broken image

### Root Cause #2: No URL Validation After Screenshot Commit

**Severity:** Medium

The system has no validation step to verify that the screenshot URL is actually accessible after committing and pushing. If a URL validation check existed (e.g., a HEAD request to verify the URL returns 200), the AI would have detected the broken URL and could have self-corrected.

### Root Cause #3: Branch-Based URLs Are Inherently Fragile

**Severity:** Low (design concern)

Using branch-name-based URLs (`/blob/{branchName}/...`) is fragile because:

- Branches can be deleted after PR merge
- In fork mode, the branch exists in a different repository than the URL points to
- Even when working correctly, the URL becomes permanently broken after branch deletion

A more robust approach would use commit-SHA-based URLs or GitHub's upload API.

## 5. Proposed Solutions

### Solution A: Fix Screenshot URL Template for Fork Mode (Recommended - Minimal Fix)

**What:** Modify the `buildSystemPrompt` function in both `claude.prompts.lib.mjs` and `agent.prompts.lib.mjs` to use `forkedRepo` when available.

**How:**

1. Add `forkedRepo` to the destructured params in `buildSystemPrompt`
2. Compute `screenshotRepoPath = (argv?.fork && forkedRepo) ? forkedRepo : `${owner}/${repo}``
3. Use `screenshotRepoPath` in the URL template

**Pros:** Minimal change, fixes the immediate bug
**Cons:** Still uses branch-based URLs (fragile after branch deletion)

### Solution B: Use Commit SHA-Based URLs

**What:** Instead of branch-based URLs, use commit SHA-based URLs that are permanent.

**Format:** `https://raw.githubusercontent.com/${repoPath}/${commitSHA}/docs/screenshots/result.png`

**Pros:** URLs are permanent and never break
**Cons:** Requires knowing the commit SHA at URL construction time (the AI knows it after `git push`)

### Solution C: Use GitHub's Upload API for PR Attachments

**What:** Use GitHub's native image upload mechanism (drag-and-drop style uploads via API) instead of committing images to the repository.

**How:** Use the `uploads.github.com` endpoint or `gh` CLI to upload images as PR attachments.

**Pros:** Images are stored in GitHub's CDN, URLs never break, no repo bloat
**Cons:** Requires API integration, images not in version control

### Solution D: Add URL Validation After Screenshot Commit

**What:** After committing and pushing a screenshot, verify the URL is accessible.

**How:** Add a system prompt instruction to verify screenshot URLs with a HEAD request after pushing.

**Pros:** Catches broken URLs regardless of cause
**Cons:** Reactive rather than preventive

### Recommended Plan: Solution A + D

1. **Immediate fix (Solution A):** Fix the URL template to use fork repo path when in fork mode
2. **Defensive measure (Solution D):** Add instruction to verify screenshot URL accessibility after push

## 6. Existing Components / Libraries

- **GitHub REST API - Contents endpoint:** `GET /repos/{owner}/{repo}/contents/{path}?ref={ref}` - can verify file exists at a specific ref
- **raw.githubusercontent.com:** Direct raw file serving, supports commit SHAs: `https://raw.githubusercontent.com/{owner}/{repo}/{sha}/{path}`
- **GitHub Upload API:** `POST https://uploads.github.com/repos/{owner}/{repo}/releases/{release_id}/assets` - for release assets (not directly applicable for PR comments)
- **GitHub Issue/PR comment image uploads:** GitHub supports drag-and-drop image uploads which use `user-attachments` CDN — however there's no documented API for this

## 7. Data Files

All solve execution logs are stored in `./docs/case-studies/issue-1561/logs/`:

| File                              | Description                                        | Size   |
| --------------------------------- | -------------------------------------------------- | ------ |
| `solve-log-initial-38cab3cc.txt`  | Initial solve session log                          | 1.9 MB |
| `solve-log-iter1-c06437c2.txt`    | Auto-restart iteration 1 (merge conflicts)         | 3.4 MB |
| `solve-log-iter2-50c87aee.txt`    | Auto-restart iteration 2 (screenshot created here) | 5.6 MB |
| `solve-log-iter3-e56531bd.txt`    | Auto-restart iteration 3                           | 6.9 MB |
| `solve-log-session3-391840b7.txt` | Additional session log                             | 274 KB |

## 8. Verification

### Broken URL (returns HTML 404):

```
https://github.com/Jhon-Crow/godot-topdown-MVP/blob/issue-1790-92dae9f72c05/docs/screenshots/combo_gothic_font.png?raw=true
```

- Branch `issue-1790-92dae9f72c05` does NOT exist in `Jhon-Crow/godot-topdown-MVP` (original repo)
- Returns HTML `<!DOCTYPE html>` (GitHub 404 page)

### Working URL (returns valid PNG):

```
https://raw.githubusercontent.com/konard/Jhon-Crow-godot-topdown-MVP/issue-1790-92dae9f72c05/docs/screenshots/combo_gothic_font.png
```

- Branch `issue-1790-92dae9f72c05` EXISTS in `konard/Jhon-Crow-godot-topdown-MVP` (fork)
- Returns valid PNG (89 50 4e 47 header, 21KB)

### Permanent URL (using commit SHA):

```
https://raw.githubusercontent.com/konard/Jhon-Crow-godot-topdown-MVP/8ecd00178e5eb4ae9f66a3e50750e9dde7305e9b/docs/screenshots/combo_gothic_font.png
```

## 9. Screenshot Content

The generated screenshot is actually a **valid, well-crafted image**. It was programmatically rendered using Python PIL by:

1. Loading the `gothic_bitmap.fnt` font definition file
2. Loading the `gothic_bitmap.png` sprite sheet
3. Extracting individual glyph images for each character
4. Compositing "x3 COMBO" in gold color (255, 215, 60) and "+150" in green (100, 255, 140)
5. Adding a dark purple background with decorative border
6. Saving as PNG to `docs/screenshots/combo_gothic_font.png`

The image correctly demonstrates the Gothic bitmap font applied to the combo counter — the technical content is accurate, only the URL reference was broken.
