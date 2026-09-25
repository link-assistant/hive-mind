/**
 * Recover from a transient AI tool authentication failure (issue #2296).
 *
 * A 20-hour `--tool claude` session died on
 *   API Error: 401 {"type":"error","error":{"type":"authentication_error",
 *   "message":"OAuth session expired and could not be refreshed"}}
 * and solve treated it like any other tool failure: no retry, the run ended
 * and the container was removed. The credentials were fine a moment later —
 * another holder of the single-use refresh token had rotated them — so the
 * failure was transient, not a revoked login.
 *
 * The recovery implemented here:
 *   1. classify the failure as a transient auth failure (401, `authentication_failed`,
 *      "OAuth session expired", "could not be refreshed", a thrown `isAuthError`);
 *   2. re-read the tool's credential file and wait (with backoff) until another
 *      process has refreshed it or it holds a token that is not expired;
 *   3. resume the same session with `--resume <session-id>`;
 *   4. give up after `--auth-retry-attempts` resumes (default 2), and say so in
 *      the error message that every failure comment quotes.
 *
 * The module has no top-level side effects so it can be unit-tested without a
 * GitHub environment.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2296
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AUTH_RETRY_DEFAULT_ATTEMPTS = 2;
export const AUTH_RETRY_DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;
const POLL_INITIAL_MS = 5 * 1000;
const POLL_MAX_MS = 60 * 1000;
// A token that expires within this margin is treated as already expired.
const EXPIRY_MARGIN_MS = 60 * 1000;

/** Account problems that re-reading credentials can never fix. */
const NON_TRANSIENT_SUBSCRIPTION_KINDS = new Set(['org_subscription_disabled', 'account_no_access', 'billing', 'plan_restricted', 'api_key_invalid']);

const AUTH_FAILURE_PATTERNS = [/\b401\b/, /\bunauthori[sz]ed\b/i, /authentication_failed/i, /authentication_error/i, /oauth session expired/i, /could not be refreshed/i, /failed to authenticate/i, /refresh token (?:was rejected|expired|invalid)/i, /login expired/i];

const toNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * `--auth-retry-attempts` (default 2). `0` disables the recovery.
 */
export const resolveAuthRetryAttempts = (argv = {}) => {
  const value = toNumber(argv.authRetryAttempts ?? argv['auth-retry-attempts']);
  if (value === null) return AUTH_RETRY_DEFAULT_ATTEMPTS;
  return Math.max(0, Math.floor(value));
};

export const resolveAuthRetryMaxWaitMs = (env = process.env) => {
  const value = toNumber(env.HIVE_MIND_AUTH_RETRY_MAX_WAIT_MS);
  return value === null ? AUTH_RETRY_DEFAULT_MAX_WAIT_MS : Math.max(0, value);
};

/**
 * The file each tool stores its OAuth login in. `null` for tools that
 * authenticate some other way (API key, router token).
 */
export const resolveCredentialFile = ({ tool = 'claude', env = process.env, homeDir = os.homedir() } = {}) => {
  switch (String(tool || 'claude').toLowerCase()) {
    case 'claude':
      return path.join(env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude'), '.credentials.json');
    case 'codex':
      return path.join(env.HIVE_MIND_PARENT_CODEX_HOME || env.CODEX_HOME || path.join(homeDir, '.codex'), 'auth.json');
    case 'qwen':
      return path.join(homeDir, '.qwen', 'oauth_creds.json');
    case 'gemini':
      return path.join(homeDir, '.gemini', 'oauth_creds.json');
    case 'opencode':
    case 'agent':
      return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'opencode', 'auth.json');
    default:
      return null;
  }
};

const EXPIRY_KEYS = new Set(['expiresAt', 'expires_at', 'expiry_date', 'expires']);

const normaliseEpochMs = value => {
  const number = typeof value === 'string' && !/^\d+$/.test(value) ? Date.parse(value) : toNumber(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  // Seconds since the epoch are below 1e12 until the year 33658.
  return number < 1e12 ? number * 1000 : number;
};

const jwtExpiryMs = token => {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return normaliseEpochMs(payload?.exp);
  } catch {
    return null;
  }
};

