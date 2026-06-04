#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { sanitizeUnicode } from './unicode-sanitization.lib.mjs';

export { sanitizeUnicode };

export const CONFIG = {
  MIN_COMMENT_INTERVAL: 5000,
  MAX_LINES_BEFORE_TRUNCATION: 50,
  LINES_TO_KEEP_START: 20,
  LINES_TO_KEEP_END: 20,
  MAX_JSON_DEPTH: 10,
};

export const execFileAsync = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const { input, maxBuffer = 1024 * 1024, ...spawnOpts } = options;
    const child = spawn(command, args, { ...spawnOpts, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stdoutLen = 0;
    let stderrLen = 0;

    child.stdout.on('data', chunk => {
      const str = chunk.toString();
      stdoutLen += str.length;
      if (stdoutLen <= maxBuffer) stdout += str;
    });
    child.stderr.on('data', chunk => {
      const str = chunk.toString();
      stderrLen += str.length;
      if (stderrLen <= maxBuffer) stderr += str;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        const err = new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });

    if (input != null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });

export const truncateMiddle = (content, options = {}) => {
  const { maxLines = CONFIG.MAX_LINES_BEFORE_TRUNCATION, keepStart = CONFIG.LINES_TO_KEEP_START, keepEnd = CONFIG.LINES_TO_KEEP_END } = options;

  if (!content || typeof content !== 'string') return content || '';

  const lines = content.split('\n');
  if (lines.length <= maxLines) return sanitizeUnicode(content);

  const omitStart = keepStart + 1;
  const omitEnd = lines.length - keepEnd;
  return sanitizeUnicode([...lines.slice(0, keepStart), '', `... [${omitStart}-${omitEnd} lines are omitted] ...`, '', ...lines.slice(-keepEnd)].join('\n'));
};

export const safeJsonStringify = (obj, indent = 2) => {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return typeof value === 'string' ? sanitizeUnicode(value) : value;
    },
    indent
  );
};

export const createCollapsible = (summary, content, startOpen = false) => `<details${startOpen ? ' open' : ''}>
<summary>${summary}</summary>

${content}

</details>`;

export const createRawJsonSection = data => {
  const dataArray = Array.isArray(data) ? data : [data];
  const jsonContent = truncateMiddle(safeJsonStringify(dataArray, 2), {
    maxLines: 100,
    keepStart: 40,
    keepEnd: 40,
  });
  return createCollapsible('📄 Raw JSON', '```json\n' + jsonContent + '\n```');
};

/**
 * Issue #1843: Deep-clone an event object, replacing base64 image payloads with
 * a short `<image data: N base64 chars>` placeholder. Image base64 (Read tool,
 * Playwright screenshots, MCP image results) can be many kilobytes on a single
 * JSON line, which `truncateMiddle` cannot shrink — so without this the "Raw
 * JSON" sections would bloat every image-bearing comment toward the API limit.
 *
 * Redaction is targeted at the three known image carriers and leaves all other
 * fields intact for debugging:
 *  - `{ type:'image', source:{ data } }`  → source.data
 *  - `{ type:'image', data }`              → data (MCP shape)
 *  - `{ file:{ base64 } }`                 → file.base64 (Read tool_use_result)
 *
 * @param {*} data
 * @returns {*} a redacted clone (primitives returned as-is)
 */
export const redactImageData = data => {
  const seen = new WeakSet();
  const placeholder = len => `<image data: ${len} base64 chars>`;
  const walk = node => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      if (seen.has(node)) return '[Circular]';
      seen.add(node);
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      if (out.type === 'image' && out.source && typeof out.source === 'object' && typeof out.source.data === 'string') {
        out.source = { ...out.source, data: placeholder(out.source.data.length) };
      }
      if (out.type === 'image' && typeof out.data === 'string' && out.data.length > 64) {
        out.data = placeholder(out.data.length);
      }
      if (out.file && typeof out.file === 'object' && typeof out.file.base64 === 'string') {
        out.file = { ...out.file, base64: placeholder(out.file.base64.length) };
      }
      return out;
    }
    return node;
  };
  return walk(data);
};

/**
 * Issue #1843: Like createRawJsonSection, but strips base64 image data first.
 * @param {*} data
 * @returns {string}
 */
export const createRedactedRawJsonSection = data => createRawJsonSection(redactImageData(data));

/**
 * Format a byte count as a short human-readable string (e.g. "7.2 MB").
 * @param {number} bytes
 * @returns {string}
 */
export const formatBytes = bytes => {
  if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[i]}`;
};

/**
 * Sanitize Markdown image alt text so it can't break the `![alt](url)` syntax.
 * @param {string} text
 * @returns {string}
 */
const escapeAltText = text => (!text || typeof text !== 'string' ? 'image' : text.replace(/[[\]\n\r]/g, ' ').trim() || 'image');

/**
 * Issue #1843: Render an "🖼️ Images" Markdown section for images surfaced in a
 * tool result. Each entry that has a `url` is embedded inline with `![](url)`;
 * entries without a `url` (upload disabled or failed) degrade to a compact
 * metadata note instead of dumping base64.
 *
 * @param {Array<{ url?: string, mediaType?: string, originalSize?: number, name?: string }>} images
 * @returns {string} Markdown (empty string when there are no images)
 */
export const formatImageEmbeds = images => {
  if (!Array.isArray(images) || images.length === 0) return '';
  const blocks = images.map((img, i) => {
    const label = img.name || `image ${i + 1}`;
    const meta = [img.mediaType, formatBytes(img.originalSize)].filter(Boolean).join(', ');
    const caption = meta ? `${label} (${meta})` : label;
    if (img.url) {
      return `**${escapeMarkdown(caption)}**\n\n![${escapeAltText(label)}](${img.url})`;
    }
    return `**${escapeMarkdown(caption)}** — _image upload unavailable; not shown inline_`;
  });
  return `### 🖼️ Images\n\n${blocks.join('\n\n')}`;
};

export const formatDuration = ms => {
  if (!ms || ms < 0) return 'unknown';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

export const formatCost = cost => (typeof cost !== 'number' || isNaN(cost) ? 'unknown' : `$${cost.toFixed(2)}`);

export const escapeMarkdown = text => (!text || typeof text !== 'string' ? '' : text.replace(/```/g, '\\`\\`\\`'));

export const getToolIcon = toolName => {
  const icons = {
    Bash: '💻',
    Read: '📖',
    Write: '✏️',
    Edit: '📝',
    Glob: '🔍',
    Grep: '🔎',
    WebFetch: '🌐',
    WebSearch: '🔍',
    TodoWrite: '📋',
    ToolSearch: '🔍',
    Task: '🎯',
    Agent: '🤖',
    NotebookEdit: '📓',
    default: '🔧',
  };
  return icons[toolName] || icons.default;
};
