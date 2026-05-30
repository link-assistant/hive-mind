# External Research — Displaying Images in GitHub PR Comments (Issue #1843)

This file captures the online research used to design the solution. The central
question: **how can a headless process (no browser session) make an image that
Claude/Codex read or wrote appear inline inside a GitHub PR comment?**

## Finding 1 — `data:` URIs do NOT render in GitHub comments

GitHub sanitizes user-authored Markdown/HTML before rendering it. The allow-list
of URL schemes for links and images is restricted to `http`, `https`, `mailto`,
and relative paths; `data:` URIs are stripped. This means the naive approach
suggested as a fallback in the issue — embedding `![](data:image/png;base64,...)`
— is silently removed and the image never appears.

- GitHub uses `github/markup` + an HTML pipeline with a sanitization filter.
  The sanitizer's protocol allow-list does not include `data:` for `img@src`.
- Practical confirmation: pasting a base64 `data:` image into an issue/PR comment
  shows nothing after the comment is saved.

**Consequence:** base64 cannot be embedded directly. An image must be hosted at an
`https://` URL that GitHub will proxy.

## Finding 2 — There is no public API to upload comment attachments

The drag-and-drop "user-attachments" upload that the GitHub web UI performs hits
`https://github.com/upload/policies/assets`. This endpoint:

- Requires a **browser session cookie**, not a Personal Access Token.
- Returns **HTTP 422** when called with a PAT / `Authorization: token ...`.
- Is not part of the documented REST or GraphQL API; there is no supported
  endpoint to create a `https://github.com/user-attachments/assets/...` URL from
  a token-only (headless / CI) context.

Community confirmation (GitHub community discussions and the `gh-attach` project)
repeatedly states the same: the attachments uploader is cookie-gated and cannot
be driven by a PAT.

**Consequence:** the exact URLs the web UI produces cannot be created headlessly.
A different hosting location is required.

## Finding 3 — Token-based hosting options that DO work headlessly

All of the following work with the `gh` token hive-mind already has, for both
public and private repositories (GitHub's Camo image proxy fetches the bytes on
the viewer's behalf, so private-repo images still render for authorized viewers):

1. **Commit the image into the repository (a dedicated branch) and reference the
   raw blob URL.**
   - Upload with the Contents API: `PUT /repos/{owner}/{repo}/contents/{path}`
     with a JSON body `{ message, content: <base64>, branch }`. The endpoint
     accepts base64 **directly** — which is exactly the form Claude/Codex already
     give us.
   - Reference it in Markdown with the blob `?raw=true` URL:
     `https://github.com/{owner}/{repo}/blob/{branch}/{path}?raw=true`.
     This format renders inline in comments and works for private repos (it is
     the format hive-mind's own contributor guidelines recommend for screenshots).
   - To avoid polluting the PR branch / triggering PR CI, commit to a **separate,
     dedicated branch** (an orphan branch created via the Git Data API:
     blob → tree → commit with no parents → ref).

2. **GitHub Release Assets** via the official token API
   (`POST .../releases/{id}/assets`). Works headlessly, but creates user-visible
   "Releases" entries and requires managing a release/tag — more intrusive than a
   hidden media branch.

3. **External object storage** (S3/GCS/Cloudinary/Imgur, etc.). Works, but adds an
   external dependency, credentials, and a data-egress/retention surface that
   hive-mind does not currently have and the issue does not ask for.

**Chosen approach: option 1 (dedicated branch + Contents API + `?raw=true` blob
URL).** It needs no new credentials (reuses the `gh` token), no external service,
keeps the PR diff clean, and renders for public and private repos alike.

## Finding 4 — Existing components / prior art

- **`Addono/gh-attach`** — a tool dedicated to this exact problem. It documents
  four strategies: _Browser Session_, _Cookie Extraction_, _Release Assets_, and
  _Repository Branch_. Only the last two are headless-viable, which corroborates
  Finding 3. Supported media: PNG, GIF, JPEG, SVG, WebP, MP4, MOV, WEBM. It also
  ships an MCP server. Confirms our "repository branch" choice is established
  practice, not a novel hack.
- **hive-mind's own conventions** already recommend the blob `?raw=true` URL
  format for embedding screenshots committed to the repo (see the contributor
  guidance about `docs/screenshots/...?raw=true`). We follow the same convention.
- **GitHub Camo** (`camo.githubusercontent.com`) is the image proxy that lets
  `https://` images (including private-repo raw blob URLs) render in comments
  without leaking the viewer's credentials. This is why blob `?raw=true` URLs work
  in comments.

## Finding 5 — Image payload shapes Claude/Codex actually emit (verified in repo logs)

Verified against real session logs already stored in this repository:

- **Claude tool_result content** (covers the `Read` tool reading an image AND
  Playwright MCP screenshots surfaced through Claude) —
  `docs/case-studies/issue-1486/full-log.txt:12775` and
  `docs/case-studies/issue-1096/full-log.txt:975`:

  ```json
  { "type": "image", "source": { "type": "base64", "data": "iVBORw0KGgo…", "media_type": "image/png" } }
  ```

- **Claude `Read` tool bonus field** — same event, top-level
  `tool_use_result.file` (`issue-1486/full-log.txt:12795`):

  ```json
  "tool_use_result": { "type": "image",
    "file": { "base64": "iVBORw0KGgo…", "type": "image/png", "originalSize": 7573219 } }
  ```

  Note: Claude **downscales** images before streaming — the 7.5 MB original above
  arrives as only ~5 KB of base64, comfortably within Contents-API limits.

- **MCP standard image content** (Codex `mcp_tool_call` results, e.g. Playwright
  through Codex) follows the Model Context Protocol shape:

  ```json
  { "type": "image", "data": "iVBORw0KGgo…", "mimeType": "image/png" }
  ```

The implementation normalizes all three shapes (`source.data`/`media_type`,
`file.base64`/`type`, and `data`/`mimeType`) through a single extractor.

## Sources

- GitHub Docs — _Attaching files_ (web UI drag-and-drop; no token API documented):
  https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
- GitHub REST — _Create or update file contents_ (accepts base64 `content`):
  https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents
- GitHub REST — _Git database (blobs/trees/commits/refs)_ (orphan-branch creation):
  https://docs.github.com/en/rest/git
- GitHub REST — _Release assets_ (alternative token-based hosting):
  https://docs.github.com/en/rest/releases/assets
- `github/markup` HTML-pipeline sanitization (scheme allow-list excludes `data:`):
  https://github.com/github/markup
- `Addono/gh-attach` (four upload strategies; confirms cookie-gated uploader and
  headless-viable Release/Branch strategies):
  https://github.com/Addono/gh-attach
- GitHub Camo image proxy (why `https://` images render in comments):
  https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls
- Model Context Protocol — image content type (`{type, data, mimeType}`):
  https://modelcontextprotocol.io/