/**
 * Latest access-token expiry found in a credential document: Claude
 * `claudeAiOauth.expiresAt`, Gemini/Qwen `expiry_date`, OpenCode `expires`, or
 * the `exp` claim of Codex's `tokens.access_token` JWT.
 */
export const findCredentialExpiryMs = document => {
  let latest = null;
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    for (const [key, value] of Object.entries(node)) {
      let candidate = null;
      if (EXPIRY_KEYS.has(key)) candidate = normaliseEpochMs(value);
      else if (key === 'access_token') candidate = jwtExpiryMs(value);
      else if (value && typeof value === 'object') visit(value, depth + 1);
      if (candidate !== null && (latest === null || candidate > latest)) latest = candidate;
    }
  };
  visit(document, 0);
  return latest;
};

/**
 * What the credential file looks like right now. The content is only kept as
 * a hash so the token never reaches a log.
 */
export const readCredentialState = (file, { fsImpl = fs } = {}) => {
  if (!file) return { file, exists: false, mtimeMs: null, expiresAt: null, hash: null };
  try {
    const stat = fsImpl.statSync(file);
    const content = fsImpl.readFileSync(file, 'utf8');
    let expiresAt = null;
    try {
      expiresAt = findCredentialExpiryMs(JSON.parse(content));
    } catch {
      // Not JSON: rely on mtime/hash.
    }
    return { file, exists: true, mtimeMs: stat.mtimeMs, expiresAt, hash: crypto.createHash('sha256').update(content).digest('hex') };
  } catch {
    return { file, exists: false, mtimeMs: null, expiresAt: null, hash: null };
  }
};

const failureText = ({ toolResult, error }) => [error?.message, toolResult?.errorInfo?.message, typeof toolResult?.errorInfo === 'string' ? toolResult.errorInfo : null, toolResult?.subscriptionError?.message, typeof toolResult?.result === 'string' ? toolResult.result : null].filter(Boolean).join('\n');

/**
 * Is this failed run an authentication failure that fresh credentials and a
 * resume can fix?
 *
 * @returns {null|{reason: string}} `null` when it is not
 */
export const classifyTransientAuthFailure = ({ toolResult = null, error = null } = {}) => {
  if (error) {
    if (!error.isAuthError) return null;
    return { reason: String(error.message || 'authentication failed').split('\n')[0] };
  }
  if (!toolResult || typeof toolResult !== 'object' || toolResult.success === true) return null;
  if (toolResult.limitReached || toolResult.routerAuthViolation || toolResult.formalAiNonExecution) return null;
  const kind = toolResult.subscriptionError?.kind;
  if (kind && NON_TRANSIENT_SUBSCRIPTION_KINDS.has(kind)) return null;
  const text = failureText({ toolResult });
  if (kind === 'login_required' || AUTH_FAILURE_PATTERNS.some(pattern => pattern.test(text))) {
    const firstLine = (text.split('\n').find(Boolean) || 'authentication failed').replace(/\s+/g, ' ').trim();
    return { reason: firstLine.length > 300 ? `${firstLine.slice(0, 299)}…` : firstLine };
  }
  return null;
};

export const isTransientAuthFailure = input => classifyTransientAuthFailure(input) !== null;

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait until the tool's credentials are usable again: the file was rewritten
 * after `since` (another process refreshed the token) or it holds a token that
 * is not expired. Polls with exponential backoff (5 s → 60 s) for at most
 * `maxWaitMs`; after that the resume is attempted anyway, because the resumed
 * CLI performs its own refresh under the shared lock.
 *
 * @returns {Promise<{file: string|null, ready: boolean, changed: boolean, waitedMs: number, reason: string}>}
 */
