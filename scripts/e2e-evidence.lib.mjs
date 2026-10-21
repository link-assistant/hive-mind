/**
 * Evidence of one E2E attempt (issue #3630): every command with its exit
 * status and byte counts, the identities of what was tested, the delivered
 * pull request, and a manifest that marks missing and truncated data instead
 * of silently dropping it. Redaction for publishing replay fixtures lives here
 * too, so a fixture never carries a secret or a person's data.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** How much of one command's output is kept in memory for the oracles. */
export const MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;

/** Files every completed attempt is expected to leave; absent ones are marked. */
export const EXPECTED_EVIDENCE = Object.freeze(['result.json', 'custody.json', 'commands.json', 'identity.json', 'delivery.json', 'solve.log', 'workflow.log']);

/**
 * Record one command. The record outlives the output it describes: a command
 * that never finished keeps `exitCode: null` and an `interrupted` flag.
 */
export function startCommandRecord(records, { command, argv, logName, now = () => new Date() }) {
  const record = { command, argv: redactArgv(argv), logName, startedAt: now().toISOString(), finishedAt: null, exitCode: null, signal: null, bytes: 0, keptBytes: 0, truncated: false, interrupted: true };
  records.push(record);
  return {
    record,
    output(chunkLength, kept) {
      record.bytes += chunkLength;
      record.keptBytes = kept;
      if (record.bytes > record.keptBytes) record.truncated = true;
    },
    finish({ code, signal = null }) {
      Object.assign(record, { finishedAt: now().toISOString(), exitCode: code, signal, interrupted: false });
    },
  };
}

/** Keep the tail of a stream within `limit` and say how much was dropped. */
export function keepTail(previous, chunk, limit = MEMORY_LIMIT_BYTES) {
  const joined = previous + chunk;
  return joined.length > limit ? joined.slice(-limit) : joined;
}

/** Values of these flags never appear in an argv record, inline or as the next argument. */
const SECRET_FLAG = /^(--?(?:token|api-key|password|secret))(=.*)?$/i;
export const redactArgv = argv =>
  (argv || []).map((arg, index, all) => {
    const match = String(arg).match(SECRET_FLAG);
    if (match) return match[2] ? `${match[1]}=[REDACTED]` : String(arg);
    return index > 0 && SECRET_FLAG.test(String(all[index - 1])) && !String(all[index - 1]).includes('=') ? '[REDACTED]' : String(arg);
  });

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

/**
 * A manifest of the evidence directory: size and sha256 of every file, the
 * expected files that are missing, and which command logs were truncated in
 * memory (the file on disk stays complete).
 */
export function buildEvidenceManifest(directory, { commands = [], expected = EXPECTED_EVIDENCE } = {}) {
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name !== 'manifest.json') files.push({ path: relative(directory, path), bytes: statSync(path).size, sha256: sha256(readFileSync(path)) });
    }
  };
  if (existsSync(directory)) walk(directory);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const present = new Set(files.map(file => file.path));
  return {
    v: 1,
    files,
    missing: expected.filter(name => !present.has(name)),
    truncated: commands.filter(command => command.truncated).map(command => ({ logName: command.logName, bytes: command.bytes, keptBytes: command.keptBytes })),
    interrupted: commands.filter(command => command.interrupted).map(command => command.logName),
  };
}

export function writeEvidenceManifest(directory, options) {
  const manifest = buildEvidenceManifest(directory, options);
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** What the pull request delivered, as the oracles saw it. */
export function deliveryRecord({ issueUrl, pullRequest, files, checks, comments, execution }) {
  return {
    v: 1,
    issueUrl: issueUrl ?? null,
    pullRequest: pullRequest ? { number: pullRequest.number, url: pullRequest.url, state: pullRequest.state, isDraft: pullRequest.isDraft, title: pullRequest.title, body: pullRequest.body, headRefName: pullRequest.headRefName, headRefOid: pullRequest.headRefOid, baseRefName: pullRequest.baseRefName } : null,
    files: files ?? [],
    checks: checks ?? [],
    comments: comments ?? [],
    execution: execution ? { mode: execution.mode, fallbackReason: execution.fallbackReason ?? null } : null,
  };
}

const TOKEN_PATTERNS = [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, /\bAKIA[0-9A-Z]{16}\b/g, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, /(authorization:\s*(?:bearer|token|basic)\s+)[^\s"']+/gi, /(x-access-token:)[^@\s]+@/gi];
const SECRET_ENV = /(TOKEN|SECRET|KEY|PASSWORD|GRANT|CREDENTIAL)/i;
// Bot and no-reply addresses identify automation, not a person.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEPT_EMAIL = /(noreply|no-reply|\[bot\]|users\.noreply\.github\.com|@example\.(com|org)$)/i;

/**
 * Remove secrets and personal data before a log becomes a published fixture:
 * values of secret-looking environment variables, token shapes, private keys,
 * personal email addresses and home directories.
 *
 * @param {string} text
 * @param {{env?: object, extraSecrets?: string[]}} [options]
 * @returns {{text: string, redactions: number}}
 */
export function redactForFixture(text, { env = process.env, extraSecrets = [] } = {}) {
  let redactions = 0;
  let output = String(text ?? '');
  const secrets = [
    ...Object.entries(env)
      .filter(([name, value]) => SECRET_ENV.test(name) && typeof value === 'string' && value.length >= 8 && !['workspace', 'true', 'false'].includes(value))
      .map(([, value]) => value),
    ...extraSecrets.filter(value => value && value.length >= 8),
  ];
  for (const secret of [...new Set(secrets)].sort((a, b) => b.length - a.length)) {
    const parts = output.split(secret);
    redactions += parts.length - 1;
    output = parts.join('[REDACTED]');
  }
  for (const pattern of TOKEN_PATTERNS)
    output = output.replace(pattern, (match, prefix) => {
      redactions += 1;
      return typeof prefix === 'string' && prefix && match.startsWith(prefix) ? `${prefix}[REDACTED]` : '[REDACTED]';
    });
  output = output.replace(EMAIL, match => {
    if (KEPT_EMAIL.test(match)) return match;
    redactions += 1;
    return 'person@example.com';
  });
  output = output.replace(/\/(home|Users)\/(?!box\b|runner\b)[A-Za-z0-9._-]+/g, (match, root) => {
    redactions += 1;
    return `/${root}/user`;
  });
  return { text: output, redactions };
}
