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
 * The token-viable approach used here: store image blobs in a hidden custom Git
 * ref (`refs/hive-mind-media/...`) via the Git Data API and embed a commit-SHA
 * `?raw=true` blob URL. The custom ref keeps commits reachable without creating
 * a branch or tag, while GitHub's Camo proxy renders the URL inline for authorized
 * viewers in public and private repos.
 *
 * See docs/case-studies/issue-1843/ for the full analysis and sources.
 *
 * @module interactive-image-upload.lib.mjs
 * @experimental
 */

import { createHash } from 'node:crypto';
import { execFileAsync } from './interactive-mode.shared.lib.mjs';

/**
 * Hidden custom-ref namespace used to keep interactive-mode image commits alive
 * without adding a branch or tag to the repository UI. Each PR gets its own ref:
 * `refs/hive-mind-media/pr-<number>`.
 */
export const DEFAULT_MEDIA_REF_NAMESPACE = 'refs/hive-mind-media';

const README_CONTENT = `# hive-mind interactive media

This custom Git ref stores images that hive-mind's \`--interactive-mode\` read or
wrote during a session, so they can be embedded inline in PR comments.

It is created and updated automatically under \`refs/hive-mind-media/...\`. It is
not a branch or tag and is not meant to be checked out or merged. Files are
organized as \`media/pr-<number>/<sha256-prefix>.<ext>\` and de-duplicated by
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

const sanitizeRefSegment = value => {
  const segment = String(value || 'misc')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return segment || 'misc';
};

const normalizeRefNamespace = namespace => {
  const raw = String(namespace || DEFAULT_MEDIA_REF_NAMESPACE)
    .replace(/\/+$/g, '')
    .replace(/^\/+/g, '');
  return raw.startsWith('refs/') ? raw : `refs/${raw}`;
};

/**
 * Build the hidden custom Git ref used for one PR's media.
 * @param {Object} [options]
 * @param {number|string} [options.prNumber]
 * @param {string} [options.namespace]
 * @returns {string}
 */
export const buildMediaRef = ({ prNumber, namespace = DEFAULT_MEDIA_REF_NAMESPACE } = {}) => {
  const prSeg = prNumber ? `pr-${sanitizeRefSegment(prNumber)}` : 'misc';
  return `${normalizeRefNamespace(namespace)}/${prSeg}`;
};

const refPathForApi = fullRef =>
  String(fullRef)
    .replace(/^refs\//, '')
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');

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
 * Build a Markdown-embeddable raw blob URL for a file committed at a reachable
 * commit SHA. The custom media ref keeps that commit reachable without exposing a
 * branch/tag, and the `?raw=true` URL renders inline in GitHub comments.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} commitSha
 * @param {string} path
 * @returns {string}
 */
export const buildRawBlobUrl = (owner, repo, commitSha, path) => {
  const safePath = String(path)
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(commitSha)}/${safePath}?raw=true`;
};

/**
 * Create an image uploader bound to a repository/PR.
 *
 * @param {Object} options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number|string} [options.prNumber] - PR number (used to namespace paths/ref)
 * @param {string} [options.mediaRef] - Full custom media ref (defaults to refs/hive-mind-media/pr-<n>)
 * @param {string} [options.refNamespace] - Custom media ref namespace
 * @param {Function} [options.log] - async logging function
 * @param {boolean} [options.verbose=false]
 * @param {Function} [options.execFile] - injected gh runner (for testing)
 * @param {boolean} [options.enabled=true] - master switch
 * @returns {{ uploadImage: Function, ensureMediaRef: Function, enabled: boolean, mediaRef: string, _state: Object }}
 */