export const waitForCredentialRefresh = async ({ tool = 'claude', since = 0, env = process.env, homeDir = os.homedir(), maxWaitMs = resolveAuthRetryMaxWaitMs(env), now = Date.now, sleep = defaultSleep, fsImpl = fs, log = async () => {} } = {}) => {
  const file = resolveCredentialFile({ tool, env, homeDir });
  const startedAt = now();
  const initial = readCredentialState(file, { fsImpl });
  const evaluate = state => {
    if (!state.exists) return null;
    const changed = state.hash !== initial.hash || (state.mtimeMs !== null && state.mtimeMs > since);
    if (changed) return { changed: true, reason: 'the credential file was refreshed' };
    if (state.expiresAt !== null && state.expiresAt > now() + EXPIRY_MARGIN_MS) return { changed: false, reason: `the stored token is valid until ${new Date(state.expiresAt).toISOString()}` };
    return null;
  };
  if (!file || !initial.exists) {
    await log(`   🔑 No ${tool} credential file to re-read${file ? ` (${file} is missing)` : ''}; resuming without waiting`, { verbose: true });
    return { file, ready: false, changed: false, waitedMs: 0, reason: 'no credential file' };
  }
  let verdict = evaluate(initial);
  let delay = POLL_INITIAL_MS;
  while (!verdict && now() - startedAt < maxWaitMs) {
    const remaining = maxWaitMs - (now() - startedAt);
    await log(`   🔑 Waiting up to ${Math.ceil(remaining / 1000)}s for ${file} to be refreshed (next check in ${Math.round(Math.min(delay, remaining) / 1000)}s)`);
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, POLL_MAX_MS);
    verdict = evaluate(readCredentialState(file, { fsImpl }));
  }
  const waitedMs = now() - startedAt;
  if (verdict) return { file, ready: true, changed: verdict.changed, waitedMs, reason: verdict.reason };
  return { file, ready: false, changed: false, waitedMs, reason: `the credential file did not change within ${Math.round(maxWaitMs / 1000)}s` };
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** One-line description of what the recovery did, for logs and comments. */
export const formatAuthRetrySummary = authRetry => {
  if (!authRetry) return '';
  if (authRetry.skipped) return `Automatic authentication recovery was not attempted: ${authRetry.skipped}.`;
  const what = `re-read the ${authRetry.tool || 'tool'} credentials and resumed session ${authRetry.sessionId || '(unknown)'} with --resume ${plural(authRetry.attempts, 'time')}`;
  return authRetry.recovered ? `Authentication failed, Hive Mind ${what}, and the session recovered.` : `Authentication failed, Hive Mind ${what}, and authentication failed again each time.`;
};

/**
 * Stop reason and evidence lines for an "Automation stopped" comment: a failed
 * run that went through the auth recovery says so, attempt by attempt.
 */
export const describeAuthRetryStop = toolResult => {
  const authRetry = toolResult?.authRetry;
  if (!authRetry || authRetry.recovered || authRetry.skipped) return { reason: 'tool_failure', details: [] };
  const details = [formatAuthRetrySummary(authRetry), ...authRetry.history.map(entry => `Attempt ${entry.attempt}: ${entry.reason} — ${entry.credentialsChanged ? 'credentials were refreshed' : entry.credentialsReady ? 'stored token was still valid' : 'credentials did not change'} after ${Math.round(entry.waitedMs / 1000)}s, resumed with \`--resume ${entry.sessionId}\``)];
  return { reason: 'auth_failure_after_retry', details };
};

const annotateExhausted = ({ toolResult, error, authRetry }) => {
  const prefix = authRetry.skipped ? '' : `Authentication failed again after ${plural(authRetry.attempts, 'automatic resume attempt')}: `;
  if (error) {
    error.authRetry = authRetry;
    if (prefix && !String(error.message).startsWith(prefix)) error.message = `${prefix}${error.message}`;
    return error;
  }
  toolResult.authRetry = authRetry;
  if (prefix) {
    const errorInfo = toolResult.errorInfo && typeof toolResult.errorInfo === 'object' ? toolResult.errorInfo : { message: typeof toolResult.errorInfo === 'string' ? toolResult.errorInfo : null };
    const original = errorInfo.message || classifyTransientAuthFailure({ toolResult })?.reason || 'authentication failed';
    toolResult.errorInfo = { ...errorInfo, message: original.startsWith(prefix) ? original : `${prefix}${original}` };
  }
  return toolResult;
};

/**
 * Run a tool and, while it keeps failing with a transient auth failure, wait for
 * fresh credentials and resume the same session.
 *
 * @param {Object} options
 * @param {(argv: Object, retry: number) => Promise<Object>} options.run - one tool run; `retry` is 0 for the first run
 * @returns {Promise<Object>} the last tool result, with `authRetry` set when a retry happened
 */
