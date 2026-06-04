# Issue 1843 Case Study: Displaying Images in `--interactive-mode`

## Summary

Issue #1843 asks that when Claude/Codex read or write images during a
`--interactive-mode` session, those images be shown **inline** in the PR comments
that interactive mode posts — so a human watching the PR gets real visual feedback
while the AI works with UI (screenshots, diagrams, rendered output).

The root cause of the missing feature was local to hive-mind:
`src/interactive-mode.lib.mjs` serialized image tool results as raw JSON. An image
block (`{type:'image', source:{data:'<base64>', media_type}}`) was passed straight
to `safeJsonStringify(c)`, so the comment received a giant, unreadable base64 blob
inside a code fence instead of a rendered picture — and the collapsed "Raw JSON"
section dumped the same multi-kilobyte base64 a second time, bloating every
image-bearing comment.

The issue suggested base64 "if there is no other way to upload images." Research
(see `external/research-notes.md`) shows GitHub **strips `data:` URIs** from
comments, so inline base64 cannot work. The fix instead uploads each image to a
hidden custom Git ref (`refs/hive-mind-media/pr-<number>`) with the Git Data API
and embeds the resulting commit-SHA `?raw=true` blob URL, which renders inline for
public and private repos. The custom ref keeps the media commits reachable without
creating a branch or tag. When upload is disabled or fails, the comment degrades
to a compact metadata note (type + size) rather than a base64 dump.

## Collected Data

- `data/issue-1843.json`: issue title, body, author, timestamps, labels, URL.
- `data/issue-1843-comments.json`: issue discussion (empty — no comments yet).
- `data/pr-1844.json`: the prepared pull request metadata, body, branch, commits.
- `data/pr-1844-conversation-comments.json`, `data/pr-1844-review-comments.json`,
  `data/pr-1844-reviews.json`: PR comment/review payloads. Conversation comments
  include the maintainer follow-up selecting `refs/hive-mind-media/...` as the
  default storage strategy and asking to verify every `--tool` that supports
  `--interactive-mode`.
- `external/research-notes.md`: online research into GitHub image-hosting options,
  the cookie-gated attachments uploader, the chosen hidden custom-ref approach,
  prior art (`gh-attach`), and the exact image payload shapes verified against
  real session logs already in this repo.

## Timeline

- 2026-05-30 13:43 UTC: Issue #1843 opened (`konard`) requesting image display in
  `--interactive-mode`, with the standard requirement to compile a case study under
  `docs/case-studies/issue-1843` and propose solutions per requirement.
- 2026-05-30 13:45 UTC: PR #1844 created as a draft for branch
  `issue-1843-8a6facb18142`.
- 2026-05-30: Data collected, external research completed, root cause identified in
  `handleToolResult`, and the upload-and-embed solution implemented in this PR.
- 2026-06-04 16:42 UTC: Maintainer follow-up selected the custom-ref option
  (`refs/hive-mind-media/...`, no branch, no tag) as the default path and asked to
  verify all `--interactive-mode` supported tools.

## Requirements

Extracted verbatim from the issue, one row per distinct requirement:

1. **Display images that Claude/Codex read or write directly in the comments**
   during `--interactive-mode`, to give the user visual feedback while the AI works
   with the UI.
2. **Use base64 encoding if there is no other way to upload images** — i.e., prefer
   a real upload path, fall back to base64 only as a last resort.
3. **Consider artifacts / attaching to pull requests** as a hosting mechanism.
4. **Consider whether `gh` can upload images** now.
5. **Compile all related issue/PR data** into `./docs/case-studies/issue-1843/`.
6. **Do a deep case-study analysis**, including **searching online** for additional
   facts and data.
7. **List each and every requirement** from the issue (this section).
8. **Propose possible solutions / solution plans for each requirement**, and
   **check existing components/libraries** that solve a similar problem.
9. **Execute everything in this single pull request** (#1844) until every
   requirement is fully addressed.

## External Research

Full detail and sources are in `external/research-notes.md`. Key conclusions:

- **`data:` URIs are stripped by GitHub's Markdown sanitizer** (scheme allow-list
  is `http`/`https`/`mailto`/relative). So the issue's base64 fallback cannot
  render inline — requirement 2's "if there is no other way" condition is _met_,
  forcing a real upload path.
- **No token-driven attachments API exists.** The web UI uploader
  (`github.com/upload/policies/assets`) is cookie-gated and returns 422 for PATs,
  so requirements 3 and 4 cannot be satisfied with the user-attachments URL from a
  headless context.
- **Token-viable hosting** that renders inline for public _and_ private repos:
  (a) commit to a repository ref and reference the `?raw=true` blob URL; (b)
  Release Assets; (c) external object storage. The final PR uses a hidden custom
  ref, not a branch or tag.
- **Prior art:** `Addono/gh-attach` documents the same four strategies and confirms
  only Release-Assets and Repository-Branch work headlessly. hive-mind's own
  contributor guidance already recommends the blob `?raw=true` format for
  committed screenshots.
- **Image payload shapes** were verified against real logs in this repo
  (`issue-1486/full-log.txt`, `issue-1096/full-log.txt`): Claude emits
  `source.{data,media_type}` (Read + Playwright screenshots) plus a Read-only
  `tool_use_result.file.{base64,type,originalSize}`; Codex/MCP emit
  `{data, mimeType}`. Claude downscales images, so streamed base64 is small.
