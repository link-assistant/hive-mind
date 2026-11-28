/**
 * Indented Links Notation (LiNo) codec for the bot instance state (issue #4143).
 *
 * The state is a "string tree": a string, an object (ordered keys) or an
 * array of strings. Empty containers and empty arrays are omitted, so the
 * caller's schema supplies defaults. The text form keeps parentheses to a
 * minimum, as the issue asks:
 *
 *   hive_mind_state:
 *     intake:
 *       state draining
 *     tasks:
 *       q-1:
 *         url "https://github.com/owner/repo/issues/1"
 *         args:
 *           --model
 *           opus
 *
 * links-notation parses `key:` plus indented children into `{id: key,
 * values}`, `k v` into `{id: null, values: [k, v]}` and a lone word into a
 * leaf. A container whose children are all leaves is an array; otherwise it is
 * an object. Raw words cannot hold spaces, quotes, parentheses or `:`, so other
 * values are quoted with a quote character they do not contain. A doubled
 * quote at the start of a value opens a multi-quote string (`"""…`), so values
 * that contain all three quote characters fall back to `~b64_<base64url>`, the
 * same escape the link-cli store uses. The empty string uses it too, and a word
 * starting with `#` is quoted: links-notation 0.31.8 read `a ""` and a later
 * `b ""` as one string and dropped `#x` as a comment (links-notation#443 and
 * #444, fixed in 0.32.0). The encoding is kept so that readers on older
 * links-notation, such as host tools that parse the mounted `.lino` file, read
 * the same values; 0.32.0 reads both this form and its own `~1{…}` literals.
 * Every formatted document is parsed back and compared before it is written.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4143
 */

export const LINO_STATE_ROOT = 'hive_mind_state';
export const B64_PREFIX = '~b64_';
const COMPOUND_LIST = '~lino_items';

const RAW_WORD = /^[^\s"'`():]+$/;
const UNSAFE_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f\r]/; // eslint-disable-line no-control-regex
const QUOTES = ['"', "'", '`'];

export const encodeB64 = value => `${B64_PREFIX}${Buffer.from(value, 'utf8').toString('base64url')}`;
export const decodeB64 = value => (typeof value === 'string' && value.startsWith(B64_PREFIX) ? Buffer.from(value.slice(B64_PREFIX.length), 'base64url').toString('utf8') : value);

/** Quote one scalar so links-notation reads it back unchanged. */
export function quoteLinoScalar(value) {
  const text = String(value);
  // `""` and `''` pair with the next empty string as one escaped quote run.
  if (text === '' || text.startsWith(B64_PREFIX) || UNSAFE_CHARS.test(text)) return encodeB64(text);
  // A word starting with `#` is a comment.
  if (RAW_WORD.test(text) && !text.startsWith('#')) return text;
  const quote = QUOTES.find(q => !text.includes(q));
  if (quote) return `${quote}${text}${quote}`;
  return encodeB64(text);
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function isEmptyTree(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).every(key => isEmptyTree(value[key]));
  return false;
}

/** Drop empty containers and nullish values, stringify scalars. */
export function normalizeStringTree(value) {
  if (isEmptyTree(value)) return undefined;
  if (Array.isArray(value)) {
    const items = value.map(normalizeStringTree).filter(item => item !== undefined);
    return items.length ? items : undefined;
  }
  if (isPlainObject(value)) {
    const result = Object.fromEntries(
      Object.entries(value)
        .map(([key, child]) => [key, normalizeStringTree(child)])
        .filter(([, child]) => child !== undefined)
    );
    return Object.keys(result).length ? result : undefined;
  }
  return String(value);
}

function formatNode(lines, key, value, depth) {
  const indent = '  '.repeat(depth);
  const quotedKey = key === COMPOUND_LIST ? encodeB64(key) : quoteLinoScalar(key);
  if (Array.isArray(value)) {
    lines.push(`${indent}${quotedKey}:`);
    if (value.every(item => typeof item === 'string')) {
      for (const item of value) lines.push(`${indent}  ${quoteLinoScalar(item)}`);
    } else {
      lines.push(`${indent}  ${COMPOUND_LIST}:`);
      value.forEach((item, index) => formatNode(lines, String(index), item, depth + 2));
    }
  } else if (isPlainObject(value)) {
    lines.push(`${indent}${quotedKey}:`);
    for (const [childKey, child] of Object.entries(value)) formatNode(lines, childKey, child, depth + 1);
  } else {
    lines.push(`${indent}${quotedKey} ${quoteLinoScalar(value)}`);
  }
}

