#!/usr/bin/env node
/**
 * Token sanitization utilities for log content.
 *
 * Architecture (issues #3739 and #3740):
 * 1. @link-foundation/sensitive-data-sanitizer is the detection and masking
 *    engine, through Hive Mind's policy in ./sensitive-data-sanitizer.lib.mjs
 *    (credentials only, known local tokens plain and encoded).
 * 2. Secretlint runs independently over the result, plain and decoded, as the
 *    second opinion; anything it still finds is masked and reported as a gap of
 *    the engine (rule ids only).
 * 3. Hive Mind's own integration rules stay here: the #1745 user-content
 *    carve-out, the #3922 40-character hex heuristic, statistics, and the
 *    fail-closed publication boundary with its residual scans.
 *
 * @module token-sanitization
 */

// Import shared utilities. The synchronous core (on the sensitive-data-sanitizer
// library) is also used directly by lib.mjs, so it must not depend on this
// asynchronous Secretlint layer.
import { log, isENOSPC } from './lib.mjs';
import { CREDENTIAL_SANITIZATION_ERROR_CODE, CREDENTIAL_SANITIZATION_FAILURE_MESSAGE, createCredentialStreamSanitizer, findCredentialResiduals, maskToken, sanitizeCredentialText } from './credential-sanitization-core.lib.mjs';
import { findDecodableRuns, findEncodedKnownTokenRuns, sanitizeEncodedCredentials } from './encoded-credential-detection.lib.mjs'; // issue #2156: credentials that only appear re-encoded
import { findCredentialFindings, loadSensitiveDataSanitizer } from './sensitive-data-sanitizer.lib.mjs'; // issues #3739, #3740: the library is the engine
import { reportError } from './sentry.lib.mjs';

export { createCredentialStreamSanitizer };

// Dynamic imports for runtime dependencies
const getFsModule = async () => (await import('fs')).promises;

// Lazy-loaded secretlint modules (initialized on first use)
let secretlintCore = null;
let secretlintConfig = null;
let githubCommandTokensCache = null;

// Issue #1745: process-wide counters for how many tokens were masked. The
// final-summary path (solve.mjs / hive.mjs) reads these to print a one-line
// "we masked N secrets — pass --dangerously-skip-output-sanitization to skip"
// note when N > 0. Counters are intentionally simple (numbers, not arrays of
// values) so we never accidentally retain raw tokens for any longer than the
// masking pass itself.
const sanitizationStats = {
  totalMasked: 0,
  knownTokenMasks: 0,
  patternMasks: 0,
  hexMasks: 0,
  excluded: 0,
};

/**
 * Read process-wide sanitization counters. Pure read; never mutates.
 * @returns {{totalMasked:number, knownTokenMasks:number, patternMasks:number, hexMasks:number, excluded:number}}
 */
export const getSanitizationStats = () => ({ ...sanitizationStats });

/**
 * Reset process-wide counters. Tests use this between cases. Production code
 * has no reason to reset mid-run.
 */
export const resetSanitizationStats = () => {
  sanitizationStats.totalMasked = 0;
  sanitizationStats.knownTokenMasks = 0;
  sanitizationStats.patternMasks = 0;
  sanitizationStats.hexMasks = 0;
  sanitizationStats.excluded = 0;
};

/**
 * Format a one-line operator-facing summary describing how many tokens were
 * masked during this run, plus the dangerously-skip note required by the
 * issue when the count is > 0. Returns an empty string if nothing was masked,
 * so the caller can simply check truthiness before logging.
 *
 * @param {Object} [stats] override stats (defaults to module counters)
 * @returns {string}
 */
export const formatSanitizationSummary = (stats = sanitizationStats) => {
  const { totalMasked = 0, knownTokenMasks = 0, patternMasks = 0, hexMasks = 0, excluded = 0 } = stats;
  if (totalMasked <= 0 && excluded <= 0) return '';
  const breakdown = [`known-local: ${knownTokenMasks}`, `pattern: ${patternMasks}`, `hex: ${hexMasks}`].join(', ');
  const lines = [`🔒 Output sanitization: masked ${totalMasked} token(s) (${breakdown}) before publishing.`];
  if (excluded > 0) {
    lines.push(`   ↳ left ${excluded} pre-existing token(s) untouched (user-provided content carve-out).`);
  }
  if (totalMasked > 0) {
    lines.push('   ↳ Pass --dangerously-skip-output-sanitization if this blocks your workflow (active local tokens stay masked unless --dangerously-skip-active-tokens-output-sanitization is also set).');
  }
  return lines.join('\n');
};

/**
 * Initialize secretlint modules lazily
 * @returns {Promise<boolean>} True if secretlint is available
 */
const initSecretlint = async () => {
  if (secretlintConfig !== null) {
    return secretlintConfig !== false;
  }

  try {
    const [core, preset, profiler] = await Promise.all([import('@secretlint/core'), import('@secretlint/secretlint-rule-preset-recommend'), import('@secretlint/profiler').catch(() => null)]);
    // Issue #2400: the profiler is enabled by default for library users. Every
    // lintSource call adds performance marks that its observer keeps forever
    // (~11 KB per call), so a long-running bot or solver grows without bound.
    // Upstream documents setEnabled(false) for library use (secretlint#1673).
    profiler?.secretLintProfiler?.setEnabled(false);

    secretlintCore = core;
    secretlintConfig = {
      rules: [
        {
          id: '@secretlint/secretlint-rule-preset-recommend',
          rule: preset.creator,
        },
      ],
    };

    return true;
  } catch (_error) {
    // Local diagnostics retain the library pass; publication stays blocked.
    if (global.verboseMode) {
      await log('  ⚠️  Secretlint is not available; publication boundaries will remain blocked.', { verbose: true });
    }
    secretlintConfig = false;
    return false;
  }
};

/**
 * Patterns that indicate a string is NOT a sensitive token (false positive patterns)
 * These are used to prevent masking legitimate identifiers
 */
