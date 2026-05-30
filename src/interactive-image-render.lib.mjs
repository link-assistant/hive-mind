#!/usr/bin/env node
/**
 * Interactive Mode Image Rendering (Issue #1843)
 *
 * Bridges the raw image uploader (interactive-image-upload.lib.mjs) and the
 * Markdown formatter (interactive-mode.shared.lib.mjs) so interactive-mode.lib.mjs
 * can turn the base64 images Claude/Codex read or wrote into an inline
 * `### 🖼️ Images` section with a single call. Kept in its own module so the main
 * interactive-mode handler stays under the 1500-line file limit (issue #1730).
 *
 * @module interactive-image-render.lib.mjs
 * @experimental
 */

import { formatImageEmbeds } from './interactive-mode.shared.lib.mjs';
import { createImageUploader, extractImagePayload, isImageNode } from './interactive-image-upload.lib.mjs';

// Re-exported so the main handler can import its image helpers from one place.
export { extractImagePayload, isImageNode };

/**
 * Collect normalized image payloads from tool-result-like objects, de-duplicated
 * by base64 content. Scans arrays directly, an array `content` (Claude/MCP), and
 * the node itself (Claude Read `tool_use_result`). Enriches a missing
 * `originalSize` from a later sibling payload with the same bytes.
 *
 * @param {...*} sources - candidate nodes/containers to scan
 * @returns {Array<{ base64: string, mediaType?: string, originalSize?: number }>}
 */
export const collectImagePayloads = (...sources) => {
  const payloads = [];
  const seen = new Set();
  const add = node => {
    const payload = extractImagePayload(node);
    if (!payload) return;
    const key = payload.base64.slice(0, 64) + ':' + payload.base64.length;
    if (seen.has(key)) {
      // Enrich an already-collected payload with size metadata if we now have it.
      if (payload.originalSize) {
        const existing = payloads.find(p => p.base64.slice(0, 64) + ':' + p.base64.length === key);
        if (existing && !existing.originalSize) existing.originalSize = payload.originalSize;
      }
      return;
    }
    seen.add(key);
    payloads.push(payload);
  };
  const scan = source => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach(add);
    } else if (typeof source === 'object') {
      if (Array.isArray(source.content)) source.content.forEach(add);
      add(source);
    }
  };
  sources.forEach(scan);
  return payloads;
};

/**
 * Create an image renderer bound to a PR. Wraps an image uploader (built here, or
 * injected via `options.uploader` for tests) and produces the Markdown image
 * section for a set of tool-result sources. Upload failures / disabled uploads
 * degrade to a metadata note inside `formatImageEmbeds` rather than dumping base64.
 *
 * @param {Object} [options]
 * @param {Object} [options.uploader] - injected uploader (tests); otherwise built from the remaining options
 * @param {Object} [options.state] - handler state, used to label images by tool name
 * @param {Function} [options.log] - async logging function
 * @param {boolean} [options.verbose=false]
 * @param {string} [options.owner]
 * @param {string} [options.repo]
 * @param {number|string} [options.prNumber]
 * @param {string} [options.branch]
 * @param {Function} [options.execFile]
 * @param {boolean} [options.enabled=true]
 * @returns {{ uploader: Object, collect: Function, render: Function, toolLabel: Function, section: Function }}
 */
export const createImageRenderer = (options = {}) => {
  const { uploader: injectedUploader, state, log = async () => {}, verbose = false, owner, repo, prNumber, branch, execFile, enabled = true } = options;

  const uploader = injectedUploader !== undefined ? injectedUploader : createImageUploader({ owner, repo, prNumber, branch, log, verbose, execFile, enabled });

  /**
   * Upload normalized payloads and render the `### 🖼️ Images` Markdown section.
   * Always returns a string (empty when there are no images).
   * @param {Array<{ base64: string, mediaType?: string, originalSize?: number }>} payloads
   * @param {string} [label] - human label prefix for captions / commit messages
   * @returns {Promise<string>}
   */
  const render = async (payloads, label = 'image') => {
    if (!Array.isArray(payloads) || payloads.length === 0) return '';
    const rendered = [];
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      const name = payloads.length > 1 ? `${label} ${i + 1}` : label;
      let url = null;
      try {
        if (uploader && typeof uploader.uploadImage === 'function') {
          url = await uploader.uploadImage({ base64: payload.base64, mediaType: payload.mediaType, name });
        }
      } catch (err) {
        if (verbose) await log(`⚠️ Interactive mode: image upload threw: ${err.message}`, { verbose: true });
        url = null;
      }
      rendered.push({ url, mediaType: payload.mediaType, originalSize: payload.originalSize, name });
    }
    return formatImageEmbeds(rendered);
  };

  /**
   * A human label for image captions, derived from the tool name in the
   * pending-call / registry maps (e.g. "Read image"). Falls back to "image".
   * @param {string} toolUseId
   * @returns {string}
   */
  const toolLabel = toolUseId => {
    const name = state?.pendingToolCalls?.get(toolUseId)?.toolName || state?.toolUseRegistry?.get(toolUseId)?.toolName;
    return name ? `${name} image` : 'image';
  };

  /**
   * Convenience: collect images from `sources` and render them in one call.
   * @param {Array<*>} sources - array of candidate nodes/containers
   * @param {string} [label]
   * @returns {Promise<string>}
   */
  const section = async (sources, label) => render(collectImagePayloads(...(Array.isArray(sources) ? sources : [sources])), label);

  return { uploader, collect: collectImagePayloads, render, toolLabel, section };
};

export default {
  collectImagePayloads,
  createImageRenderer,
  extractImagePayload,
  isImageNode,
};
