/**
 * Recovery layer for GitHub URLs that "look valid" but are not.
 *
 * A URL pasted into a chat client rarely arrives byte-for-byte as it left the
 * address bar: messengers wrap it in punctuation, IMEs substitute full-width
 * punctuation, bidi and zero-width characters ride along invisibly, and users type
 * `/pulls/30` where they meant `/pull/30` — which github.com answers with HTTP 200
 * (the pull request *list* page), so the link preview looks perfectly healthy while
 * the number the user cared about is silently dropped.
 *
 * Every function here is pure. Repairs are conservative enough to be no-ops on a
 * well-formed URL, and each one is reported back to the caller, so the bot can say
 * what it actually interpreted instead of failing with "invalid URL".
 *
 * Scope note: the confusable-punctuation folding below is applied to the scheme and
 * host, and to path *separators* only. A `tree`/`blob` file path therefore keeps its
 * original bytes apart from its slashes — those URL types address no task in this
 * codebase, and corrupting a file name would be worse than failing to normalize one.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2194
 * @module github-url-recovery
 */

/** Canonical GitHub web host. */
const GITHUB_HOST = 'github.com';

/**
 * Characters that must never survive into a URL:
 *   - `\p{Cf}` — zero-width space/joiner, BOM, soft hyphen, bidi marks and embeddings
 *   - `\p{Cc}` — C0/C1 control characters (including tab, CR and LF)
 *   - `\p{Zl}`/`\p{Zp}` — line and paragraph separators
 *   - U+034F COMBINING GRAPHEME JOINER and U+FE00–U+FE0F variation selectors
 * They are removable rather than replaceable: they carry no addressing information.
 */
const INVISIBLE_CHARACTERS = /[\p{Cf}\p{Cc}\p{Zl}\p{Zp}\u034F\uFE00-\uFE0F]/gu;

/**
 * Unicode space separators other than U+0020. A URL can never contain one, so a
 * space that is not the plain ASCII space is always paste damage. The ASCII space
 * is deliberately left in place: it is how the caller still detects "this is two
 * words, not a URL".
 */
const EXOTIC_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/** Names for the characters we most often have to strip, for the diagnostics. */
const CHARACTER_NAMES = {
  0x0009: 'TAB',
  0x000a: 'LINE FEED',
  0x000d: 'CARRIAGE RETURN',
  0x00ad: 'SOFT HYPHEN',
  0x00a0: 'NO-BREAK SPACE',
  0x034f: 'COMBINING GRAPHEME JOINER',
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0x200e: 'LEFT-TO-RIGHT MARK',
  0x200f: 'RIGHT-TO-LEFT MARK',
  0x202a: 'LEFT-TO-RIGHT EMBEDDING',
  0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING',
  0x202d: 'LEFT-TO-RIGHT OVERRIDE',
  0x202e: 'RIGHT-TO-LEFT OVERRIDE',
  0x202f: 'NARROW NO-BREAK SPACE',
  0x2060: 'WORD JOINER',
  0x2066: 'LEFT-TO-RIGHT ISOLATE',
  0x2067: 'RIGHT-TO-LEFT ISOLATE',
  0x2068: 'FIRST STRONG ISOLATE',
  0x2069: 'POP DIRECTIONAL ISOLATE',
  0x3000: 'IDEOGRAPHIC SPACE',
  0xfe0f: 'VARIATION SELECTOR-16',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE (BOM)',
  0xff0e: 'FULLWIDTH FULL STOP',
  0xff0f: 'FULLWIDTH SOLIDUS',
  0xff1a: 'FULLWIDTH COLON',
  0x2044: 'FRACTION SLASH',
  0x2215: 'DIVISION SLASH',
};

/** Look-alike separators, mapped to the ASCII character they impersonate. */
const SEPARATOR_CONFUSABLES = new Map([
  ['／', '/'], // FULLWIDTH SOLIDUS
  ['⁄', '/'], // FRACTION SLASH
  ['∕', '/'], // DIVISION SLASH
  ['⧸', '/'], // BIG SOLIDUS
  ['：', ':'], // FULLWIDTH COLON
  ['﹕', ':'], // SMALL COLON
  ['︓', ':'], // PRESENTATION FORM FOR VERTICAL COLON
  ['∶', ':'], // RATIO
]);