const SAFE_TOKEN_PATTERNS = [
  // MCP tool names (Playwright, etc.)
  /^mcp__[a-z_]+$/i,
  // Browser/Playwright tool names
  /^browser_[a-z_]+$/i,
  // Common function/tool name patterns with underscores
  /^[a-z]+_[a-z]+_[a-z_]+$/i,
  // UUID patterns (not sensitive)
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
];

/**
 * Context patterns that indicate the surrounding text is NOT a sensitive context
 * These patterns help identify when a 40-char hex string is just a git commit hash
 */
const SAFE_CONTEXT_PATTERNS = [
  // Git commands containing commit hashes
  /\bgh\s+gist\s+view\b/i,
  /\bgit\s+(log|show|diff|cherry-pick|revert|checkout|reset)\b/i,
  /\bgit\s+commit\s+-m\b/i,
  // Commit SHA in common git output contexts
  /\bcommit\s+[a-f0-9]{7,40}\b/i,
  /\bSHA\s*:\s*[a-f0-9]{7,40}\b/i,
  // Git log output format
  /^commit\s+[a-f0-9]{40}/m,
  // Short commit hashes in various contexts
  /\b[a-f0-9]{7,40}\s+Author:/i,
];

// Issue #3740: credential formats are the engine's
// (@link-foundation/sensitive-data-sanitizer); see detectSecretsWithLibrary().

/**
 * Check if a token matches any safe pattern (not a sensitive token)
 * @param {string} token - The token to check
 * @returns {boolean} True if the token is safe and should NOT be masked
 */
export const isSafeToken = token => {
  if (!token) return false;
  return SAFE_TOKEN_PATTERNS.some(pattern => pattern.test(token));
};

/**
 * Check if a 40-char hex string appears in a safe context (like git commands)
 * @param {string} content - The full content to search
 * @param {string} hexString - The 40-char hex string found
 * @param {number} position - The position where the hex string was found
 * @returns {boolean} True if the hex string is in a safe context
 */
export const isHexInSafeContext = (content, hexString, position) => {
  // Get surrounding context (100 chars before and after)
  const contextStart = Math.max(0, position - 100);
  const contextEnd = Math.min(content.length, position + hexString.length + 100);
  const context = content.substring(contextStart, contextEnd);

  // Check if any safe context pattern matches
  return SAFE_CONTEXT_PATTERNS.some(pattern => pattern.test(context));
};

