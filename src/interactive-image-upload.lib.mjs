#!/usr/bin/env node
/**
 * Interactive Mode Image Upload (Issue #1843)
 *
 * When Claude/Codex read or write images during an --interactive-mode session,
 * interactive mode should show those images inline in the PR comments it posts.
 *
 * GitHub strips `data:` URIs from comment Markdown (its sanitizer only allows
 * http/https/mailto/relative schemes), so embedding base64 inline does NOT work.
 * The web "user-attachments" uploader is cookie-gated and rejects Personal Access
 * Tokens (HTTP 422), so it cannot be driven headlessly either.
 *
 * The token-viable approach used here: commit each image to a dedicated media
 * branch via the GitHub Contents API (which accepts base64 `content` directly —
 * exactly the form Claude/Codex already give us) and reference the resulting
 * `?raw=true` blob URL, which renders inline for both public and private repos
 * (GitHub's Camo proxy fetches the bytes for authorized viewers).
 *
 * See docs/case-studies/issue-1843/ for the full analysis and sources.
 *
 * @module interactive-image-upload.lib.mjs
 * @experimental
 */

import { createHash } from 'node:crypto';
import { execFileAsync } from './interactive-mode.shared.lib.mjs';

/**
 * Default branch used to host interactive-mode media. It is created as an orphan
 * branch (no shared history with the code branches) so it never pollutes the PR
 * diff or triggers PR CI. Images live under `media/pr-<n>/<hash>.<ext>`.
 */
export const DEFAULT_MEDIA_BRANCH = 'hive-mind-interactive-media';

const README_CONTENT = `# hive-mind interactive media

This orphan branch stores images that hive-mind's \`--interactive-mode\` read or
wrote during a session, so they can be embedded inline in PR comments.

It is created and updated automatically. It is **not** meant to be merged. Files
are organized as \`media/pr-<number>/<sha256-prefix>.<ext>\` and de-duplicated by
content hash. See \`docs/case-studies/issue-1843/\` for details.
`;

const EXT_BY_MEDIA_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
};

/**
 * Map an image MIME type to a file extension. Defaults to `png`.
 * @param {string} mediaType
 * @returns {string}
 */
export const extensionForMediaType = mediaType => {
  if (typeof mediaType !== 'string') return 'png';
  const key = mediaType.toLowerCase().split(';')[0].trim();
  return EXT_BY_MEDIA_TYPE[key] || 'png';
};

/**
 * Normalize an image payload from any of the shapes Claude/Codex emit into
 * `{ base64, mediaType }`, or return null if the node is not an image.
 *
 * Verified shapes (see docs/case-studies/issue-1843/external/research-notes.md):
 *  - Claude tool_result content: { type:'image', source:{ type:'base64', data, media_type } }
 *  - MCP image content:          { type:'image', data, mimeType }
 *  - Claude Read tool_use_result: { type:'image', file:{ base64, type, originalSize } }
 *
 * @param {*} node
 * @returns {{ base64: string, mediaType: string, originalSize?: number } | null}
 */
export const extractImagePayload = node => {
  if (!node || typeof node !== 'object') return null;

  // Claude tool_result image block: { type:'image', source:{ data, media_type } }
  if (node.type === 'image' && node.source && typeof node.source === 'object' && typeof node.source.data === 'string' && node.source.data.length > 0) {
    return { base64: node.source.data, mediaType: node.source.media_type || node.source.mimeType || 'image/png' };
  }

  // MCP image content: { type:'image', data, mimeType }
  if (node.type === 'image' && typeof node.data === 'string' && node.data.length > 0) {
    return { base64: node.data, mediaType: node.mimeType || node.media_type || 'image/png' };
  }

  // Claude Read tool_use_result: { type:'image', file:{ base64, type, originalSize } }
  if (node.file && typeof node.file === 'object' && typeof node.file.base64 === 'string' && node.file.base64.length > 0) {
    return { base64: node.file.base64, mediaType: node.file.type || node.file.media_type || 'image/png', originalSize: node.file.originalSize };
  }

  return null;
};

/**
 * True when `extractImagePayload` would return a payload for this node.
 * @param {*} node
 * @returns {boolean}
 */
export const isImageNode = node => extractImagePayload(node) !== null;

/**
 * Build a Markdown-embeddable raw blob URL for a file committed to a branch.
 * The `?raw=true` blob URL renders inline in comments for public and private
 * repos (GitHub Camo proxies it for authorized viewers).
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} path
 * @returns {string}
 */