/** Everything above, plus host punctuation that only makes sense before the path. */
const PREFIX_CONFUSABLES = new Map([
  ...SEPARATOR_CONFUSABLES,
  ['．', '.'], // FULLWIDTH FULL STOP
  ['＠', '@'], // FULLWIDTH COMMERCIAL AT
  ['－', '-'], // FULLWIDTH HYPHEN-MINUS
]);

/** Paired delimiters a messenger or a prose sentence may wrap a URL in. */
const WRAPPERS = new Map([
  ['<', '>'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['«', '»'], // « »
  ['“', '”'], // “ ”
  ['‘', '’'], // ‘ ’
]);

/** Sentence punctuation that can only be prose, never the end of a GitHub URL. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', '…']);

/** Closing delimiters that are stripped when the matching opener is absent. */
const UNBALANCED_CLOSERS = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
  ['>', '<'],
  ['»', '«'],
  ['”', '“'],
  ['’', '‘'],
]);

/**
 * What may legally stand in front of `github.com`: an optional scheme (with the
 * colon, or without it when at least two slashes follow — the `https//github.com`
 * typo), optional SSH user info, and one of the few host aliases that serve the
 * same site. Anything else — `gist.`, `raw.`, `evil.com/`, `notgithub.com` — must
 * NOT be rewritten into a github.com address.
 */
const HOST_PREFIX = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/{0,3}|[A-Za-z][A-Za-z0-9+.-]*\/{2,3}|\/{0,3})(?:[^/\s@]*@)?(www\.|m\.|api\.)?$/;

/** The first path segment must be able to be a GitHub login for the shorthand form. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/|$)/;

/** Any explicit `scheme://`, which means the input names its own host. */
const EXPLICIT_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** Alternate spellings of the two entity kinds we can act on. */
const ENTITY_KIND_ALIASES = new Map([
  ['issue', 'issues'],
  ['issues', 'issues'],
  ['pull', 'pull'],
  ['pulls', 'pulls'],
  ['pullrequest', 'pull'],
  ['pullrequests', 'pulls'],
  ['pull-request', 'pull'],
  ['pull-requests', 'pulls'],
  ['pull_request', 'pull'],
  ['pull_requests', 'pulls'],
  ['merge_requests', 'pulls'],
]);

/**
 * Repairs a user cannot see for themselves. These change *which* entity the URL
 * addresses, or undo damage that is invisible on screen, so the bot has to say out
 * loud what it did. The rest (a stripped bracket, an added `https://`) are obvious
 * from the URL itself and would only be noise.
 */
const NOTABLE_REPAIR_CODES = new Set(['invisible-characters-removed', 'confusables-normalized', 'entity-kind-corrected', 'entity-subpath-dropped', 'fullwidth-digits-normalized', 'duplicate-slashes-collapsed', 'api-url-converted']);

/** Rejection reasons, worded exactly as `parseGitHubUrl` has always worded them. */
export const REJECT_NOT_GITHUB = 'Not a GitHub URL';
export const REJECT_MALFORMED = 'Invalid GitHub URL format';

/** Single-character probes need their own non-global copies of the /g regexes. */
const INVISIBLE_CHARACTER = new RegExp(INVISIBLE_CHARACTERS.source, 'u');
const EXOTIC_SPACE = new RegExp(EXOTIC_SPACES.source, 'u');

/**
 * Describe every character in `text` that is invisible, exotic whitespace, or a
 * punctuation look-alike, so a log line or an error message can show the user *why*
 * a URL that looks correct on screen was not.
 *
 * @param {string} text
 * @returns {Array<{index: number, codePoint: number, escape: string, name: string}>}
 */
export function describeHiddenCharacters(text) {
  if (!text || typeof text !== 'string') return [];
  const found = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (!INVISIBLE_CHARACTER.test(character) && !EXOTIC_SPACE.test(character) && !PREFIX_CONFUSABLES.has(character)) continue;
    const codePoint = character.codePointAt(0);
    const escape = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    found.push({ index, codePoint, escape, name: CHARACTER_NAMES[codePoint] || escape });
  }
  return found;
}

/**
 * Render `text` with every hidden character replaced by its `U+XXXX` escape, so the
 * damage survives a copy/paste into an issue report. Visible characters are kept.
 *
 * @param {string} text
 * @param {{maxLength?: number}} [options]
 * @returns {string}
 */