- **Storing images _without a branch_** (maintainer follow-up question): a live
  experiment against this repo (`experiments/storage-probe.sh`) confirms that
  **GitHub Actions artifacts cannot be embedded inline** (zip archives,
  auth/expiring URLs, workflow-only creation), release assets require a tag and
  pollute Releases, and gists are cross-account. The token-only, inline-renderable
  options that need **no branch** are a **git tag** (`…/blob/<tag>/…?raw=true`,
  HTTP 200 verified) or a **custom ref namespace** `refs/hive-mind-media/*`
  embedded via the **commit-SHA** `…/blob/<sha>/…?raw=true` URL (HTTP 200
  verified) — the latter is invisible in every GitHub UI list. The maintainer
  selected the custom-ref path, so the implementation now uses
  `refs/hive-mind-media/pr-<number>`. See `external/research-notes.md` Finding 6.

## Root Causes

- `src/interactive-mode.lib.mjs#handleToolResult()` mapped array tool-result
  content with `c => c.type === 'text' ? c.text : safeJsonStringify(c)`. For an
  image block this serialized the base64 into a ` ``` ` fence — never an
  image — and produced enormous comments.
- The same handler appended `createRawJsonSection([toolData, data])`, which
  re-serialized the entire event **including** the base64 image data, doubling the
  bloat and pushing comments toward the API size limit.
- `handleCodexMcpToolCall()` had the same problem for Codex: `item.result` (where a
  Playwright screenshot lands) was dumped via `safeJsonStringify`.
- There was no mechanism anywhere to turn an in-stream base64 image into an
  `https://` URL that GitHub will render.

## Solution Plan

Implemented in this PR:

- **New module `src/interactive-image-upload.lib.mjs`:**
  - `extractImagePayload(node)` / `isImageNode(node)` normalize the three verified
    payload shapes into `{ base64, mediaType }`.
  - `extensionForMediaType(mediaType)` maps MIME → file extension.
  - `buildMediaRef({ prNumber })` creates the hidden custom ref name
    `refs/hive-mind-media/pr-<number>`.
  - `createImageUploader({ owner, repo, prNumber, mediaRef, ... })` returns
    `{ uploadImage }`. It lazily creates the custom media ref once (Git Data API:
    blob → tree → parentless commit → ref), then uploads each image by creating an
    image blob, tree, commit, and non-forced ref update. Images are de-duplicated
    by SHA-256 content hash (so repeated identical frames upload once), and the
    returned URL is
    `https://github.com/{owner}/{repo}/blob/{commitSha}/{path}?raw=true`. All
    failures degrade gracefully to `null`.
- **`src/interactive-mode.shared.lib.mjs`:** add `redactImageData(data)` (deep-clone
  that replaces base64 image fields with a `<image data: N base64 chars>`
  placeholder), `createRedactedRawJsonSection(data)`, and `formatImageEmbeds(...)`
  (which renders `![](url)` embeds, or a compact "image upload unavailable" note when
  no URL is available) so the raw-JSON sections never carry base64 and rendering is
  consistent.
- **`src/interactive-mode.lib.mjs`:**
  - `handleToolResult()` detects image nodes (in `toolResult.content` and the
    top-level `tool_use_result.file`), uploads them, and appends a rendered
    `### 🖼️ Images` section with `![](url)` embeds (or a metadata note when upload
    is disabled/failed). Image blocks are replaced with a short text placeholder in
    the textual output, and the raw-JSON section uses the redacted event.
  - `handleCodexMcpToolCall()` does the same for `item.result`.
  - The handler builds the uploader from its existing context (owner, repo,
    prNumber, log, verbose, execFile), honoring a new `imageUploadEnabled` flag;
    tests can inject a fake `imageUploader`.
- **`src/solve.config.lib.mjs`:** add boolean option `interactive-image-upload`
  (default **true**, disable with `--no-interactive-image-upload`).
- **`src/claude.lib.mjs` / `src/codex.lib.mjs`:** thread
  `imageUploadEnabled: argv['interactive-image-upload'] !== false` into
  `createInteractiveHandler`.

## Reproduction And Verification

Reproduction (before the fix): drive `handleToolResult` with a real image
tool-result event. The posted comment contained a base64 blob inside a code fence
(no image) and a Raw JSON section repeating the same base64.

Automated tests (`tests/test-interactive-mode-images.mjs`) assert, with a mocked
`gh` runner so no real network/commits happen:

- `extractImagePayload` handles all three shapes and rejects non-image nodes.
- `createImageUploader` creates the hidden custom media ref exactly once, uploads
  via the Git Data API (no branch/tag, no Contents API), returns a commit-SHA
  `?raw=true` blob URL, and de-duplicates by content hash.
- `handleToolResult` embeds `![](…?raw=true)` for an image result and **never**
  emits raw base64 (neither in the body nor the Raw JSON section).
- With `imageUploadEnabled:false` (or on upload failure) the comment shows a compact
  image-metadata note instead of base64.
- `handleCodexMcpToolCall` renders MCP image results the same way.
- Token sanitization still runs on every posted/edited body (issue #1745 invariant).

## Upstream Reporting

No upstream issue is warranted. The external constraints (no token attachments API;
`data:` URIs stripped) are documented GitHub behavior, and the chosen custom-ref
Git Data API approach uses supported GitHub ref/blob/tree/commit endpoints. The
defect was hive-mind rendering image tool-results as raw JSON instead of uploading
and embedding them; it is fixed in this PR.