export const buildRawBlobUrl = (owner, repo, branch, path) => {
  const safePath = String(path)
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${safePath}?raw=true`;
};

/**
 * Create an image uploader bound to a repository/PR.
 *
 * @param {Object} options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number|string} [options.prNumber] - PR number (used to namespace paths)
 * @param {string} [options.branch] - Media branch name
 * @param {Function} [options.log] - async logging function
 * @param {boolean} [options.verbose=false]
 * @param {Function} [options.execFile] - injected gh runner (for testing)
 * @param {boolean} [options.enabled=true] - master switch
 * @returns {{ uploadImage: Function, ensureBranch: Function, enabled: boolean, _state: Object }}
 */
export const createImageUploader = (options = {}) => {
  const { owner, repo, prNumber, branch = DEFAULT_MEDIA_BRANCH, log = async () => {}, verbose = false, execFile: execFileFn, enabled = true } = options;

  const runGhApi = execFileFn || execFileAsync;

  // Memoized branch-readiness promise and a per-session content-hash → URL cache.
  let branchReady = null;
  const uploadedByHash = new Map();

  /**
   * Invoke `gh api` and parse the JSON response. For non-GET methods a JSON body
   * is supplied on stdin via `--input -` (matches interactive-mode's postComment).
   * @private
   */
  const ghJson = async (apiPath, { method = 'GET', body } = {}) => {
    const args = ['api', apiPath];
    if (method && method !== 'GET') args.push('-X', method);
    const execOpts = { maxBuffer: 16 * 1024 * 1024 };
    if (body !== undefined) {
      args.push('--input', '-');
      execOpts.input = JSON.stringify(body);
    }
    const { stdout } = await runGhApi('gh', args, execOpts);
    if (!stdout) return null;
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  };

  /** @private — does the media branch already exist? */
  const branchExists = async () => {
    try {
      const ref = await ghJson(`repos/${owner}/${repo}/git/ref/heads/${branch}`);
      return !!ref;
    } catch {
      return false;
    }
  };

  /**
   * Ensure the orphan media branch exists. Creates it once via the Git Data API
   * (blob → tree → parentless commit → ref). Memoized; resolves to a boolean.
   * @returns {Promise<boolean>}
   */
  const ensureBranch = async () => {
    if (branchReady) return branchReady;
    branchReady = (async () => {
      if (await branchExists()) return true;
      try {
        const readmeB64 = Buffer.from(README_CONTENT, 'utf8').toString('base64');
        const blob = await ghJson(`repos/${owner}/${repo}/git/blobs`, {
          method: 'POST',
          body: { content: readmeB64, encoding: 'base64' },
        });
        const tree = await ghJson(`repos/${owner}/${repo}/git/trees`, {
          method: 'POST',
          body: { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] },
        });
        const commit = await ghJson(`repos/${owner}/${repo}/git/commits`, {
          method: 'POST',
          body: { message: 'chore: initialize hive-mind interactive media branch', tree: tree.sha, parents: [] },
        });
        await ghJson(`repos/${owner}/${repo}/git/refs`, {
          method: 'POST',
          body: { ref: `refs/heads/${branch}`, sha: commit.sha },
        });
        if (verbose) await log(`🖼️ Interactive mode: created media branch '${branch}'`, { verbose: true });
        return true;
      } catch (err) {
        // A concurrent run may have created it between our check and create.
        if (await branchExists()) return true;
        await log(`⚠️ Interactive mode: could not prepare media branch '${branch}': ${err.message}`);
        return false;
      }
    })();
    return branchReady;
  };

  /**
   * Upload one image and return a Markdown-embeddable URL, or null on failure /
   * when disabled. De-duplicates by SHA-256 of the base64 content.
   *
   * @param {Object} image
   * @param {string} image.base64 - base64-encoded image bytes
   * @param {string} [image.mediaType] - MIME type (e.g. image/png)
   * @param {string} [image.name] - human label for the commit message
   * @returns {Promise<string|null>}
   */
  const uploadImage = async ({ base64, mediaType, name } = {}) => {
    if (!enabled) return null;
    if (!owner || !repo) return null;
    if (typeof base64 !== 'string' || base64.length === 0) return null;

    const hash = createHash('sha256').update(base64).digest('hex');
    if (uploadedByHash.has(hash)) return uploadedByHash.get(hash);

    const ready = await ensureBranch();
    if (!ready) return null;

    const ext = extensionForMediaType(mediaType);
    const short = hash.slice(0, 16);
    const prSeg = prNumber ? `pr-${prNumber}` : 'misc';
    const path = `media/${prSeg}/${short}.${ext}`;
    const apiPath = `repos/${owner}/${repo}/contents/${path}`;
    const url = buildRawBlobUrl(owner, repo, branch, path);

    try {
      await ghJson(apiPath, {
        method: 'PUT',
        body: {
          message: `chore: add interactive media ${name || short}`,
          content: base64,
          branch,
        },
      });
      uploadedByHash.set(hash, url);
      if (verbose) await log(`🖼️ Interactive mode: uploaded image → ${url}`, { verbose: true });
      return url;
    } catch (err) {
      // A 422 typically means the file already exists (same content hash from a
      // prior run). Verify it is really there before reusing the URL; otherwise
      // treat as a genuine failure and degrade to a metadata note upstream.
      try {
        const existing = await ghJson(`${apiPath}?ref=${encodeURIComponent(branch)}`);
        if (existing) {
          uploadedByHash.set(hash, url);
          return url;
        }
      } catch {
        /* fall through to failure */
      }
      await log(`⚠️ Interactive mode: image upload failed (${path}): ${err.message}`);
      return null;
    }
  };

  return { uploadImage, ensureBranch, enabled, _state: { uploadedByHash } };
};

export default {
  DEFAULT_MEDIA_BRANCH,
  extensionForMediaType,
  extractImagePayload,
  isImageNode,
  buildRawBlobUrl,
  createImageUploader,
};