export const runWithTransientAuthRetry = async ({ tool, argv = {}, run, log = async () => {}, attempts = resolveAuthRetryAttempts(argv), waitForCredentials = waitForCredentialRefresh, now = Date.now } = {}) => {
  const toolName = String(tool || argv.tool || 'claude').toLowerCase();
  const history = [];
  let runArgv = argv;
  let startedAt = now();
  for (let retry = 0; ; retry++) {
    let toolResult = null;
    let error = null;
    try {
      toolResult = await run(runArgv, retry);
    } catch (thrown) {
      if (!thrown?.isAuthError) throw thrown;
      error = thrown;
    }
    const failure = classifyTransientAuthFailure({ toolResult, error });
    const sessionId = toolResult?.sessionId || error?.sessionId || runArgv.resume || null;
    if (!failure) {
      if (retry > 0 && toolResult && typeof toolResult === 'object') {
        toolResult.authRetry = { tool: toolName, attempts: retry, recovered: true, sessionId, history };
        await log(`✅ ${formatAuthRetrySummary(toolResult.authRetry)}`);
      }
      return toolResult;
    }
    if (attempts <= 0) {
      if (error) throw error;
      return toolResult;
    }
    if (retry >= attempts || !sessionId) {
      const authRetry = retry === 0 ? { tool: toolName, attempts: 0, recovered: false, sessionId, history, skipped: 'the tool reported no session id to resume' } : { tool: toolName, attempts: retry, recovered: false, sessionId, history };
      await log(`❌ ${formatAuthRetrySummary(authRetry)}`, { level: 'error' });
      const annotated = annotateExhausted({ toolResult, error, authRetry });
      if (error) throw annotated;
      return annotated;
    }
    await log('');
    await log(`🔐 Authentication failure detected (attempt ${retry + 1}/${attempts + 1}): ${failure.reason}`);
    await log(`   Treating it as transient (issue #2296): re-reading the ${toolName} credentials, then resuming session ${sessionId}`);
    const wait = await waitForCredentials({ tool: toolName, since: startedAt, log });
    await log(`   🔑 ${wait.ready ? 'Credentials ready' : 'Credentials unchanged'}: ${wait.reason}; resuming with --resume ${sessionId}`);
    history.push({ attempt: retry + 1, reason: failure.reason, sessionId, waitedMs: wait.waitedMs, credentialsChanged: wait.changed, credentialsReady: wait.ready });
    runArgv = { ...argv, resume: sessionId };
    startedAt = now();
  }
};

/**
 * Newest-wins reconciliation of a credential file and a private copy of it
 * (Codex runs against a repository-scoped CODEX_HOME holding a copy of the
 * operator `auth.json`). A token the task refreshed inside its copy must reach
 * the operator file — the old refresh token is single-use, so leaving it there
 * breaks the next task — and a token refreshed by the operator must reach the
 * copy. The write is atomic (temp file + rename) like the CLIs' own.
 *
 * @returns {'copied-to-copy'|'copied-to-primary'|'removed-copy'|'unchanged'}
 */
export const reconcileCredentialCopy = async ({ primary, copy, fsImpl = fs.promises }) => {
  const read = async file => {
    try {
      return { content: await fsImpl.readFile(file), mtimeMs: (await fsImpl.stat(file)).mtimeMs };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  const writeAtomic = async (file, content) => {
    const temp = `${file}.hive-mind-${process.pid}-${Date.now()}.tmp`;
    await fsImpl.writeFile(temp, content, { mode: 0o600 });
    await fsImpl.rename(temp, file);
  };
  const [base, scoped] = await Promise.all([read(primary), read(copy)]);
  if (!base) {
    if (!scoped) return 'unchanged';
    await fsImpl.rm(copy, { force: true });
    return 'removed-copy';
  }
  if (scoped && Buffer.compare(base.content, scoped.content) === 0) return 'unchanged';
  if (scoped && scoped.mtimeMs > base.mtimeMs) {
    await writeAtomic(primary, scoped.content);
    return 'copied-to-primary';
  }
  await fsImpl.mkdir(path.dirname(copy), { recursive: true });
  await writeAtomic(copy, base.content);
  return 'copied-to-copy';
};