export function revealHiddenCharacters(text, { maxLength = 300 } = {}) {
  if (!text || typeof text !== 'string') return '';
  const hidden = new Map(describeHiddenCharacters(text).map(entry => [entry.index, entry.escape]));
  let revealed = '';
  for (let index = 0; index < text.length; index++) {
    revealed += hidden.has(index) ? `[${hidden.get(index)}]` : text[index];
  }
  return revealed.length > maxLength ? `${revealed.slice(0, maxLength)}… (truncated)` : revealed;
}

/** Replace look-alike punctuation with ASCII, preserving string length. */
function fold(text, table) {
  let folded = '';
  for (const character of text) folded += table.get(character) ?? character;
  return folded;
}

/** Record a repair once; a repeated code keeps its first (most specific) message. */
function addRepair(repairs, code, message) {
  if (repairs.some(repair => repair.code === code)) return;
  repairs.push({ code, message, notable: NOTABLE_REPAIR_CODES.has(code) });
}

/** Strip paired wrappers and prose punctuation that a messenger glued to the URL. */
function stripDecoration(text, repairs) {
  let current = text;
  let changed = true;
  while (changed && current.length > 1) {
    changed = false;
    // [label](url) — a Markdown link pasted whole.
    const markdownLink = current.match(/^\[[^\]]*\]\((.+)\)$/);
    if (markdownLink) {
      current = markdownLink[1].trim();
      addRepair(repairs, 'markdown-link-unwrapped', 'unwrapped a Markdown link');
      changed = true;
      continue;
    }
    if (WRAPPERS.get(current[0]) === current[current.length - 1]) {
      current = current.slice(1, -1).trim();
      addRepair(repairs, 'wrapper-stripped', 'removed the surrounding brackets or quotes');
      changed = true;
      continue;
    }
    const last = current[current.length - 1];
    if (TRAILING_PUNCTUATION.has(last)) {
      current = current.slice(0, -1);
      addRepair(repairs, 'trailing-punctuation-stripped', `removed the trailing "${last}"`);
      changed = true;
      continue;
    }
    const opener = UNBALANCED_CLOSERS.get(last);
    if (opener && !current.includes(opener)) {
      current = current.slice(0, -1);
      addRepair(repairs, 'trailing-punctuation-stripped', `removed the unmatched "${last}"`);
      changed = true;
    }
  }
  return current;
}

/** Remove invisible characters and exotic spaces, reporting what was dropped. */
function stripHiddenCharacters(text, repairs) {
  const cleaned = text.replace(INVISIBLE_CHARACTERS, '').replace(EXOTIC_SPACES, ' ');
  if (cleaned === text) return text;
  const names = [...new Set(describeHiddenCharacters(text).map(entry => entry.name))].slice(0, 4).join(', ');
  addRepair(repairs, 'invisible-characters-removed', `removed invisible character(s)${names ? `: ${names}` : ''}`);
  return cleaned;
}

/**
 * Rewrite the scheme/host prefix to the canonical `https://github.com`.
 *
 * @returns {{text: string}|{rejection: string}|null} `null` when the input carries
 *   no `github.com` at all, leaving the caller to consider the shorthand form.
 */
