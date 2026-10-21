/**
 * Deterministic replays of recorded E2E attempts (issue #3630).
 *
 * A replay fixture is derived from one row's evidence directory (result.json,
 * delivery.json, solve.log, act.log, commands.json, manifest.json). It keeps
 * what the oracles judged: the delivered pull request and its files, the
 * comments, the session's exit status and the act output, plus the verdicts
 * the live run reported. Everything is redacted with `redactForFixture`, and
 * what the evidence lacked or truncated is listed, never filled in silently.
 *
 * The replay test runs the production `runE2eRow` against the GitHub emulator
 * with an agent built from the fixture, so the same oracles judge the same
 * delivery without a token.
 */
import { createHash } from 'node:crypto';
import { redactForFixture } from './e2e-evidence.lib.mjs';

export const REPLAY_FIXTURE_VERSION = 1;
/** How much of a session log a fixture keeps from its start and its end. */
export const SESSION_HEAD_BYTES = 4 * 1024;
export const SESSION_TAIL_BYTES = 16 * 1024;
/** Lines the harness oracles read from a session log; they are always kept. */
const ORACLE_LINE = /refusing to allow an? .* to create or update workflow/i;
const PLACEHOLDER_CONTENT = '(content not recorded)\n';

const sha256 = text => createHash('sha256').update(text).digest('hex');

/**
 * The content of a file the pull request added, from its unified diff. A
 * patch that only adds lines rebuilds the file exactly; anything else is null.
 *
 * @param {string|null} patch
 * @returns {string|null}
 */
export function contentFromPatch(patch) {
  if (typeof patch !== 'string' || !/^@@ -0,0 \+1(,\d+)? @@/.test(patch)) return null;
  const lines = patch.split('\n').slice(1);
  if (lines.at(-1) === '') lines.pop();
  if (lines.some(line => !line.startsWith('+') && !line.startsWith('\\'))) return null;
  const noFinalNewline = lines.at(-1)?.startsWith('\\');
  const body = lines
    .filter(line => line.startsWith('+'))
    .map(line => line.slice(1))
    .join('\n');
  return noFinalNewline ? body : `${body}\n`;
}

/**
 * The part of a session log a fixture keeps: its head, its tail and every
 * line an oracle reads, with the size and digest of the whole log.
 *
 * @param {string} text
 * @returns {{text: string, bytes: number, sha256: string, truncated: boolean}}
 */
export function sessionLogExcerpt(text, { head = SESSION_HEAD_BYTES, tail = SESSION_TAIL_BYTES } = {}) {
  const log = String(text ?? '');
  const bytes = Buffer.byteLength(log);
  if (log.length <= head + tail) return { text: log, bytes, sha256: sha256(log), truncated: false };
  const middle = log.slice(head, log.length - tail);
  const kept = middle.split('\n').filter(line => ORACLE_LINE.test(line));
  const marker = `\n[replay: ${bytes - Buffer.byteLength(log.slice(0, head) + log.slice(-tail))} bytes of the session log omitted; ${kept.length} oracle lines kept]\n`;
  return { text: `${log.slice(0, head)}${marker}${kept.map(line => `${line}\n`).join('')}${log.slice(-tail)}`, bytes, sha256: sha256(log), truncated: true };
}

/** Apply `redact` to every string in a JSON value. */
const deepMap = (value, redact) => {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(item => deepMap(item, redact));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepMap(item, redact)]));
  return value;
};

/**
 * Derive a replay fixture from the contents of one evidence directory.
 *
 * @param {object} recorded
 * @param {string} recorded.name the fixture name, e.g. `39505806192-codex-formal-ai`
 * @param {object} recorded.result result.json
 * @param {object|null} [recorded.delivery] delivery.json (or a backfilled one)
 * @param {string|null} [recorded.solveLog]
 * @param {string|null} [recorded.actLog]
 * @param {object[]|null} [recorded.commands] commands.json
 * @param {object|null} [recorded.manifest] manifest.json
 * @param {string[]} [recorded.present] names of the files the directory had
 * @param {{env?: object, extraSecrets?: string[]}} [options] passed to redactForFixture
 * @returns {object} the fixture
 */