export const createImageUploader = (options = {}) => {
  const { owner, repo, prNumber, mediaRef = buildMediaRef({ prNumber, namespace: options.refNamespace }), log = async () => {}, verbose = false, execFile: execFileFn, enabled = true } = options;

  const runGhApi = execFileFn || execFileAsync;
  const mediaRefPath = refPathForApi(mediaRef);

  // Memoized ref-readiness promise and a per-session content-hash -> URL cache.
  let mediaRefReady = null;
  let currentCommitSha = null;
  let currentTreeSha = null;
  let currentTreePaths = new Set();
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

  const rememberTreePaths = async treeSha => {
    try {
      const tree = await ghJson(`repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`);
      currentTreePaths = new Set((Array.isArray(tree?.tree) ? tree.tree : []).filter(entry => entry?.type === 'blob' && typeof entry.path === 'string').map(entry => entry.path));
    } catch {
      currentTreePaths = new Set();
    }
  };

  const rememberCommit = async sha => {
    if (!sha) return false;
    const commit = await ghJson(`repos/${owner}/${repo}/git/commits/${sha}`);
    if (!commit?.sha || !commit?.tree?.sha) return false;
    currentCommitSha = commit.sha;
    currentTreeSha = commit.tree.sha;
    await rememberTreePaths(currentTreeSha);
    return true;
  };

  const fetchMediaRef = async () => {
    try {
      return await ghJson(`repos/${owner}/${repo}/git/ref/${mediaRefPath}`);
    } catch {
      return null;
    }
  };

  const refreshMediaRef = async () => {
    const ref = await fetchMediaRef();
    return !!(ref?.object?.sha && (await rememberCommit(ref.object.sha)));
  };

  /**
   * Ensure the custom media ref exists. Creates it once via the Git Data API
   * (blob -> tree -> parentless commit -> ref). Memoized; resolves to a boolean.
   * @returns {Promise<boolean>}
   */
  const ensureMediaRef = async () => {
    if (mediaRefReady) return mediaRefReady;
    mediaRefReady = (async () => {
      if (await refreshMediaRef()) return true;
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
          body: { message: 'chore: initialize hive-mind interactive media ref', tree: tree.sha, parents: [] },
        });
        await ghJson(`repos/${owner}/${repo}/git/refs`, {
          method: 'POST',
          body: { ref: mediaRef, sha: commit.sha },
        });
        currentCommitSha = commit.sha;
        currentTreeSha = tree.sha;
        currentTreePaths = new Set(['README.md']);
        if (verbose) await log(`🖼️ Interactive mode: created media ref '${mediaRef}'`, { verbose: true });
        return true;
      } catch (err) {
        // A concurrent run may have created it between our check and create.
        if (await refreshMediaRef()) return true;
        await log(`⚠️ Interactive mode: could not prepare media ref '${mediaRef}': ${err.message}`);
        return false;
      }
    })();
    return mediaRefReady;
  };

  const pathExistsAtCurrentCommit = async path => {
    return !!(currentCommitSha && currentTreePaths.has(path));
  };

  const existingUrl = async path => {
    if (await pathExistsAtCurrentCommit(path)) {
      return buildRawBlobUrl(owner, repo, currentCommitSha, path);
    }
    return null;
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

    const ready = await ensureMediaRef();
    if (!ready || !currentCommitSha || !currentTreeSha) return null;

    const ext = extensionForMediaType(mediaType);
    const short = hash.slice(0, 16);
    const prSeg = prNumber ? `pr-${sanitizeRefSegment(prNumber)}` : 'misc';
    const path = `media/${prSeg}/${short}.${ext}`;

    const alreadyUploaded = await existingUrl(path);
    if (alreadyUploaded) {
      uploadedByHash.set(hash, alreadyUploaded);
      return alreadyUploaded;
    }

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const parentSha = currentCommitSha;
        const blob = await ghJson(`repos/${owner}/${repo}/git/blobs`, {
          method: 'POST',
          body: { content: base64, encoding: 'base64' },
        });
        const tree = await ghJson(`repos/${owner}/${repo}/git/trees`, {
          method: 'POST',
          body: {
            base_tree: currentTreeSha,
            tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
          },
        });
        const commit = await ghJson(`repos/${owner}/${repo}/git/commits`, {
          method: 'POST',
          body: {
            message: `chore: add interactive media ${name || short}`,
            tree: tree.sha,
            parents: [parentSha],
          },
        });
        await ghJson(`repos/${owner}/${repo}/git/refs/${mediaRefPath}`, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false },
        });

        currentCommitSha = commit.sha;
        currentTreeSha = tree.sha;
        currentTreePaths.add(path);
        const url = buildRawBlobUrl(owner, repo, commit.sha, path);
        uploadedByHash.set(hash, url);
        if (verbose) await log(`🖼️ Interactive mode: uploaded image -> ${url}`, { verbose: true });
        return url;
      } catch (err) {
        lastError = err;
        // Most likely a concurrent non-fast-forward update. Refresh once and retry.
        if (attempt === 0 && (await refreshMediaRef())) {
          const existingAfterRefresh = await existingUrl(path);
          if (existingAfterRefresh) {
            uploadedByHash.set(hash, existingAfterRefresh);
            return existingAfterRefresh;
          }
          continue;
        }
      }
    }

    const existingAfterFailure = await existingUrl(path);
    if (existingAfterFailure) {
      uploadedByHash.set(hash, existingAfterFailure);
      return existingAfterFailure;
    }

    await log(`⚠️ Interactive mode: image upload failed (${path}): ${lastError?.message || 'unknown error'}`);
    return null;
  };

  return {
    uploadImage,
    ensureMediaRef,
    enabled,
    mediaRef,
    _state: {
      uploadedByHash,
      get currentCommitSha() {
        return currentCommitSha;
      },
      get currentTreeSha() {
        return currentTreeSha;
      },
      get currentTreePaths() {
        return currentTreePaths;
      },
    },
  };
};

export default {
  DEFAULT_MEDIA_REF_NAMESPACE,
  buildMediaRef,
  extensionForMediaType,
  extractImagePayload,
  isImageNode,
  buildRawBlobUrl,
  createImageUploader,
};