/** Format a string tree under `rootKey` without verifying it. */
export function formatLinoTree(tree, rootKey = LINO_STATE_ROOT) {
  const normalized = normalizeStringTree(tree) ?? {};
  if (!isPlainObject(normalized)) throw new TypeError('The state tree root must be an object');
  const lines = [`${quoteLinoScalar(rootKey)}:`];
  for (const [key, value] of Object.entries(normalized)) formatNode(lines, key, value, 1);
  return `${lines.join('\n')}\n`;
}

let parserPromise = null;

/** Load the links-notation parser the same way `lino.lib.mjs` does. */
export async function loadLinoParser() {
  parserPromise ??= (async () => {
    const { ensureUseM } = await import('./use-m-bootstrap.lib.mjs');
    if (typeof globalThis.use === 'undefined') await ensureUseM();
    const { useWithRetry } = await import('./use-with-retry.lib.mjs');
    const linoModule = await useWithRetry(globalThis.use, 'links-notation');
    const Parser = linoModule.Parser || linoModule.default?.Parser;
    return new Parser();
  })().catch(error => {
    parserPromise = null;
    throw error;
  });
  return parserPromise;
}

const isLeaf = link => link && (!link.values || link.values.length === 0);
const leafText = link => decodeB64(String(link.id ?? ''));

function linkToTree(link) {
  const children = link.values || [];
  if (children.every(isLeaf)) return children.map(leafText);
  if (children.length === 1 && children[0].id === COMPOUND_LIST) {
    const entries = Object.entries(linkToTree(children[0]));
    if (!entries.length || entries.some(([key], index) => key !== String(index))) throw new Error('Invalid LiNo list item index');
    return entries.map(([, value]) => value);
  }
  const result = new Map();
  for (const child of children) {
    if (child.id === null || child.id === undefined) {
      if (child.values?.length !== 2 || !child.values.every(isLeaf)) throw new Error(`Unexpected LiNo pair with ${child.values?.length ?? 0} values`);
      result.set(leafText(child.values[0]), leafText(child.values[1]));
    } else if (isLeaf(child)) {
      throw new Error(`Unexpected bare value ${JSON.stringify(child.id)} next to keyed values`);
    } else {
      result.set(leafText({ id: child.id }), linkToTree(child));
    }
  }
  return Object.fromEntries(result);
}

/**
 * Parse an indented LiNo state document.
 * @returns {Promise<{rootKey: string, tree: object}>}
 */
export async function parseLinoTree(text, { parser } = {}) {
  const lino = parser || (await loadLinoParser());
  const links = lino.parse(text);
  if (!links?.length) return { rootKey: null, tree: {} };
  if (links.length !== 1) throw new Error(`Expected one root link, found ${links.length}`);
  const [root] = links;
  if (isLeaf(root)) return { rootKey: leafText(root), tree: {} };
  const tree = linkToTree(root);
  return { rootKey: decodeB64(String(root.id)), tree: Array.isArray(tree) && tree.length === 0 ? {} : tree };
}

/** Deep equality for string trees (key order is not significant). */
export function stringTreesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => stringTreesEqual(item, b[index]));
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && stringTreesEqual(a[key], b[key]));
}

/** Format and prove the document parses back to the same tree. */
export async function formatVerifiedLinoTree(tree, { rootKey = LINO_STATE_ROOT, parser } = {}) {
  const text = formatLinoTree(tree, rootKey);
  const expected = normalizeStringTree(tree) ?? {};
  const parsed = await parseLinoTree(text, { parser });
  if (parsed.rootKey !== rootKey || !stringTreesEqual(parsed.tree, expected)) throw new Error('The formatted LiNo state does not parse back to the same tree');
  return text;
}

export default { B64_PREFIX, LINO_STATE_ROOT, decodeB64, encodeB64, formatLinoTree, formatVerifiedLinoTree, loadLinoParser, normalizeStringTree, parseLinoTree, quoteLinoScalar, stringTreesEqual };