// Issue #3922: text right before a 40-char hex string that says it names a commit (a GitHub commit/tree URL,
// a git object id in gh/GitHub API JSON, `git rev-parse`). The hex scan never looked at these occurrences.
const COMMIT_EVIDENCE_PREFIX = /(?:\/(?:commit|commits|tree|blob)\/|"(?:oid|sha|headRefOid|baseRefOid|head_sha|base_sha|merge_commit_sha|commit_id|commitOid|tree_id)"\s*:\s*"|\bgit\s+rev-parse\s+[^\n]{0,60}\n)$/i;

/**
 * Issue #3922: whether ANY occurrence of a 40-char hex string identifies it as a commit hash. Masking
 * replaces every occurrence, so a `git rev-parse HEAD` line (`[STDOUT] <sha>`) also masked the SHA in every
 * `…/commit/<sha>` link (`commit/781…75a`). A secret never appears as a commit URL or object id.
 * @param {string} content - The full content to search
 * @param {string} hexString - The 40-char hex string
 * @returns {boolean} True if some occurrence is in a safe/commit context
 */
export const hexHasCommitEvidence = (content, hexString) => {
  if (!content || !hexString) return false;
  for (let position = content.indexOf(hexString); position !== -1; position = content.indexOf(hexString, position + hexString.length)) {
    if (COMMIT_EVIDENCE_PREFIX.test(content.slice(Math.max(0, position - 80), position))) return true;
    if (isHexInSafeContext(content, hexString, position)) return true;
  }
  return false;
};

/**
 * GitHub tokens stored in gh's hosts.yml (every host and account), read by the
 * library's knownSecretsFromGitHubConfig (issue #3740). It honors GH_CONFIG_DIR
 * and XDG_CONFIG_HOME. A missing file gives no tokens; an unreadable or
 * malformed one gives none either (the library fails closed with ERR_AUTH), and
 * the active token still comes from {@link getGitHubTokensFromCommand}.
 * @returns {Promise<string[]>} Array of tokens found
 */
export const getGitHubTokensFromFiles = async () => {
  try {
    return await loadSensitiveDataSanitizer().knownSecretsFromGitHubConfig();
  } catch (error) {
    if (global.verboseMode) reportError(error, { context: 'github_token_file_access', level: 'debug' });
    return [];
  }
};

/**
 * The active GitHub token, from `gh auth token` through the library's
 * knownSecretsFromGitHubAuth (issue #3740). It is found even when gh keeps it
 * in the system keyring, where hosts.yml has no token; the previous scan of
 * `gh auth status` found nothing there, because gh prints that token masked.
 * The command's output is never mirrored or logged (issue #2130). Cached for the
 * process.
 * @returns {Promise<string[]>} Array of tokens found
 */
export const getGitHubTokensFromCommand = async () => {
  if (!githubCommandTokensCache) {
    try {
      githubCommandTokensCache = await loadSensitiveDataSanitizer().knownSecretsFromGitHubAuth();
    } catch (error) {
      // gh is missing or not signed in.
      if (global.verboseMode) reportError(error, { context: 'github_token_gh_auth', level: 'debug' });
      githubCommandTokensCache = [];
    }
  }
  return [...githubCommandTokensCache];
};

/**
 * Use secretlint to detect secrets in content
 * @param {string} content - Content to scan
 * @returns {Promise<Array<{start: number, end: number, token: string, ruleId: string}>>} Array of detected secrets with rule info
 */
const detectSecretsWithSecretlint = async (content, options = {}) => {
  const secrets = [];

  const available = await initSecretlint();
  if (!available || !secretlintCore || !secretlintConfig) {
    if (options.required) {
      throw new Error('Secretlint scanner is unavailable.');
    }
    return secrets;
  }

  try {
    const result = await secretlintCore.lintSource({
      source: {
        filePath: '/virtual/content.txt',
        content: content,
        contentType: 'text',
      },
      options: {
        config: secretlintConfig,
        maskSecrets: false, // We need raw positions to mask ourselves
      },
    });

    for (const message of result.messages) {
      if (message.range && message.range.length === 2) {
        const [start, end] = message.range;
        const token = content.substring(start, end);
        // The synchronous core may already have sanitized the credential
        // portion of a larger structured value (for example a database DSN).
        // Do not let a broad Secretlint range erase the remaining safe context.
        if (token.includes('[REDACTED]') || /…/.test(token)) {
          continue;
        }
        secrets.push({
          start,
          end,
          token,
          ruleId: message.ruleId || 'unknown',
          source: 'secretlint',
        });
      }
    }
  } catch (error) {
    if (options.required) {
      throw new Error('Secretlint scanner failed.', { cause: error });
    }
    if (global.verboseMode) {
      await log('  ⚠️  Secretlint detection failed.', { verbose: true });
    }
  }

  return secrets;
};

/**
 * Detect credentials with the engine (@link-foundation/sensitive-data-sanitizer
 * through Hive Mind's policy). Issue #3740: this replaces Hive Mind's own list
 * of vendor patterns, which duplicated the library's rules.
 *
 * Findings that are already masked are not returned (the policy exempts them).
 *
 * @param {string} content - Content to scan
 * @returns {Array<{start: number, end: number, token: string, patternName: string, source: string}>}
 */
const detectSecretsWithLibrary = content => {
  const text = String(content ?? '');
  return findCredentialFindings(text).map(finding => ({
    start: finding.start,
    end: finding.end,
    token: text.slice(finding.start, finding.end),
    patternName: finding.rule,
    source: 'sensitive-data-sanitizer',
  }));
};

/**
 * @deprecated Kept for callers of the former custom-pattern detector; it is
 * the engine now. Use {@link detectSecretsWithLibrary}.
 */
const detectSecretsWithCustomPatterns = detectSecretsWithLibrary;

/**
 * Compare detection results of Secretlint and the engine
 * @param {Array} secretlintSecrets - Secrets detected by secretlint
 * @param {Array} customSecrets - Secrets detected by the engine ({@link detectSecretsWithLibrary})
 * @returns {Promise<{secretlintOnly: Array, customOnly: Array, both: Array}>}
 */
const compareDetectionResults = async (secretlintSecrets, customSecrets) => {
  const secretlintOnly = [];
  const customOnly = [];
  const both = [];

  // Create sets for easier comparison (normalize tokens)
  const secretlintTokens = new Map(secretlintSecrets.map(s => [s.token, s]));
  const customTokens = new Map(customSecrets.map(s => [s.token, s]));

  // Find secretlint-only detections (the engine missed these)
  for (const [token, secret] of secretlintTokens) {
    if (!customTokens.has(token)) {
      secretlintOnly.push(secret);
    } else {
      both.push({ ...secret, customPattern: customTokens.get(token).patternName });
    }
  }

  // Find custom-only detections (secretlint missed these)
  for (const [token, secret] of customTokens) {
    if (!secretlintTokens.has(token)) {
      customOnly.push(secret);
    }
  }

  return { secretlintOnly, customOnly, both };
};

/**
 * Run the synchronous core sanitizer without changing exact strings covered by
 * the legacy local-output exclusion carve-out. Publication callers never pass
 * exclusions and therefore cannot reach this compatibility behavior.
 */
const sanitizeCredentialTextPreservingExclusions = (input, excludedSet, options = {}) => {
  const text = String(input ?? '');
  if (excludedSet.size === 0) return sanitizeCredentialText(text, options);

  const excludedTokens = [...excludedSet].sort((a, b) => b.length - a.length);
  let output = '';
  let cursor = 0;

  while (cursor < text.length) {
    let nextIndex = -1;
    let nextToken = '';
    for (const token of excludedTokens) {
      const index = text.indexOf(token, cursor);
      if (index === -1) continue;
      if (nextIndex === -1 || index < nextIndex || (index === nextIndex && token.length > nextToken.length)) {
        nextIndex = index;
        nextToken = token;
      }
    }

    if (nextIndex === -1) {
      output += sanitizeCredentialText(text.slice(cursor), options);
      break;
    }

    output += sanitizeCredentialText(text.slice(cursor, nextIndex), options);
    output += nextToken;
    cursor = nextIndex + nextToken.length;
  }

  return output;
};

/**
 * Shortest known-local token value that is masked, and therefore verified.
 *
 * Issue #2397: the maskers skipped shorter values while the publication
 * verifier ({@link containsKnownToken}) did not, so a short non-secret value
 * such as `TELEGRAM_OWNER_CHAT_ID=123456789` blocked every log mentioning it.
 */
export const MIN_KNOWN_TOKEN_LENGTH = 12;

const isMaskableTokenValue = value => typeof value === 'string' && value.length >= MIN_KNOWN_TOKEN_LENGTH;

/**
 * Narrow a raw token list to the values worth searching for.
 *
 * @param {Array<string|{value: string}>} tokens
 * @param {Set<string>} [excludedSet] issue #1745 user-content carve-out
 * @returns {Array<string>}
 */
const usableTokenValues = (tokens, excludedSet) => [...new Set((tokens || []).map(t => (typeof t === 'string' ? t : t?.value)).filter(isMaskableTokenValue))].filter(value => !excludedSet?.has(value));

/**
 * Mask known-local token values wherever they appear, verbatim or encoded.
 *
 * Issue #2156: the leak was a `gho_` token the GHCR token endpoint echoed back
 * base64-encoded inside a JSON body. The engine's known-secret detection
 * decodes base64, hex, percent, escape and entity encodings (nested too), masks
 * the value inside the decoded payload and re-encodes it, so the payload keeps
 * its other fields and the mask keeps its first and last characters.
 *
 * @param {string} text
 * @param {Array<string>} values from {@link usableTokenValues}
 * @returns {{text: string, masked: number}} `masked` counts the values found verbatim (at least one when only encoded copies were masked)
 */
const maskKnownTokens = (text, values) => {
  if (values.length === 0) return { text, masked: 0 };
  const output = sanitizeCredentialText(text, { includeEnvironmentCredentials: false, knownTokens: values, knownOnly: true });
  if (output === text) return { text, masked: 0 };
  const verbatim = values.filter(value => text.includes(value)).length;
  return { text: output, masked: Math.max(verbatim, 1) };
};

/**
 * Mask encoded runs whose *decoded* payload Secretlint recognises.
 *
 * This is the redundancy the issue asks for, aimed at where it actually helps.
 * Secretlint is blind to encoding: its GitHub rule flags a bare `gho_…` but
 * reports nothing for the same token base64-encoded, and neither does any other
 * pattern scanner, because a pattern scanner matches the bytes it is given.
 * Adding a third scanner alongside the first two would therefore have changed
 * nothing about this incident. Decoding first and *then* asking both detectors
 * is what closes the gap, so the external rule set is applied to the decoded
 * payload exactly as the maintained core already is.
 *
 * The two detectors stay independent: this runs whether or not the core found
 * anything, so a credential format Secretlint knows and we do not is still
 * caught once it is decoded.
 *
 * @param {string} text
 * @param {Set<string>} [excludedSet] issue #1745 user-content carve-out
 * @returns {Promise<{text: string, masked: number, ruleIds: Array<string>}>}
 */
const maskEncodedSecretsWithSecretlint = async (text, excludedSet) => {
  const runs = findDecodableRuns(text);
  if (runs.length === 0) return { text, masked: 0, ruleIds: [] };

  // Each payload is scanned on its own rather than as one joined document: a
  // rule that matched across a join boundary would blame a run that is
  // innocent, and masking an innocent run destroys log content.
  const verdicts = await Promise.all(runs.map(run => detectSecretsWithSecretlint(run.decoded)));

  // Keyed by decoded content, because that is what the sync layer hands back
  // when it re-walks the same runs below. Two runs that decode identically are
  // masked identically, which is what we want.
  const maskedPayloads = new Map();
  const ruleIds = new Set();
  for (const [index, findings] of verdicts.entries()) {
    const usable = findings.filter(finding => !excludedSet?.has(finding.token));
    if (usable.length === 0) continue;
    const { decoded } = runs[index];

    // Mask inside the decoded payload so the surrounding structure survives.
    // Ranges are spliced from the end so earlier offsets stay valid.
    let payload = decoded;
    for (const finding of [...usable].sort((a, b) => b.start - a.start)) {
      if (payload.substring(finding.start, finding.end) !== finding.token) continue;
      payload = payload.substring(0, finding.start) + maskToken(finding.token) + payload.substring(finding.end);
      ruleIds.add(finding.ruleId);
    }
    if (payload === decoded) continue;
    maskedPayloads.set(decoded, payload);
  }

  if (maskedPayloads.size === 0) return { text, masked: 0, ruleIds: [] };

  // Re-encoding, round-trip verification and overlap merging are the sync
  // layer's job. Driving it with a lookup of payloads we have already masked
  // means the two paths cannot disagree about what a masked run looks like.
  const output = sanitizeEncodedCredentials(text, {
    sanitizePlaintext: decoded => maskedPayloads.get(decoded) ?? decoded,
  });

  return { text: output, masked: maskedPayloads.size, ruleIds: [...ruleIds] };
};

/**
 * Sanitize arbitrary outbound output by masking sensitive tokens while avoiding false positives.
 *
 * Known local tokens are masked first (verbatim and encoded), then the engine
 * (@link-foundation/sensitive-data-sanitizer with Hive Mind's policy) masks
 * every credential it detects. Secretlint then runs independently over the
 * result, plain and decoded; what it still finds is masked and, in verbose
 * mode, reported as a gap of the engine (rule ids only).
 *
 * @param {string} output - The output to sanitize
 * @param {Object} options - Optional configuration
 * @param {boolean} options.warnOnMismatch - Log warnings when detection approaches differ (default: true in verbose mode)
 * @param {boolean} options.skipOutputSanitization - Skip pattern-based output sanitization. Does not skip known active-token masking.
 * @param {boolean} options.skipActiveTokensOutputSanitization - Also skip known active-token masking. Dangerous; intended only for explicit debugging.
 * @param {Array<string>} options.excludeTokens - Issue #1745 carve-out: token VALUES that were already in user-provided content (issue body, non-bot comments, pre-existing code). These will be left untouched and counted in `excluded` stats so we don't shock users by mangling tokens they typed themselves.
 * @returns {Promise<string>} Sanitized output with tokens masked
 */
export const sanitizeOutput = async (output, options = {}) => {
  let sanitized = String(output ?? '');
  const { warnOnMismatch = global.verboseMode, skipOutputSanitization = false, skipActiveTokensOutputSanitization = false, excludeTokens = [] } = options;
  const excludedSet = new Set((excludeTokens || []).filter(t => typeof t === 'string' && t.length > 0));
  const isExcluded = token => excludedSet.has(token);

  // Statistics for the verbose summary
  const stats = {
    knownTokens: 0,
    secretlintDetections: 0,
    encodedSecretlintDetections: 0,
    encodedSecretlintRuleIds: [],
    engineDetections: 0,
    secretlintOnlyWarnings: [],
  };

  try {
    if (!skipActiveTokensOutputSanitization) {
      // Step 1: Get known tokens from files and commands
      const fileTokens = await getGitHubTokensFromFiles();
      const commandTokens = await getGitHubTokensFromCommand();
      // Issue #2397: also the env tokens, which sanitizeForPublication verifies;
      // a GITHUB_PAT that matched no vendor pattern blocked the log instead.
      const envTokens = getEnvironmentTokens().map(({ value }) => value);
      const allKnownTokens = [...new Set([...fileTokens, ...commandTokens, ...envTokens])];

      // Issue #1745: tokens the user typed themselves stay as they are.
      for (const token of allKnownTokens) {
        if (isMaskableTokenValue(token) && isExcluded(token)) sanitizationStats.excluded++;
      }

      // Mask known tokens first, verbatim and (issue #2156) encoded.
      const known = maskKnownTokens(sanitized, usableTokenValues(allKnownTokens, excludedSet));
      if (known.masked > 0) {
        sanitized = known.text;
        stats.knownTokens += known.masked;
        sanitizationStats.knownTokenMasks += known.masked;
        sanitizationStats.totalMasked += known.masked;
      }
    }

    if (skipOutputSanitization) {
      return sanitized;
    }

    // Step 2: the engine (@link-foundation/sensitive-data-sanitizer with Hive
    // Mind's policy), always, before the optional scanner.
    let engineMasks = 0;
    const beforeEngine = sanitized;
    sanitized = sanitizeCredentialTextPreservingExclusions(sanitized, excludedSet, {
      onFindings: count => {
        engineMasks += count;
      },
    });
    if (sanitized !== beforeEngine) {
      // Every masking event counts once in the operator-facing summary.
      const engineMaskCount = Math.max(engineMasks, 1);
      stats.engineDetections += engineMaskCount;
      sanitizationStats.patternMasks += engineMaskCount;
      sanitizationStats.totalMasked += engineMaskCount;
    }

    // Step 3: Secretlint, independently, over the engine's result. What it
    // still finds is a gap of the engine (or a #1745 carve-out); the engine is
    // asked again only then, to tell the two apart.
    const secretlintSecrets = await detectSecretsWithSecretlint(sanitized);
    const engineSecrets = secretlintSecrets.length > 0 ? detectSecretsWithLibrary(sanitized) : [];
    const { secretlintOnly } = await compareDetectionResults(
      secretlintSecrets.filter(secret => !isExcluded(secret.token)),
      engineSecrets
    );

    // Log warnings for secretlint-only detections (the engine should catch these)
    if (warnOnMismatch && secretlintOnly.length > 0) {
      stats.secretlintOnlyWarnings = secretlintOnly;
      await log(`  ⚠️  PATTERN GAP: Secretlint found ${secretlintOnly.length} secret(s) that @link-foundation/sensitive-data-sanitizer missed:`, { verbose: true });
      for (const secret of secretlintOnly) {
        // Rule identifiers are useful diagnostics; token previews are not.
        await log(`      • Rule: ${secret.ruleId}`, { verbose: true });
      }
      await log(`      Consider reporting these secret types at https://github.com/link-foundation/sensitive-data-sanitizer/issues.`, { verbose: true });
    }

    // Only Secretlint's own findings are masked here. The engine already ran
    // in Step 2 around the #1745 carve-out; its second look above is for the
    // gap report only. Masking its spans again would undo the carve-out, since
    // a `token: <value>` line context can cover an excluded value (#3739).
    const allSecrets = new Map();
    for (const secret of secretlintSecrets) {
      const key = `${secret.start}-${secret.end}`;
      if (!allSecrets.has(key)) allSecrets.set(key, secret);
    }
    stats.secretlintDetections += secretlintSecrets.length;

    // Apply all detections (from end to start to preserve positions)
    const sortedSecrets = [...allSecrets.values()].sort((a, b) => b.start - a.start);
    for (const secret of sortedSecrets) {
      const { start, end, token } = secret;
      // Verify the token is still in the content at the expected position
      const currentToken = sanitized.substring(start, end);
      if (currentToken === token) {
        if (isExcluded(token)) {
          sanitizationStats.excluded++;
          continue;
        }
        const masked = maskToken(token);
        sanitized = sanitized.substring(0, start) + masked + sanitized.substring(end);
        sanitizationStats.patternMasks++;
        sanitizationStats.totalMasked++;
      }
    }

    // Step 3b (issue #2156): everything above compares against the *surface*
    // text, so a credential that only ever appears encoded is invisible to it —
    // that is exactly how the leaked token survived. The maintained core
    // already reads decoded payloads; run the external rule set over them too,
    // so the two layers cover the same ground and either one can be the catch.
    const beforeEncodedScan = sanitized;
    const encodedScan = await maskEncodedSecretsWithSecretlint(sanitized, excludedSet);
    if (encodedScan.text !== beforeEncodedScan) {
      sanitized = encodedScan.text;
      stats.encodedSecretlintDetections += encodedScan.masked;
      stats.encodedSecretlintRuleIds = encodedScan.ruleIds;
      sanitizationStats.patternMasks += encodedScan.masked;
      sanitizationStats.totalMasked += encodedScan.masked;
    }

    // Step 4: Handle 40-char hex tokens specially - only mask if NOT in safe context
    // These could be GitHub tokens OR git commit hashes/gist IDs
    const hexPattern = /(?:^|[\s:=])([a-f0-9]{40})(?=[\s\n]|$)/gm;
    let hexMatch;
    const hexReplacements = [];

    // First pass: find all matches and determine which to mask
    const tempContent = sanitized;
    hexPattern.lastIndex = 0;
    while ((hexMatch = hexPattern.exec(tempContent)) !== null) {
      const token = hexMatch[1];
      const position = hexMatch.index;

      // Skip if already masked
      if (/\*{3,}/.test(token)) {
        continue;
      }

      // Only mask if NOT in a safe git/gist context — at this or any other occurrence (issue #3922)
      if (!isHexInSafeContext(tempContent, token, position) && !hexHasCommitEvidence(tempContent, token)) {
        if (isExcluded(token)) {
          sanitizationStats.excluded++;
          continue;
        }
        hexReplacements.push({ token, masked: maskToken(token) });
      }
    }

    // Second pass: apply replacements
    for (const { token, masked } of hexReplacements) {
      if (sanitized.includes(token)) {
        sanitized = sanitized.split(token).join(masked);
        sanitizationStats.hexMasks++;
        sanitizationStats.totalMasked++;
      }
    }

    // Summary logging
    const totalMasked = stats.engineDetections + allSecrets.size + hexReplacements.length + stats.knownTokens + stats.encodedSecretlintDetections;
    if (global.verboseMode && totalMasked > 0) {
      await log(`  🔒 Sanitized ${totalMasked} secrets:`, { verbose: true });
      await log(`      • Known tokens: ${stats.knownTokens}`, { verbose: true });
      await log(`      • Secretlint: ${stats.secretlintDetections} detections`, { verbose: true });
      if (stats.encodedSecretlintDetections > 0) {
        await log(`      • Secretlint (encoded payloads): ${stats.encodedSecretlintDetections} run(s) [${stats.encodedSecretlintRuleIds.join(', ')}]`, { verbose: true });
      }
      await log(`      • @link-foundation/sensitive-data-sanitizer: ${stats.engineDetections} detections`, { verbose: true });
      await log(`      • Hex tokens: ${hexReplacements.length}`, { verbose: true });
      if (stats.secretlintOnlyWarnings.length > 0) {
        await log(`      ⚠️  Pattern gaps to address: ${stats.secretlintOnlyWarnings.length}`, { verbose: true });
      }
    }
  } catch (error) {
    // Issue #1212: Detect ENOSPC specifically and log at non-verbose level
    const isNoSpace = isENOSPC(error);
    reportError(error, {
      context: 'sanitize_log_content',
      level: isNoSpace ? 'error' : 'warning',
    });
    if (isNoSpace) {
      await log(`  ❌ ENOSPC: No space left on device during output sanitization. Output was blocked.`);
      await log(`     Consider freeing disk space (e.g., rm -rf ~/.claude/debug/*.txt) and retrying.`);
    } else {
      await log(`  ⚠️  Warning: Output sanitization failed; unsafe output was blocked.`, { verbose: true });
    }
    return CREDENTIAL_SANITIZATION_FAILURE_MESSAGE;
  }

  return sanitized;
};

export class CredentialSanitizationError extends Error {
  constructor(options = {}) {
    super(CREDENTIAL_SANITIZATION_FAILURE_MESSAGE, options);
    this.name = 'CredentialSanitizationError';
    this.code = CREDENTIAL_SANITIZATION_ERROR_CODE;
    // Issue #2397: which check blocked publication. Only stage names and rule
    // identifiers are kept here — never the matched text — so they are safe to
    // print in logs and in the "Log Upload Failed" comment.
    this.stage = options.stage || null;
    this.findings = Array.isArray(options.findings) ? options.findings : [];
  }
}

/**
 * Summarize residual findings as `[{ruleId, count}]` without any matched text.
 * @param {Array<Object>} residuals
 * @returns {Array<{ruleId: string, count: number}>}
 */
const summarizeResidualFindings = residuals => {
  const counts = new Map();
  for (const residual of Array.isArray(residuals) ? residuals : []) {
    const ruleId = String(residual?.ruleId || 'unknown').slice(0, 120);
    counts.set(ruleId, (counts.get(ruleId) || 0) + 1);
  }
  return [...counts].map(([ruleId, count]) => ({ ruleId, count }));
};

/**
 * Issue #2397: "Credential sanitization failed; publication was blocked." was
 * the whole upload failure reason on konard/vietnam-accomodation-search#76, and
 * the error's cause was discarded, so nobody could tell which check had failed.
 * Render the stage, rule identifiers and block position (all non-sensitive).
 *
 * @param {Error} error
 * @returns {string}
 */
export const describeCredentialSanitizationFailure = error => {
  const message = error?.message || String(error);
  if (error?.code !== CREDENTIAL_SANITIZATION_ERROR_CODE) return message;
  const details = [];
  if (error.stage) details.push(`stage: ${error.stage}`);
  if (Array.isArray(error.findings) && error.findings.length > 0) details.push(`findings: ${error.findings.map(f => `${f.ruleId}×${f.count}`).join(', ')}`);
  if (Number.isFinite(error.blockIndex)) details.push(`log block ${error.blockIndex}${Number.isFinite(error.blockStartChar) ? ` starting at character ${error.blockStartChar}` : ''}${Number.isFinite(error.blockChars) ? `, ${error.blockChars} characters` : ''}`);
  const causeMessage = error.cause?.message;
  if (causeMessage && !details.length) details.push(causeMessage);
  return details.length > 0 ? `${message} (${details.join('; ')})` : message;
};

/**
 * Exact publication-boundary sanitizer.
 *
 * Unlike best-effort local diagnostics, outbound mutations require both the
 * synchronous core (sensitive-data-sanitizer library) and Secretlint to
 * complete successfully.
 * The final bytes are scanned again immediately before a caller publishes
 * them. Any scanner failure or residual finding blocks publication.
 */
export const sanitizeForPublication = async (input, options = {}) => {
  // Issue #2397: remember which step failed so the error can say so.
  let stage = 'primary';
  let findings = [];
  try {
    const scanner =
      options.scanner ||
      (async value => {
        const sanitized = await sanitizeOutput(value, {
          warnOnMismatch: false,
          // Publication boundaries intentionally ignore all dangerous bypass
          // flags and user-content exclusions.
          skipOutputSanitization: false,
          skipActiveTokensOutputSanitization: false,
          excludeTokens: [],
        });
        if (sanitized === CREDENTIAL_SANITIZATION_FAILURE_MESSAGE) {
          throw new Error('Primary sanitizer failed.');
        }
        return sanitized;
      });
    const sanitized = String(await scanner(String(input ?? '')));
    stage = 'residual-scan';
    const residualScanner =
      options.residualScanner ||
      (async value => {
        const residuals = findCredentialResiduals(value);
        stage = 'secretlint';
        const secretlintResiduals = await detectSecretsWithSecretlint(value, { required: true });
        stage = 'known-token-scan';
        const knownTokenResiduals = await containsKnownToken(value);
        stage = 'residual-scan';
        return [...residuals, ...secretlintResiduals, ...knownTokenResiduals.map(hit => ({ ...hit, ruleId: `known-token:${hit.name || 'unnamed'}${hit.encoding && hit.encoding !== 'plaintext' ? `:${hit.encoding}` : ''}` }))];
      });
    const residuals = await residualScanner(sanitized);
    if (!Array.isArray(residuals) || residuals.length > 0) {
      stage = 'residual';
      findings = summarizeResidualFindings(residuals);
      throw new Error('Residual credential material detected.');
    }
    return sanitized;
  } catch (cause) {
    reportError(new Error('Credential publication boundary blocked unsafe output.'), {
      context: 'credential_publication_boundary',
      level: 'warning',
      stage,
      findings: findings.map(f => f.ruleId).join(','),
    });
    throw new CredentialSanitizationError({ cause, stage, findings });
  }
};

/**
 * Write an exact outbound payload to an owner-readable file after the
 * fail-closed publication scan. Returns the bytes written for callers that
 * also need to compare or reuse them.
 */
export const writeSanitizedPublicationFile = async (filePath, input) => {
  const sanitized = await sanitizeForPublication(input);
  const fs = await getFsModule();
  // Publication intermediates are always new files. Exclusive creation avoids
  // following a pre-planted symlink in a shared temporary directory.
  const handle = await fs.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(sanitized, { encoding: 'utf8' });
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return sanitized;
};

// Export detection functions for testing and visibility
export { detectSecretsWithSecretlint, detectSecretsWithLibrary, detectSecretsWithCustomPatterns, compareDetectionResults };

/**
 * Backward-compatible alias for older log-specific call sites.
 * New output paths should call sanitizeOutput().
 */
export const sanitizeLogContent = sanitizeOutput;

// ============================================================================
// Issue #1745 — known-local-token registry
// ============================================================================
// We mask all known LOCAL tokens (env vars + tokens we discovered via gh/etc.)
// even when our regex/secretlint patterns miss them. This is the
// "defense-in-depth" layer for the leak documented in case-studies/issue-1745.
// ============================================================================

/**
 * Names of environment variables that hold local tokens. Order is irrelevant
 * but we list AI-CLI tools first since those are the most common leak vectors
 * (claude, codex, opencode, gemini, qwen + telegram + gh).
 *
 * Adding a name here means: any process.env value at this key will be masked
 * in every comment body / log line the bridge emits.
 */
export const KNOWN_LOCAL_TOKEN_ENV_VARS = Object.freeze([
  // Telegram bridge
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_OWNER_CHAT_ID',
  // GitHub CLI / API
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_PAT',
  // Claude / Anthropic
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  // OpenAI / Codex
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  // Open-source agent CLIs
  'OPENCODE_API_KEY',
  'AGENT_CLI_TOKEN',
  // Google Gemini / Qwen
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'QWEN_API_KEY',
  'DASHSCOPE_API_KEY',
  // Misc
  'HUGGINGFACE_TOKEN',
  'HF_TOKEN',
]);

/**
 * Read every known local-token env var that is currently set.
 *
 * @returns {Array<{name: string, value: string}>} entries with non-empty values
 */
export const getEnvironmentTokens = () => {
  // The library reads the explicit selection (issue #3740).
  const { knownSecretsFromEnv } = loadSensitiveDataSanitizer();
  return KNOWN_LOCAL_TOKEN_ENV_VARS.flatMap(name => knownSecretsFromEnv(process.env, [name]).map(value => ({ name, value })));
};

/**
 * Build the union of every known-local token: env vars + GitHub tokens we
 * discover through the library: `gh auth token` and every hosts.yml token.
 *
 * Each entry is `{ source, name, value }` where `source` is 'env' | 'gh-files'
 * | 'gh-command'. The `name` field is human-readable for debug logs but is
 * NEVER printed alongside the token to avoid creating a secondary leak.
 *
 * @returns {Promise<Array<{source: string, name: string, value: string}>>}
 */
export const getAllKnownLocalTokens = async () => {
  const tokens = [];

  for (const { name, value } of getEnvironmentTokens()) {
    tokens.push({ source: 'env', name, value });
  }

  try {
    const fileTokens = await getGitHubTokensFromFiles();
    for (const value of fileTokens) {
      tokens.push({ source: 'gh-files', name: 'github', value });
    }
  } catch {
    /* swallow — best-effort */
  }

  try {
    const commandTokens = await getGitHubTokensFromCommand();
    for (const value of commandTokens) {
      tokens.push({ source: 'gh-command', name: 'github', value });
    }
  } catch {
    /* swallow — best-effort */
  }

  // Deduplicate by exact value
  const seen = new Set();
  return tokens.filter(({ value }) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

/**
 * Test whether `text` contains any known-local token verbatim.
 * Used to decide whether to fire the Telegram leak-warning DM.
 *
 * @param {string} text
 * @param {Array<{value: string, name?: string, source?: string}>} [tokens]
 *   Pre-fetched token list (if you already called getAllKnownLocalTokens).
 *   Pass an explicit list to avoid re-reading the local tokens per check.
 * Issue #2156: a token that appears only base64/hex/percent-encoded is a leak
 * just the same — GitHub's own secret scanning decodes before matching, which
 * is exactly how the revocation in that issue was triggered. Encoded hits are
 * reported with the encoding that matched so operators can tell the two cases
 * apart in the fail-closed publication error path.
 *
 * Issue #3739 / #3740: masking runs on @link-foundation/sensitive-data-sanitizer,
 * but this check deliberately does not. It is the independent verifier after
 * the masking step: a plain substring test plus Hive Mind's own decoder
 * (`findEncodedKnownTokenRuns`), so a known value that the library engine
 * misses is still caught here instead of being confirmed by the same engine
 * that missed it. It also names the encoding (`base64`, `hex`, ...), which the
 * library's `rule: 'encoded'` findings do not.
 *
 * @returns {Promise<Array<{name: string, source: string, encoding: string}>>}
 *   list of token identifiers that were found in the text (NOT the values
 *   themselves).
 */
export const containsKnownToken = async (text, tokens) => {
  if (typeof text !== 'string' || text.length === 0) return [];
  const list = tokens || (await getAllKnownLocalTokens());
  const hits = [];
  for (const t of list) {
    // Issue #2397: verify only what the maskers mask, or a short value blocks forever.
    if (!isMaskableTokenValue(t.value)) continue;
    if (text.includes(t.value)) {
      hits.push({ name: t.name, source: t.source, encoding: 'plaintext' });
      continue;
    }
    const encodedRuns = findEncodedKnownTokenRuns(text, [t.value]);
    if (encodedRuns.length > 0) {
      hits.push({ name: t.name, source: t.source, encoding: encodedRuns[0].encoding });
    }
  }
  return hits;
};

/**
 * Mask every known-local token inside `body` and then run `sanitizeOutput`
 * for the regex/secretlint sweep. This is the wrapper that comment-posting
 * paths must call before publishing anything to GitHub.
 *
 * Env-token masking runs FIRST so that even if our regex misses the shape
 * (custom token formats from new AI tools, etc.) the local secret never
 * leaves the process. The regex/secretlint pass then catches anything else.
 *
 * @param {string} body
 * @param {Object} [options]
 * @param {Array<{value: string}>} [options.knownTokens] pre-fetched token list
 * @returns {Promise<string>} sanitized body
 */
export const sanitizeCommentBody = async (body, options = {}) => {
  if (typeof body !== 'string' || body.length === 0) return body;

  let sanitized = body;
  const excludedSet = new Set((options.excludeTokens || []).filter(t => typeof t === 'string' && t.length > 0));

  // Pass 1: mask known-local tokens verbatim. This is the defense-in-depth
  // layer that closes the gap from issue #1745.
  if (!options.skipActiveTokensOutputSanitization) {
    const knownTokens = options.knownTokens || (await getAllKnownLocalTokens());
    for (const { value } of knownTokens) {
      if (isMaskableTokenValue(value) && excludedSet.has(value) && sanitized.includes(value)) sanitizationStats.excluded++;
    }

    // Verbatim and (issue #2156) re-encoded: base64/hex/percent/escapes.
    const known = maskKnownTokens(sanitized, usableTokenValues(knownTokens, excludedSet));
    if (known.masked > 0) {
      sanitized = known.text;
      sanitizationStats.knownTokenMasks += known.masked;
      sanitizationStats.totalMasked += known.masked;
    }
  }

  // Pass 2: engine + secretlint sweep for anything else.
  sanitized = await sanitizeOutput(sanitized, {
    warnOnMismatch: false,
    skipOutputSanitization: options.skipOutputSanitization,
    skipActiveTokensOutputSanitization: true,
    excludeTokens: options.excludeTokens || [],
  });

  return sanitized;
};

/**
 * Issue #1745 user-content carve-out helper.
 *
 * Comment #4364642786: "if issue description/comment/pull request comment from
 * other users than our bot, contained access token, meaning access token was
 * explicitly given, or access token was existing in code before, we don't
 * touch it. That is not our responsibility by default."
 *
 * Given concatenated user-provided text (issue body, non-bot issue/PR
 * comments, original code), this helper returns the token-shaped strings
 * already present in that text. Callers pass this list as `excludeTokens`
 * to `sanitizeOutput` / `sanitizeCommentBody` so the sanitizer leaves those
 * tokens untouched.
 *
 * Active local tokens (env vars, gh CLI tokens) are NEVER returned even if
 * they appear in user-provided content — the user couldn't have intended for
 * us to leak our own bot tokens, so the carve-out doesn't apply to them.
 *
 * @param {string} text concatenated user-provided text
 * @param {Object} [options]
 * @param {Array<{value: string}>} [options.knownTokens] active local tokens to
 *   filter out of the carve-out (so the bot's own tokens still get masked
 *   even if the user pasted one verbatim).
 * @returns {Promise<Array<string>>} token VALUES to exclude from sanitization
 */
export const extractTokensFromUserContent = async (text, options = {}) => {
  if (typeof text !== 'string' || text.length === 0) return [];

  const engineSecrets = detectSecretsWithLibrary(text);
  const secretlintSecrets = await detectSecretsWithSecretlint(text);

  const tokens = new Set();
  for (const s of [...engineSecrets, ...secretlintSecrets]) {
    if (s.token && s.token.length >= 12) {
      tokens.add(s.token);
    }
  }

  // 40-char hex in user-provided text — only exclude when not in a safe
  // git/gist context. We're conservative here: the carve-out only applies
  // to things our regex would otherwise mask.
  const hexPattern = /(?:^|[\s:=])([a-f0-9]{40})(?=[\s\n]|$)/gm;
  hexPattern.lastIndex = 0;
  let m;
  while ((m = hexPattern.exec(text)) !== null) {
    const token = m[1];
    if (!isHexInSafeContext(text, token, m.index) && !hexHasCommitEvidence(text, token)) {
      tokens.add(token);
    }
  }

  // Filter out our own active local tokens. The user pasting our token in
  // their issue body doesn't mean we should leak it — that's still our bot's
  // secret and it stays masked.
  const knownActive = new Set((options.knownTokens || []).map(t => t.value).filter(Boolean));
  return [...tokens].filter(value => !knownActive.has(value));
};

// Default export for convenience
export default {
  CredentialSanitizationError,
  createCredentialStreamSanitizer,
  isSafeToken,
  isHexInSafeContext,
  hexHasCommitEvidence,
  getGitHubTokensFromFiles,
  getGitHubTokensFromCommand,
  sanitizeOutput,
  sanitizeLogContent,
  detectSecretsWithSecretlint,
  detectSecretsWithLibrary,
  detectSecretsWithCustomPatterns,
  compareDetectionResults,
  getEnvironmentTokens,
  getAllKnownLocalTokens,
  containsKnownToken,
  sanitizeForPublication,
  writeSanitizedPublicationFile,
  sanitizeCommentBody,
  getSanitizationStats,
  resetSanitizationStats,
  formatSanitizationSummary,
  extractTokensFromUserContent,
  KNOWN_LOCAL_TOKEN_ENV_VARS,
};
