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

1. **Commit the image into the repository and reference a raw blob URL.**
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
   - Maintainer follow-up selected the no-branch variant of this same repository
     storage approach: create/update a hidden custom ref
     `refs/hive-mind-media/pr-<number>` via the Git Data API
     (blob → tree → commit → ref), then embed by commit SHA:
     `https://github.com/{owner}/{repo}/blob/{commitSha}/{path}?raw=true`.

2. **GitHub Release Assets** via the official token API
   (`POST .../releases/{id}/assets`). Works headlessly, but creates user-visible
   "Releases" entries and requires managing a release/tag — more intrusive than a
   hidden custom ref.

3. **External object storage** (S3/GCS/Cloudinary/Imgur, etc.). Works, but adds an
   external dependency, credentials, and a data-egress/retention surface that
   hive-mind does not currently have and the issue does not ask for.

**Chosen approach: option 1's custom-ref variant (`refs/hive-mind-media/*` + Git
Data API + commit-SHA `?raw=true` blob URL).** It needs no new credentials (reuses
the `gh` token), no external service, keeps the PR diff and branch/tag lists
clean, and renders for public and private repos alike.

## Finding 4 — Existing components / prior art

- **`Addono/gh-attach`** — a tool dedicated to this exact problem. It documents
  four strategies: _Browser Session_, _Cookie Extraction_, _Release Assets_, and
  _Repository Branch_. Only the last two are headless-viable, which corroborates
  Finding 3. Supported media: PNG, GIF, JPEG, SVG, WebP, MP4, MOV, WEBM. It also
  ships an MCP server. Confirms repository-backed image storage is established
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
  arrives as only ~5 KB of base64, comfortably within GitHub API payload limits.

- **MCP standard image content** (Codex `mcp_tool_call` results, e.g. Playwright
  through Codex) follows the Model Context Protocol shape:

  ```json
  { "type": "image", "data": "iVBORw0KGgo…", "mimeType": "image/png" }
  ```

The implementation normalizes all three shapes (`source.data`/`media_type`,
`file.base64`/`type`, and `data`/`mimeType`) through a single extractor.

## Finding 6 — Storing images _without introducing a branch_ (maintainer question)

The maintainer asked whether images can be stored without creating a branch —
specifically calling out **GitHub Actions artifacts**, **PR-linked attachments**,
**Actions**, and **repository-wide** storage. Each option was evaluated and the
viable ones were **verified with a live experiment** against this very
(public) repository (`experiments/storage-probe.sh` / `experiments/storage-probe2.sh`,
logs in `experiments/storage-probe.log` / `experiments/storage-probe2.log`).

### What does NOT work

- **GitHub Actions artifacts** — cannot be embedded inline. Artifacts are stored
  as **zip archives**, their download URLs are **authenticated, signed and
  expiring** (and subject to a retention window, 90 days by default), and they can
  only be **created from inside a workflow run** (`actions/upload-artifact`); there
  is no PAT-usable public REST endpoint to upload an artifact, and no stable
  `https://` URL that GitHub Markdown/Camo will render as an image. → **No.**
- **PR-linked "attachments"** (the `github.com/user-attachments/assets/…` URLs the
  web editor produces) — the uploader (`github.com/upload/policies/assets`) is
  **cookie/session-gated and rejects PATs (HTTP 422)**, as already documented in
  Finding 2. Not drivable headlessly. → **No.**
- **Gists** — creatable with a token (`POST /gists`), but a gist is owned by the
  **token's user account**, not the repository; binary/image support is poor and
  access control for private content is inconsistent. → **Not suitable.**
- **"Repository-wide" loose objects** — a git blob/commit that is **not reachable
  from any ref gets garbage-collected**. You always need _some_ ref to keep the
  bytes alive and servable. So the real question is _which kind of ref_ — and a
  branch is only one option.

### What DOES work (token-only, renders inline, public + private)

GitHub serves raw bytes (and proxies them through Camo for comments) for content
reachable by **(a)** a branch name, **(b)** a tag name, or **(c)** a **commit
SHA**. Only branches and tags appear in the friendly `/blob/<name>/…` and
`raw.githubusercontent.com/<name>/…` URLs, **but a commit SHA works the same way**
— and a commit SHA can be kept alive by _any_ ref, including a **custom ref
namespace** that is neither a branch nor a tag and therefore appears in **no**
GitHub UI list (branch dropdown, PR base picker, tags/releases).

Live experiment results (all against `link-assistant/hive-mind`, refs cleaned up
afterward — see the probe logs):

| Approach                                                    | Embed URL                                                                                         | Result                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Git tag** `refs/tags/…`                                   | `…/blob/<tag>/<path>?raw=true` and `raw.githubusercontent.com/<o>/<r>/<tag>/<path>`               | **HTTP 200, `image/png`** ✅                                                                                              |
| **Custom ref** `refs/hive-mind-media/…` (no branch, no tag) | `…/blob/<commit-sha>/<path>?raw=true` and `raw.githubusercontent.com/<o>/<r>/<commit-sha>/<path>` | **HTTP 200, `image/png`** ✅                                                                                              |
| **Release asset**                                           | `…/releases/download/<tag>/<asset>`                                                               | token-uploadable, but **requires a tag**, pollutes the Releases UI, and does not reliably render inline for private repos |

Both verified options use the **same token-only Git Data API flow already in the
code** (blob → tree → parentless commit → create ref); the only change is the ref
_kind_ and, for the custom-ref option, embedding by **commit SHA** instead of by
ref name (because GitHub's friendly URLs resolve only `heads/*` and `tags/*`,
while a SHA resolves regardless of the ref namespace that keeps it alive).

Probe 2 additionally confirmed the exact API contract a custom-ref store relies
on: a single custom ref can be fetched via
`GET /repos/{o}/{r}/git/ref/hive-mind-media/<name>` (returns
`object.{type:'commit', sha}`), re-creating an existing ref returns **HTTP 422**
("Reference already exists" — the natural cross-run de-dup signal), and the
commit-SHA `?raw=true` URL serves the bytes (**HTTP 200 `image/png`**).

### Recommendation

For a truly "no branch" store, a **custom ref namespace
(`refs/hive-mind-media/*`) embedded via the commit-SHA `?raw=true` URL** is the
cleanest: it keeps the bytes alive, is invisible in every GitHub UI list, needs no
new credentials/services, and renders inline for public and private repos. A
**git tag** is the simpler alternative (friendly URL, one-line change from the
branch-first draft) at the cost of showing up under Tags/Releases. The orphan
**branch** draft remains a valid fallback; it works but is visible in the branch
list and as a potential (never-intended) merge target — which is what prompted the
question. The maintainer selected the custom-ref option, and the PR now implements
that option.

## Sources

- GitHub Docs — _Attaching files_ (web UI drag-and-drop; no token API documented):
  https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
- GitHub REST — _Create or update file contents_ (branch-based alternative; accepts base64 `content`):
  https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents
- GitHub REST — _Git database (blobs/trees/commits/refs)_ (custom-ref creation and updates):
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
- GitHub Actions — _Storing and sharing data with artifacts_ (zip archives,
  retention window, workflow-only creation; no inline-embeddable URL):
  https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts
- GitHub REST — _Git references_ (create/update/delete arbitrary refs, including
  custom namespaces, with a token):
  https://docs.github.com/en/rest/git/refs
- Live experiment in this repo confirming tag and custom-ref serving:
  `experiments/storage-probe.sh` / `experiments/storage-probe2.sh` and their logs