function normalizeHost(text, repairs) {
  const folded = fold(text, PREFIX_CONFUSABLES);
  const hostIndex = folded.toLowerCase().indexOf(GITHUB_HOST);
  if (hostIndex === -1) return null;

  const hostEnd = hostIndex + GITHUB_HOST.length;
  const prefix = folded.slice(0, hostIndex);
  const prefixMatch = prefix.match(HOST_PREFIX);
  if (!prefixMatch) return { rejection: REJECT_NOT_GITHUB };

  // Only the separators of the remainder are folded — see the module note.
  let after = fold(text.slice(hostEnd, hostEnd + 1), SEPARATOR_CONFUSABLES) + text.slice(hostEnd + 1);
  if (after !== '' && !/^[/:?#]/.test(after)) return { rejection: REJECT_NOT_GITHUB };

  const port = after.match(/^:(\d+)(.*)$/s);
  if (port) after = port[2];
  const rest = after.replace(/^:+/, '/');

  const alias = (prefixMatch[1] || '').toLowerCase();
  let path = rest;
  if (alias === 'api.') {
    // https://api.github.com/repos/{owner}/{repo}/{issues|pulls}/{number}
    const apiPath = rest.match(/^\/repos\/([^/\s]+\/[^/\s]+(?:\/.*)?)$/s);
    if (!apiPath) return { rejection: REJECT_NOT_GITHUB };
    path = `/${apiPath[1]}`;
    addRepair(repairs, 'api-url-converted', 'read the api.github.com address as its web address');
  } else if (alias) {
    addRepair(repairs, 'host-normalized', `normalized the "${alias}${GITHUB_HOST}" host to ${GITHUB_HOST}`);
  }
  if (prefix.includes('@')) addRepair(repairs, 'ssh-url-converted', 'read the SSH/git remote address as its web address');
  if (folded.slice(0, hostEnd) !== text.slice(0, hostEnd)) addRepair(repairs, 'confusables-normalized', 'replaced look-alike punctuation with ASCII');
  if (!/^https:\/\/github\.com(?:[/?#]|$)/.test(text)) addRepair(repairs, 'scheme-normalized', 'normalized the address to https://github.com');

  return { text: `https://${GITHUB_HOST}${path === '' || /^[/?#]/.test(path) ? path : `/${path}`}` };
}

/** Convert full-width digits (`３０`) to ASCII; returns null when not all digits. */
function toAsciiDigits(segment) {
  if (!/^[０-９]+$/.test(segment)) return null;
  return segment.replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 0x30));
}

/** Collapse repeated slashes in the path and drop a `.git` suffix on the repo. */
function normalizePathShape(text, repairs) {
  const match = text.match(/^(https:\/\/github\.com)([\s\S]*)$/);
  if (!match) return text;
  const pathAndRest = match[2];
  const boundary = pathAndRest.search(/[?#]/);
  const path = boundary === -1 ? pathAndRest : pathAndRest.slice(0, boundary);
  const suffix = boundary === -1 ? '' : pathAndRest.slice(boundary);

  let repaired = path.replace(/\/{2,}/g, '/');
  if (repaired !== path) addRepair(repairs, 'duplicate-slashes-collapsed', 'collapsed repeated slashes');

  const segments = repaired.split('/').filter(Boolean);
  let rebuild = false;
  if (segments.length >= 2 && /\.git$/i.test(segments[1])) {
    segments[1] = segments[1].replace(/\.git$/i, '');
    rebuild = true;
    addRepair(repairs, 'git-suffix-removed', 'removed the ".git" suffix from the repository name');
  }
  // Full-width digits have to be folded here, before `new URL()` percent-encodes
  // them out of recognition. Only the entity number is touched, never a file name.
  if (segments.length >= 4 && ENTITY_KIND_ALIASES.has(segments[2].toLowerCase())) {
    const asciiNumber = toAsciiDigits(segments[3]);
    if (asciiNumber) {
      segments[3] = asciiNumber;
      rebuild = true;
      addRepair(repairs, 'fullwidth-digits-normalized', 'converted full-width digits to ASCII');
    }
  }
  if (rebuild) repaired = `/${segments.join('/')}`;
  return `https://${GITHUB_HOST}${repaired}${suffix}`;
}

/**
 * Repair the textual form of a GitHub URL before it is parsed.
 *
 * @param {string} raw - The URL exactly as the user supplied it.
 * @returns {{text: string, repairs: Array<{code: string, message: string, notable: boolean}>, rejection?: string}}
 *   `text` is the repaired URL (identical to the trimmed input when nothing needed
 *   fixing), `repairs` lists what changed, and `rejection` is set when the input
 *   names a host that must not be rewritten.
 */
export function repairGitHubUrlText(raw) {
  const repairs = [];
  if (!raw || typeof raw !== 'string') return { text: '', repairs };

  let text = stripHiddenCharacters(raw.trim(), repairs).trim();
  text = stripDecoration(text, repairs);
  if (text === '') return { text, repairs, rejection: REJECT_MALFORMED };

  const host = normalizeHost(text, repairs);
  if (host?.rejection) return { text, repairs, rejection: host.rejection };
  if (host) return { text: normalizePathShape(host.text, repairs), repairs };

  // No github.com anywhere. An input that names its own scheme names its own host
  // too, so it is handed to the parser untouched and rejected there — this is what
  // keeps `https://gitlab.com/owner/repo` from being rewritten into a GitHub URL.
  if (EXPLICIT_SCHEME.test(text)) return { text, repairs };
  if (!GITHUB_LOGIN.test(text)) return { text, repairs, rejection: REJECT_MALFORMED };
  addRepair(repairs, 'scheme-normalized', `read the shorthand as a ${GITHUB_HOST} path`);
  return { text: normalizePathShape(`https://${GITHUB_HOST}/${text.replace(/^\/+/, '')}`, repairs), repairs };
}

/**
 * Repair the `owner/repo/kind/number` shape of an already-split path.
 *
 * This is where the reported failure is fixed: `/owner/repo/pulls/30` carries every
 * byte needed to address pull request 30, so it is restored to `/owner/repo/pull/30`
 * instead of being reported as "the pull requests list page".
 *
 * @param {string[]} parts - Path segments, with the empty ones already removed.
 * @returns {{parts: string[], repairs: Array<{code: string, message: string, notable: boolean}>}}
 */
export function repairGitHubPathParts(parts) {
  const repairs = [];
  if (!Array.isArray(parts) || parts.length < 3) return { parts, repairs };

  const repaired = [...parts];
  const rawKind = repaired[2];
  const kind = ENTITY_KIND_ALIASES.get(rawKind.toLowerCase());
  if (!kind) return { parts: repaired, repairs };

  const asciiNumber = repaired.length > 3 ? toAsciiDigits(repaired[3]) : null;
  if (asciiNumber) {
    repaired[3] = asciiNumber;
    addRepair(repairs, 'fullwidth-digits-normalized', 'converted full-width digits to ASCII');
  }
  const hasNumber = repaired.length > 3 && /^\d+$/.test(repaired[3]);

  // `/pulls/30` addresses pull request 30; a bare `/pull` addresses the list. Any
  // other `/pull/<something>` (`/pull/new/branch`) is left exactly as it was.
  let canonicalKind = kind;
  if (kind === 'pulls' && hasNumber) canonicalKind = 'pull';
  if (kind === 'pull' && repaired.length === 3) canonicalKind = 'pulls';

  if (canonicalKind !== rawKind) {
    repaired[2] = canonicalKind;
    const isReportedCase = canonicalKind === 'pull' && rawKind.toLowerCase() === 'pulls';
    addRepair(repairs, 'entity-kind-corrected', isReportedCase ? `"/${rawKind}/${repaired[3]}" is the pull request list page — read it as "/pull/${repaired[3]}"` : `corrected the path segment "${rawKind}" to "${canonicalKind}"`);
  }

  // A tab suffix (`/files`, `/commits`, `/checks`, …) still addresses the same entity.
  if (hasNumber && repaired.length > 4 && (canonicalKind === 'pull' || canonicalKind === 'issues')) {
    const dropped = repaired.slice(4).join('/');
    repaired.length = 4;
    addRepair(repairs, 'entity-subpath-dropped', `ignored the "/${dropped}" tab and used the ${canonicalKind === 'pull' ? 'pull request' : 'issue'} itself`);
  }
  return { parts: repaired, repairs };
}

/**
 * Render a repair list as one human-readable sentence fragment.
 *
 * @param {Array<{message: string}>} repairs
 * @param {{notableOnly?: boolean}} [options]
 * @returns {string} Empty string when there is nothing worth saying.
 */
export function formatUrlRepairs(repairs, { notableOnly = false } = {}) {
  if (!Array.isArray(repairs) || repairs.length === 0) return '';
  const selected = notableOnly ? repairs.filter(repair => repair.notable) : repairs;
  return selected.map(repair => repair.message).join('; ');
}

/** True when at least one repair changed something the user could not see. */
export function hasNotableRepair(repairs) {
  return Array.isArray(repairs) && repairs.some(repair => repair.notable);
}

/**
 * Verbose-only trace of one recovery step.
 *
 * `parseGitHubUrl` is synchronous and cannot await the project logger, but the
 * stdio interceptor in `lib.mjs` mirrors console output into the session log, so a
 * `--verbose` run still ends up with the codepoint-level record that issue #2194
 * asked for ("add debug output and verbose mode … that will allow us to find root
 * cause on next iteration").
 *
 * @param {string} stage
 * @param {Object} details
 */
export function traceUrlRecovery(stage, details) {
  if (!globalThis.verboseMode) return;
  try {
    console.error(`[url-recovery] ${stage} ${JSON.stringify(details)}`);
  } catch {
    console.error(`[url-recovery] ${stage} (details could not be serialized)`);
  }
}

export default {
  describeHiddenCharacters,
  formatUrlRepairs,
  hasNotableRepair,
  repairGitHubPathParts,
  repairGitHubUrlText,
  revealHiddenCharacters,
  traceUrlRecovery,
};
