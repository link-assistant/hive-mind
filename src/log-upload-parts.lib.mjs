/**
 * Issue #2296: a log larger than gh-upload-log's repository chunk size is split
 * into `<name>.part-00.log.txt`, `<name>.part-01.log.txt`, … and the comment
 * used to link only the folder holding them, so a reader had to guess which of
 * several 100 MB parts held the failure. These helpers resolve a link for every
 * part and locate the part that contains the failure.
 *
 * gh-upload-log splits with `split -b 100m`, so part N holds bytes
 * [N * 100 MiB, (N + 1) * 100 MiB) of the uploaded (sanitized) file, which lets
 * the failing part be found from a byte offset in that same file.
 */
import fs from 'node:fs';

export const LOG_UPLOAD_PART_SIZE_BYTES = 100 * 1024 * 1024;
const PART_NAME_PATTERN = /\.part-(\d+)(?:\.[^/]*)?$/u;
const SEARCH_BLOCK_BYTES = 1024 * 1024;

/** Split a repository tree URL (`https://github.com/o/r/tree/main/a/b`) into its parts. */
export const parseRepositoryTreeUrl = url => {
  const match = String(url || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/u);
  if (!match) return null;
  const [, owner, repo, branch = 'main', treePath = ''] = match;
  return { owner, repo, branch, treePath };
};

/**
 * Keep the `.part-NN` files of a folder listing, ordered by part number.
 * @param {Array<{name: string, html_url?: string, download_url?: string, size?: number}>} entries
 * @returns {Array<{index: number, name: string, url: string|null, size: number|null}>}
 */
export const selectLogParts = entries =>
  (Array.isArray(entries) ? entries : [])
    .map(entry => ({ entry, match: String(entry?.name || '').match(PART_NAME_PATTERN) }))
    .filter(({ match }) => match)
    .map(({ entry, match }) => ({ index: Number(match[1]), name: entry.name, url: entry.html_url || null, size: Number.isFinite(entry.size) ? entry.size : null }))
    .sort((a, b) => a.index - b.index);

/**
 * List the parts of a multi-part repository upload.
 * @param {Object} params
 * @param {string} params.url tree URL printed by gh-upload-log
 * @param {(apiPath: string) => Promise<{code: number, stdout: string}>} params.ghApi runs `gh api <apiPath>`
 */
export const listRepositoryLogParts = async ({ url, ghApi }) => {
  const tree = parseRepositoryTreeUrl(url);
  if (!tree) return [];
  const apiPath = `repos/${tree.owner}/${tree.repo}/contents${tree.treePath ? `/${tree.treePath}` : ''}?ref=${tree.branch}`;
  const result = await ghApi(apiPath);
  if (result?.code !== 0) return [];
  try {
    return selectLogParts(JSON.parse(String(result.stdout)));
  } catch {
    return [];
  }
};

/** First non-empty line of an error message, trimmed to something likely to appear verbatim in the log. */
export const buildFailureNeedles = messages => {
  const needles = [];
  for (const message of Array.isArray(messages) ? messages : [messages]) {
    const line = String(message || '')
      .split('\n')
      .map(part => part.trim())
      .find(Boolean);
    if (line && line.length >= 8) needles.push(line.slice(0, 120));
  }
  return [...new Set(needles)];
};

/**
 * Byte offset of the last occurrence of any needle in a file, read in bounded
 * blocks (the file can be several hundred MB). Returns -1 when none is found.
 */
export const findLastOccurrenceOffset = async ({ file, needles, fsImpl = fs.promises, blockBytes = SEARCH_BLOCK_BYTES }) => {
  const patterns = (needles || []).filter(Boolean).map(needle => Buffer.from(needle, 'utf8'));
  if (patterns.length === 0) return -1;
  const overlap = Math.max(...patterns.map(pattern => pattern.length)) - 1;
  const handle = await fsImpl.open(file, 'r');
  try {
    const { size } = await handle.stat();
    let end = size;
    while (end > 0) {
      const start = Math.max(0, end - blockBytes);
      const readEnd = Math.min(size, end + overlap);
      const buffer = Buffer.alloc(readEnd - start);
      await handle.read(buffer, 0, buffer.length, start);
      let best = -1;
      for (const pattern of patterns) {
        const at = buffer.lastIndexOf(pattern);
        if (at > best) best = at;
      }
      if (best >= 0) return start + best;
      end = start;
    }
    return -1;
  } finally {
    await handle.close();
  }
};

/** Part index holding byte `offset`, clamped to the parts that exist. */
export const partIndexForOffset = ({ offset, partCount, partSize = LOG_UPLOAD_PART_SIZE_BYTES }) => {
  if (!(partCount > 0) || !(offset >= 0)) return null;
  return Math.min(partCount - 1, Math.floor(offset / partSize));
};

/**
 * Markdown bullet list with one link per part. The part holding the failure is
 * named; when the failure text was not found the last part is marked as where
 * the log ends, since solve logs the failure last.
 */
export const formatLogPartLinks = ({ parts, failurePartIndex = null, failureLocated = false, fallbackUrl = null }) => {
  if (!Array.isArray(parts) || parts.length < 2) return '';
  const lines = parts.map((part, position) => {
    const label = `Part ${position + 1} of ${parts.length}`;
    const link = part.url ? `[${label}: \`${part.name}\`](${part.url})` : `${label}: \`${part.name}\``;
    let note = '';
    if (failurePartIndex === position) note = failureLocated ? ' — ⚠️ **contains the failure**' : ' — end of the log (the failure is reported last)';
    return `- ${link}${note}`;
  });
  if (fallbackUrl) lines.push(`- [Folder with all parts](${fallbackUrl})`);
  return lines.join('\n');
};

/**
 * Resolve the parts of a multi-part upload and which one holds the failure.
 * @returns {Promise<{parts: Array, failurePartIndex: number|null, failureLocated: boolean}>}
 */
export const describeUploadedLogParts = async ({ url, uploadedFile, failureMessages = [], ghApi, fsImpl = fs.promises, partSize = LOG_UPLOAD_PART_SIZE_BYTES }) => {
  const parts = await listRepositoryLogParts({ url, ghApi });
  if (parts.length < 2) return { parts, failurePartIndex: null, failureLocated: false };
  const needles = buildFailureNeedles(failureMessages);
  if (needles.length === 0) return { parts, failurePartIndex: null, failureLocated: false };
  let offset;
  try {
    offset = await findLastOccurrenceOffset({ file: uploadedFile, needles, fsImpl });
  } catch {
    offset = -1;
  }
  if (offset < 0) return { parts, failurePartIndex: parts.length - 1, failureLocated: false };
  return { parts, failurePartIndex: partIndexForOffset({ offset, partCount: parts.length, partSize }), failureLocated: true };
};