export function deriveReplay({ name, result, delivery = null, solveLog = null, actLog = null, commands = null, manifest = null, present = [] }, { env = process.env, extraSecrets = [] } = {}) {
  if (!result?.tool || !result?.model) throw new Error(`${name}: result.json names no tool and model`);
  const missing = [...new Set([...(manifest?.missing || []), ...['delivery.json', 'solve.log', 'commands.json'].filter(file => !present.includes(file))])].sort();
  const commandOf = logName => (commands || []).filter(command => command.logName === logName).at(-1) || null;
  const pullRequest = delivery?.pullRequest || null;
  const changes = new Map((delivery?.changes || []).map(change => [change.filename, change]));
  const files = (delivery?.files || result.files || []).map(path => {
    const change = changes.get(path);
    const content = change && !change.truncated ? contentFromPatch(change.patch) : null;
    return { path, content: content ?? PLACEHOLDER_CONTENT, contentSource: content === null ? 'placeholder' : 'patch' };
  });
  const actRecord = commandOf('act.log');
  const actChecks = result.execution?.mode === 'act' ? result.execution.checks || [] : [];
  const act = actLog === null ? null : { log: actLog, exitCode: actRecord?.exitCode ?? (actChecks.some(check => check.conclusion === 'FAILURE') ? 1 : 0), exitCodeSource: actRecord ? 'commands.json' : 'execution checks' };
  const session = solveLog === null ? null : { exitCode: commandOf('solve.log')?.exitCode ?? result.solveExitCode ?? null, log: sessionLogExcerpt(solveLog) };
  const fixture = {
    v: REPLAY_FIXTURE_VERSION,
    name,
    source: {
      runId: result.custody?.runId ?? String(result.resources?.baseBranch || '').split('/')[2] ?? null,
      tool: result.tool,
      model: result.model,
      layer: result.layer || 'default',
      workflowDir: result.workflowDir || '.github/workflows/',
      formalAiTag: result.formalAiTag ?? null,
      formalAiVersion: result.formalAiVersion ?? null,
      sourceSha: result.identity?.sourceSha ?? result.custody?.sourceSha ?? null,
      issueNumber: result.resources?.issueNumber ?? null,
      pullRequestNumber: pullRequest?.number ?? result.resources?.pullRequestNumber ?? null,
      startedAt: result.startedAt ?? null,
      finishedAt: result.finishedAt ?? null,
    },
    recorded: { passed: Boolean(result.passed), verdict: result.verdict ?? null, solveExitCode: result.solveExitCode ?? null, error: result.error ?? null, evaluation: result.evaluation?.results || [], harness: result.harness || [] },
    session,
    delivery: {
      pullRequest: pullRequest ? { title: pullRequest.title, body: pullRequest.body ?? '', state: pullRequest.state, isDraft: Boolean(pullRequest.isDraft), headRefName: pullRequest.headRefName, baseRefName: pullRequest.baseRefName } : null,
      files: pullRequest || result.pullRequestUrl ? files : [],
      comments: delivery?.comments || [],
      backfilled: delivery?.backfilled ?? null,
    },
    act,
    evidence: { present: [...present].sort(), missing, truncated: [...(manifest?.truncated || []), ...(session?.log.truncated ? [{ logName: 'solve.log', bytes: session.log.bytes, kept: 'head, tail and oracle lines' }] : [])], placeholders: files.filter(file => file.contentSource === 'placeholder').map(file => file.path), redactions: 0 },
  };
  let redactions = 0;
  const redacted = deepMap(fixture, text => {
    const output = redactForFixture(text, { env, extraSecrets });
    redactions += output.redactions;
    return output.text;
  });
  redacted.evidence.redactions = redactions;
  return redacted;
}

/** The name a row's evidence directory is published under: `<run>-<tool>-<model>`. */
export function replayName(result, artifactName = '') {
  const runId = result.custody?.runId ?? String(result.resources?.baseBranch || '').split('/')[2] ?? '';
  const attempt = String(artifactName).match(/-a(\d+)$/)?.[1];
  return [runId || 'local', attempt && attempt !== '1' ? `a${attempt}` : null, result.tool, result.model].filter(Boolean).join('-');
}

/**
 * Compare the replayed verdicts with the recorded ones by assertion name.
 * `changes` lists the assertions whose oracle was fixed after the recording,
 * with the result the fixed oracle gives.
 *
 * @returns {{same: boolean, differences: Array<{name: string, recorded: boolean|null, replayed: boolean|null}>}}
 */
export function compareReplay(recorded, replayed, { changes = {} } = {}) {
  const byName = results => new Map((results || []).map(result => [result.name, result.ok]));
  const before = byName(recorded);
  const after = byName(replayed);
  const differences = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const expected = name in changes ? changes[name] : (before.get(name) ?? null);
    const actual = after.get(name) ?? null;
    if (expected !== actual) differences.push({ name, recorded: before.get(name) ?? null, expected, replayed: actual });
  }
  return { same: differences.length === 0, differences };
}
