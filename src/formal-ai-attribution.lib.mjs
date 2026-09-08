#!/usr/bin/env node

/**
 * Formal AI commit attribution (issue #2229).
 *
 * `solve --tool agent --model formal-ai` used to author commits that carried
 * nothing formal-ai's self-hosting metric can read, so every pull request Hive
 * Mind opened with Formal AI was measured as human work and the published
 * self-hosting share stayed at 0.00 %.
 *
 * `scripts/self-hosting-metric.rs` in formal-ai decides per commit, and it is
 * strict in a way that matters here: a commit carrying `Formal-AI-Session`
 * whose `Formal-AI-Evidence` path does not resolve **in that same commit's
 * tree** is not "not counted", it is a hard error that fails the gate
 * (`commit_has_formal_ai_evidence`). Trailers and evidence therefore have to
 * land together or not at all — attaching them afterwards, in a separate
 * commit or by rewriting pushed history, is not an option (Hive Mind's own
 * push guard refuses non-fast-forward pushes for routed tasks, issue #2164).
 *
 * The only place that can add files to a commit an agent is making, while it is
 * being made, is a git hook. Measured behaviour, from
 * `experiments/issue-2229/`:
 *
 *   - `pre-commit` is the only hook whose `git add` reaches the commit. It works
 *     for `git commit -m`, `git commit -a -m` and pathspec commits alike,
 *     because git points the hook at the temporary index it is building
 *     (`GIT_INDEX_FILE`).
 *   - `prepare-commit-msg` runs too late to stage anything, and — unlike
 *     `pre-commit` — is **not** skipped by `git commit --no-verify`. Adding the
 *     trailers there unconditionally would produce exactly the malformed commit
 *     described above, so the hook first checks that the evidence really is in
 *     the index it is about to commit.
 *   - a pathspec commit never updates the real index, so the evidence it
 *     committed would show up as a staged deletion afterwards and the next
 *     commit would remove it again. `post-commit` reconciles that, and it is
 *     the only safe place to: while `git commit -a`/pathspec runs, git holds
 *     `.git/index.lock`, so a second `git add` from `pre-commit` fails and, with
 *     `set -e`, takes the agent's commit down with it.
 *
 * All three hooks are fail-open. An agent that cannot attribute its work must
 * still be able to commit it.
 *
 * The hooks are delivered through `core.hooksPath` in the **agent process's own
 * environment**, not in the repository config. That keeps the blast radius
 * exactly right: commits made by the model are attributed, commits Hive Mind
 * makes on its own behalf (development log, auto-commit) are not, and the
 * routed-task push guard — which arrives the same way (issue #2164) — is
 * preserved by delegating to whatever hooks directory was in force.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2229
 * @see https://github.com/link-assistant/formal-ai/issues/1085
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The four trailers `scripts/self-hosting-metric.rs` reads. */
export const FORMAL_AI_TRAILER_KEYS = Object.freeze({
  session: 'Formal-AI-Session',
  model: 'Formal-AI-Model',
  evidence: 'Formal-AI-Evidence',
  pullRequest: 'Formal-AI-Pull-Request',
});

/** Where formal-ai keeps the bundles of its own authored work. */
export const FORMAL_AI_EVIDENCE_ROOT = 'dev/log/self-authored';

export const AGENT_STREAM_FILENAME = 'agent-stream.jsonl';
export const SESSION_ID_FILENAME = 'session-id.txt';
/** The hooks read the trailer block from here, so a late pull request URL still reaches later commits. */
export const TRAILERS_FILENAME = 'trailers.txt';
/** Lives inside `.git`, which git never reports and never commits. */
export const ATTRIBUTION_STAGING_DIRNAME = 'hive-mind-formal-ai-attribution';

/** `https://github.com/<owner>/<repo>/pull/<n>` and nothing else. */
const CANONICAL_PULL_REQUEST_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9][0-9]*$/;

/**
 * Hosted models whose work must never be published as Formal AI's own.
 *
 * The issue asks for a session or evidence naming a hosted model to be rejected
 * with the reason printed. The check is deliberately narrow: it reads model and
 * provider identifiers, never free text, so an agent that merely *writes* the
 * word "claude" into a file does not disable its own attribution.
 */
export const HOSTED_MODEL_MARKERS = Object.freeze([
  { id: 'claude', pattern: /claude/i },
  { id: 'codex', pattern: /codex/i },
  { id: 'gemini', pattern: /gemini/i },
  { id: 'opencode', pattern: /opencode/i },
  { id: 'anthropic', pattern: /anthropic/i },
  { id: 'openai', pattern: /openai/i },
  { id: 'gpt', pattern: /\bgpt[-\d]/i },
  { id: 'qwen', pattern: /qwen/i },
  { id: 'grok', pattern: /grok/i },
]);

/** Fields agentic CLIs use to name the model that actually answered. */
const MODEL_IDENTITY_FIELDS = ['providerID', 'provider_id', 'providerId', 'provider', 'modelID', 'model_id', 'modelId', 'model'];

/** @returns {string|null} the hosted model named by `value`, if any. */
export const detectHostedModel = value => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text) return null;
  const marker = HOSTED_MODEL_MARKERS.find(({ pattern }) => pattern.test(text));
  return marker ? marker.id : null;
};

/** Model/provider identifiers carried by one Agent CLI stream record. */
export const collectModelIdentities = record => {
  if (!record || typeof record !== 'object') return [];
  const containers = [record, record.part, record.message, record.info, record.data].filter(value => value && typeof value === 'object');
  const identities = [];
  for (const container of containers) {
    for (const field of MODEL_IDENTITY_FIELDS) {
      const value = container[field];
      if (typeof value === 'string' && value) identities.push(value);
    }
  }
  return identities;
};

/**
 * The evidence directory for a run, relative to the repository root.
 *
 * formal-ai's own `scripts/author-change-with-formal-ai.sh` writes to
 * `dev/log/self-authored/issue-<n>/evidence`, so a Hive Mind run against a
 * formal-ai issue lands in the same place its manual workflow uses.
 */
export const buildEvidenceDirectory = ({ issueNumber, prNumber, sessionId } = {}) => {
  const issue = Number.parseInt(issueNumber, 10);
  if (Number.isInteger(issue) && issue > 0) return `${FORMAL_AI_EVIDENCE_ROOT}/issue-${issue}/evidence`;
  const pull = Number.parseInt(prNumber, 10);
  if (Number.isInteger(pull) && pull > 0) return `${FORMAL_AI_EVIDENCE_ROOT}/pull-${pull}/evidence`;
  const slug = String(sessionId || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (slug) return `${FORMAL_AI_EVIDENCE_ROOT}/session-${slug}/evidence`;
  return null;
};

/**
 * The metric's `validate_evidence_path`, mirrored so a bad path is caught here
 * rather than as a red release gate in another repository.
 */
export const validateEvidencePath = evidencePath => {
  const value = String(evidencePath ?? '');
  if (!value) return { valid: false, reason: 'evidence path is empty' };
  if (value.includes(':') || value.includes('\n')) return { valid: false, reason: `evidence path must not contain ':' or a newline: ${value}` };
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return { valid: false, reason: `evidence path must be repository-relative: ${value}` };
  const segments = value.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return { valid: false, reason: `evidence path must be a normal path: ${value}` };
  return { valid: true, reason: null };
};

export const isCanonicalPullRequestUrl = url => CANONICAL_PULL_REQUEST_URL.test(String(url ?? ''));

/** `formal-ai/<version>`, the value of the `Formal-AI-Model` trailer. */
export const buildModelTrailerValue = version => `formal-ai/${String(version || '').trim()}`;

/**
 * The `session-id.txt` the metric reads. The two lines are the ones formal-ai's
 * own script writes, and the session id has to appear verbatim: the metric
 * requires some committed evidence file to contain the id from the trailer.
 */
export const buildSessionEvidence = ({ sessionId, version }) => `formal-ai session ${sessionId}\nformal-ai model ${buildModelTrailerValue(version)}\n`;

/**
 * @returns {{trailers: string[], errors: string[]}} the trailer block, plus
 * every reason it is not complete. A missing pull request URL is not an error:
 * the metric only needs it for release-loop proof, and Hive Mind learns it
 * before the agent starts in the normal flow but not in every flow.
 */
export const buildAttributionTrailers = ({ sessionId, version, evidencePath, prUrl } = {}) => {
  const errors = [];
  const trailers = [];

  const hostedInSession = detectHostedModel(sessionId);
  if (hostedInSession) errors.push(`session ${sessionId} names the hosted model ${hostedInSession}`);
  if (!sessionId) errors.push('no Agent CLI session id was observed');
  if (!version) errors.push('formal-ai --version did not report a version');

  const pathCheck = validateEvidencePath(evidencePath);
  if (!pathCheck.valid) errors.push(pathCheck.reason);

  if (errors.length > 0) return { trailers, errors };

  trailers.push(`${FORMAL_AI_TRAILER_KEYS.session}: ${sessionId}`);
  trailers.push(`${FORMAL_AI_TRAILER_KEYS.model}: ${buildModelTrailerValue(version)}`);
  trailers.push(`${FORMAL_AI_TRAILER_KEYS.evidence}: ${evidencePath}`);
  if (prUrl) {
    if (isCanonicalPullRequestUrl(prUrl)) trailers.push(`${FORMAL_AI_TRAILER_KEYS.pullRequest}: ${prUrl}`);
    else errors.push(`pull request URL is not canonical: ${prUrl}`);
  }

  return { trailers, errors };
};

/**
 * Read trailers the way the metric does rather than the way git does.
 *
 * `git interpret-trailers --parse` only looks at the last paragraph, so a blank
 * line between two trailers hides everything above it — the exact shape that
 * broke formal-ai's release once (issue #796). Indented lines are still not
 * trailers, so a commit message may quote one as an example.
 */
export const parseCommitTrailers = message => {
  const values = {};
  for (const line of String(message ?? '').split('\n')) {
    if (/^[ \t]/.test(line)) continue;
    const match = line.trim().match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    (values[key] = values[key] || []).push(match[2].trim());
  }
  return values;
};

const SAFE_SHELL_WORD = /^[A-Za-z0-9_\-./=:@+]+$/;

const shellQuote = value => {
  const text = String(value ?? '');
  if (text && SAFE_SHELL_WORD.test(text)) return text;
  return `'${text.replaceAll("'", `'\\''`)}'`;
};

/**
 * Run whatever hook was in force before Hive Mind pointed git here.
 *
 * Without this, taking over `core.hooksPath` would silently disable the routed
 * task's `pre-push` guard (issue #2164) and any hook the repository installs
 * for itself (husky, lint-staged). The delegate runs first and its exit status
 * is preserved, so a hook that refuses a commit still refuses it.
 */
const delegateSnippet = ({ previousHooksDir, hookName }) => {
  if (!previousHooksDir) return '';
  const quoted = shellQuote(path.join(previousHooksDir, hookName));
  return `previous_hook=${quoted}\nif [ -x "$previous_hook" ]; then\n  "$previous_hook" "$@" || exit $?\nfi\n\n`;
};

const hookHeader = name => `#!/bin/sh
# Hive Mind Formal AI attribution hook (${name}), issue #2229.
# Generated file - edit src/formal-ai-attribution.lib.mjs instead.
# Fail-open by construction: every failure path exits 0 so that an agent whose
# work cannot be attributed can still commit it.
`;

/**
 * `pre-commit`: put the evidence bundle into the commit being made.
 *
 * Skipped for merges (attributing a merge of somebody else's commits to the
 * model would be a lie) and for commits that stage nothing else (evidence rides
 * along with a change, it does not manufacture one).
 */
export const buildPreCommitHook = ({ stagingDir, evidencePath, previousHooksDir = null }) => `${hookHeader('pre-commit')}
${delegateSnippet({ previousHooksDir, hookName: 'pre-commit' })}staging=${shellQuote(stagingDir)}
evidence=${shellQuote(evidencePath)}

[ -f "$staging/${SESSION_ID_FILENAME}" ] || exit 0
[ -e "$(git rev-parse --git-path MERGE_HEAD 2>/dev/null)" ] && exit 0
[ -z "$(git diff --cached --name-only -- . ":(exclude)$evidence" 2>/dev/null)" ] && exit 0

mkdir -p "$evidence" 2>/dev/null || exit 0
cp "$staging/${SESSION_ID_FILENAME}" "$evidence/${SESSION_ID_FILENAME}" 2>/dev/null || exit 0
if [ -f "$staging/${AGENT_STREAM_FILENAME}" ]; then
  cp "$staging/${AGENT_STREAM_FILENAME}" "$evidence/${AGENT_STREAM_FILENAME}" 2>/dev/null || true
fi
# -f because the bundle is listed in .git/info/exclude until it is tracked, so
# that a commit the agent abandons leaves no untracked residue behind (#2135).
git add -f -- "$evidence" >/dev/null 2>&1
exit 0
`;

/**
 * `prepare-commit-msg`: add the trailers, but only to a commit that really
 * carries the matching evidence.
 *
 * The staged bundle is compared with the staging copy byte for byte. That is
 * what makes `git commit --no-verify` safe: it skips `pre-commit`, so no
 * evidence is staged, so no trailer is written, so the commit is merely
 * unattributed instead of malformed.
 */
export const buildPrepareCommitMsgHook = ({ stagingDir, evidencePath, previousHooksDir = null }) => `${hookHeader('prepare-commit-msg')}
${delegateSnippet({ previousHooksDir, hookName: 'prepare-commit-msg' })}staging=${shellQuote(stagingDir)}
evidence=${shellQuote(evidencePath)}
message_file="$1"

[ -n "$message_file" ] || exit 0
[ -f "$staging/${TRAILERS_FILENAME}" ] || exit 0
[ -f "$staging/${SESSION_ID_FILENAME}" ] || exit 0
[ -e "$(git rev-parse --git-path MERGE_HEAD 2>/dev/null)" ] && exit 0

staged_evidence="$(git cat-file blob ":$evidence/${SESSION_ID_FILENAME}" 2>/dev/null || true)"
[ -n "$staged_evidence" ] || exit 0
[ "$staged_evidence" = "$(cat "$staging/${SESSION_ID_FILENAME}")" ] || exit 0

work="$(mktemp 2>/dev/null)" || exit 0
cp "$message_file" "$work" 2>/dev/null || { rm -f "$work"; exit 0; }
while IFS= read -r trailer; do
  [ -n "$trailer" ] || continue
  # --if-exists replace keeps \`git commit --amend\` idempotent.
  git interpret-trailers --in-place --if-exists replace --trailer "$trailer" "$work" >/dev/null 2>&1 || { rm -f "$work"; exit 0; }
done < "$staging/${TRAILERS_FILENAME}"
cp "$work" "$message_file" 2>/dev/null || true
rm -f "$work"
exit 0
`;

/**
 * `post-commit`: put the evidence into the real index after a commit that used
 * a temporary one, so `git status` is clean and the next commit does not delete
 * what this one just recorded.
 */
export const buildPostCommitHook = ({ evidencePath, previousHooksDir = null }) => `${hookHeader('post-commit')}
${delegateSnippet({ previousHooksDir, hookName: 'post-commit' })}evidence=${shellQuote(evidencePath)}

git cat-file -e "HEAD:$evidence/${SESSION_ID_FILENAME}" 2>/dev/null || exit 0
git diff --cached --quiet -- "$evidence" 2>/dev/null && exit 0
git add -f -- "$evidence" >/dev/null 2>&1
exit 0
`;

/** A stub for a hook Hive Mind has no opinion about, so the previous one keeps running. */
export const buildDelegatingHook = ({ previousHooksDir, hookName }) => `${hookHeader(hookName)}
exec ${shellQuote(path.join(previousHooksDir, hookName))} "$@"
`;

/**
 * Write the hook directory for one session.
 *
 * @returns {{installed: boolean, hooksDir: string, previousHooksDir: string|null, hooks: string[], error: string|null}}
 */
export const installAttributionHooks = ({ hooksDir, stagingDir, evidencePath, previousHooksDir = null, fsImpl = fs }) => {
  const hooks = {
    'pre-commit': buildPreCommitHook({ stagingDir, evidencePath, previousHooksDir }),
    'prepare-commit-msg': buildPrepareCommitMsgHook({ stagingDir, evidencePath, previousHooksDir }),
    'post-commit': buildPostCommitHook({ evidencePath, previousHooksDir }),
  };

  try {
    fsImpl.mkdirSync(hooksDir, { recursive: true });

    if (previousHooksDir && fsImpl.existsSync(previousHooksDir)) {
      for (const entry of fsImpl.readdirSync(previousHooksDir)) {
        if (entry.endsWith('.sample') || hooks[entry]) continue;
        const source = path.join(previousHooksDir, entry);
        let executable = false;
        try {
          executable = Boolean(fsImpl.statSync(source).mode & 0o111);
        } catch {
          executable = false;
        }
        if (!executable) continue;
        hooks[entry] = buildDelegatingHook({ previousHooksDir, hookName: entry });
      }
    }

    for (const [name, script] of Object.entries(hooks)) {
      const hookPath = path.join(hooksDir, name);
      fsImpl.writeFileSync(hookPath, script, { mode: 0o755 });
      // writeFileSync only honours `mode` when it creates the file.
      fsImpl.chmodSync(hookPath, 0o755);
    }

    return { installed: true, hooksDir, previousHooksDir, hooks: Object.keys(hooks), error: null };
  } catch (error) {
    return { installed: false, hooksDir, previousHooksDir, hooks: [], error: error?.message || String(error) };
  }
};

/** Read git's `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` form back into pairs. */
export const parseGitConfigEnv = (env = {}) => {
  const count = Number.parseInt(env.GIT_CONFIG_COUNT, 10);
  if (!Number.isInteger(count) || count <= 0) return [];
  const entries = [];
  for (let index = 0; index < count; index++) {
    const key = env[`GIT_CONFIG_KEY_${index}`];
    if (!key) continue;
    entries.push([key, env[`GIT_CONFIG_VALUE_${index}`] ?? '']);
  }
  return entries;
};

/**
 * Point one child process's git at the attribution hooks.
 *
 * Environment config outranks every config file, so this also wins inside a
 * routed task, whose `core.hooksPath` already arrives this way (issue #2164) —
 * that entry is replaced rather than appended, and the guard it pointed at is
 * preserved by the delegating `pre-push` stub.
 */
export const buildAttributionGitEnv = ({ env = {}, hooksPath }) => {
  const entries = parseGitConfigEnv(env).filter(([key]) => key.toLowerCase() !== 'core.hookspath');
  entries.push(['core.hooksPath', hooksPath]);
  const result = { GIT_CONFIG_COUNT: String(entries.length) };
  entries.forEach(([key, value], index) => {
    result[`GIT_CONFIG_KEY_${index}`] = key;
    result[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return result;
};

const defaultRunGit = async (args, { cwd, env = process.env } = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    return { code: error?.code ?? 1, stdout: String(error?.stdout ?? ''), stderr: String(error?.stderr ?? error?.message ?? '') };
  }
};

/**
 * The publication boundary for the Agent CLI stream.
 *
 * The stream is committed and pushed, so it is outbound content and goes
 * through the same fail-closed sanitizer as every other published payload. It
 * is imported lazily because the sanitizer pulls in Secretlint, which callers
 * that only build trailers should not have to load.
 */
const defaultSanitize = async text => {
  const { sanitizeForPublication } = await import('./token-sanitization.lib.mjs');
  return await sanitizeForPublication(text);
};

const REDACTED_RECORD = `${JSON.stringify({ type: 'hive-mind.redacted', reason: 'credential sanitization blocked this batch of Agent CLI records' })}\n`;

/**
 * One `--model formal-ai` run's attribution.
 *
 * Lifecycle, as `agent.lib.mjs` drives it:
 *
 *   prepare()             before the CLI starts — hooks, staging, git env
 *   noteSessionId(id)     when the CLI reports its session — the bundle becomes
 *                         real and commits start carrying trailers
 *   recordStreamEvent(r)  for every stream record
 *   finalize()            after the CLI exits — final flush, then a report that
 *                         applies the metric's own rules to what was committed
 */
export const createFormalAiAttributionSession = ({ repositoryPath, issueNumber = null, prNumber = null, prUrl = null, version = null, model = null, tool = null, log = async () => {}, env = process.env, fsImpl = fs, runGit = defaultRunGit, sanitize = defaultSanitize, flushRecordThreshold = 25 } = {}) => {
  const state = {
    enabled: false,
    prepared: false,
    rejection: null,
    sessionId: null,
    prUrl: isCanonicalPullRequestUrl(prUrl) ? prUrl : null,
    evidencePath: null,
    stagingDir: null,
    hooksDir: null,
    gitEnv: {},
    pending: [],
    written: 0,
    committedRecords: 0,
    streamPath: null,
  };

  if (prUrl && !state.prUrl) {
    // Not fatal: the trailer is simply omitted rather than written wrong.
    state.pullRequestWarning = `pull request URL is not canonical and will not be recorded: ${prUrl}`;
  }

  const git = async args => await runGit(args, { cwd: repositoryPath, env });

  const reject = async reason => {
    state.rejection = reason;
    state.enabled = false;
    // Removing the session file is what actually stops the hooks: both of them
    // exit early without it, so no further commit can be attributed.
    try {
      if (state.stagingDir) fsImpl.rmSync(path.join(state.stagingDir, SESSION_ID_FILENAME), { force: true });
      if (state.stagingDir) fsImpl.rmSync(path.join(state.stagingDir, TRAILERS_FILENAME), { force: true });
    } catch {
      // The hooks are fail-open anyway; nothing here is worth failing a run over.
    }
    await log(`🛑 Formal AI attribution disabled: ${reason}`, { level: 'warning' });
  };

  const writeBundle = async () => {
    if (!state.sessionId || !state.enabled) return;
    const { trailers, errors } = buildAttributionTrailers({
      sessionId: state.sessionId,
      version,
      evidencePath: state.evidencePath,
      prUrl: state.prUrl,
    });
    if (errors.length > 0) {
      await reject(errors.join('; '));
      return;
    }
    fsImpl.writeFileSync(path.join(state.stagingDir, TRAILERS_FILENAME), `${trailers.join('\n')}\n`, 'utf8');
    fsImpl.writeFileSync(path.join(state.stagingDir, SESSION_ID_FILENAME), buildSessionEvidence({ sessionId: state.sessionId, version }), 'utf8');
  };

  const flush = async () => {
    if (!state.enabled || state.pending.length === 0) return;
    const batch = state.pending.splice(0, state.pending.length);
    const text = batch.map(record => `${JSON.stringify(record)}\n`).join('');
    let payload;
    try {
      payload = await sanitize(text);
    } catch (error) {
      payload = REDACTED_RECORD;
      await log(`⚠️  Formal AI evidence: ${batch.length} Agent CLI records were withheld from the bundle (${error?.message || error})`, { level: 'warning' });
    }
    try {
      fsImpl.appendFileSync(state.streamPath, payload, 'utf8');
      state.written += batch.length;
    } catch (error) {
      await log(`⚠️  Formal AI evidence: could not append to ${state.streamPath}: ${error?.message || error}`, { level: 'warning' });
    }
  };

  return {
    get enabled() {
      return state.enabled;
    },
    get sessionId() {
      return state.sessionId;
    },
    get evidencePath() {
      return state.evidencePath;
    },
    get stagingDir() {
      return state.stagingDir;
    },
    get hooksDir() {
      return state.hooksDir;
    },
    get gitEnv() {
      return { ...state.gitEnv };
    },
    get rejection() {
      return state.rejection;
    },

    /**
     * Install the hooks and hand back the environment the agent must run with.
     *
     * @returns {Promise<{enabled: boolean, reason: string|null, env: Record<string,string>}>}
     */
    async prepare() {
      if (state.prepared) return { enabled: state.enabled, reason: state.rejection, env: this.gitEnv };
      state.prepared = true;

      const hostedTool = detectHostedModel(model) || detectHostedModel(tool);
      if (hostedTool) {
        state.rejection = `--model ${model} / --tool ${tool} names the hosted model ${hostedTool}, which must not be published as Formal AI's own work`;
        await log(`🛑 Formal AI attribution not enabled: ${state.rejection}`, { level: 'warning' });
        return { enabled: false, reason: state.rejection, env: {} };
      }

      if (!version) {
        state.rejection = 'formal-ai --version did not report a version, so Formal-AI-Model cannot be recorded';
        await log(`🛑 Formal AI attribution not enabled: ${state.rejection}`, { level: 'warning' });
        return { enabled: false, reason: state.rejection, env: {} };
      }

      const evidencePath = buildEvidenceDirectory({ issueNumber, prNumber });
      const pathCheck = validateEvidencePath(evidencePath);
      if (!pathCheck.valid) {
        state.rejection = pathCheck.reason;
        await log(`🛑 Formal AI attribution not enabled: ${state.rejection}`, { level: 'warning' });
        return { enabled: false, reason: state.rejection, env: {} };
      }
      state.evidencePath = evidencePath;

      const gitDirResult = await git(['rev-parse', '--absolute-git-dir']);
      if (gitDirResult.code !== 0) {
        state.rejection = `not a git repository: ${repositoryPath}`;
        await log(`🛑 Formal AI attribution not enabled: ${state.rejection}`, { level: 'warning' });
        return { enabled: false, reason: state.rejection, env: {} };
      }
      const gitDir = gitDirResult.stdout.trim();

      const hooksPathResult = await git(['rev-parse', '--git-path', 'hooks']);
      const rawHooksPath = hooksPathResult.code === 0 ? hooksPathResult.stdout.trim() : '';
      const previousHooksDir = rawHooksPath ? path.resolve(repositoryPath, rawHooksPath) : null;

      state.stagingDir = path.join(gitDir, ATTRIBUTION_STAGING_DIRNAME);
      state.hooksDir = path.join(state.stagingDir, 'hooks');
      state.streamPath = path.join(state.stagingDir, AGENT_STREAM_FILENAME);

      try {
        fsImpl.mkdirSync(state.stagingDir, { recursive: true });
        // A fresh bundle per run: a stale stream from an earlier iteration must
        // not be published as evidence for this session.
        fsImpl.rmSync(state.streamPath, { force: true });
        fsImpl.rmSync(path.join(state.stagingDir, SESSION_ID_FILENAME), { force: true });
        fsImpl.rmSync(path.join(state.stagingDir, TRAILERS_FILENAME), { force: true });
        fsImpl.writeFileSync(state.streamPath, '', 'utf8');
      } catch (error) {
        state.rejection = `could not prepare ${state.stagingDir}: ${error?.message || error}`;
        await log(`🛑 Formal AI attribution not enabled: ${state.rejection}`, { level: 'warning' });
        return { enabled: false, reason: state.rejection, env: {} };
      }

      const installed = installAttributionHooks({
        hooksDir: state.hooksDir,
        stagingDir: state.stagingDir,
        evidencePath: state.evidencePath,
        previousHooksDir: previousHooksDir && previousHooksDir !== state.hooksDir ? previousHooksDir : null,
        fsImpl,
      });
      if (!installed.installed) {
        state.rejection = `could not install attribution hooks: ${installed.error}`;
        await log(`🛑 Formal AI attribution not enabled: ${state.rejection}`, { level: 'warning' });
        return { enabled: false, reason: state.rejection, env: {} };
      }

      await ensureEvidenceExcluded({ gitDir, evidencePath: state.evidencePath, fsImpl });

      state.gitEnv = buildAttributionGitEnv({ env, hooksPath: state.hooksDir });
      state.enabled = true;

      await log(`🧾 Formal AI attribution enabled (${buildModelTrailerValue(version)})`);
      await log(`   Evidence bundle: ${state.evidencePath}`, { verbose: true });
      await log(`   Commit hooks:    ${state.hooksDir}`, { verbose: true });
      if (previousHooksDir) await log(`   Delegating to:   ${previousHooksDir}`, { verbose: true });
      if (state.pullRequestWarning) await log(`⚠️  ${state.pullRequestWarning}`, { level: 'warning' });

      return { enabled: true, reason: null, env: this.gitEnv };
    },

    /** The Agent CLI reported its session id; from here on commits are attributable. */
    async noteSessionId(sessionId) {
      if (!state.enabled || !sessionId || state.sessionId) return;
      const hosted = detectHostedModel(sessionId);
      if (hosted) {
        await reject(`session ${sessionId} names the hosted model ${hosted}`);
        return;
      }
      state.sessionId = String(sessionId);
      await writeBundle();
      if (state.enabled) await log(`🧾 Formal AI evidence bundle armed for session ${state.sessionId}`, { verbose: true });
    },

    /** The pull request URL, once Hive Mind knows it. Later commits pick it up. */
    async setPullRequestUrl(url) {
      if (!isCanonicalPullRequestUrl(url) || state.prUrl === url) return;
      state.prUrl = url;
      await writeBundle();
    },

    /**
     * One Agent CLI stream record.
     *
     * The identity check runs on every record, not just the first: a CLI that
     * silently falls back to another provider mid-session must not have that
     * work published as Formal AI's own.
     */
    async recordStreamEvent(record) {
      if (!state.enabled) return;
      for (const identity of collectModelIdentities(record)) {
        const hosted = detectHostedModel(identity);
        if (hosted) {
          await reject(`the Agent CLI stream reports ${identity}, a hosted ${hosted} model`);
          return;
        }
      }
      state.pending.push(record);
      if (state.pending.length >= flushRecordThreshold) await flush();
    },

    async flush() {
      await flush();
    },

    /**
     * Report what was actually committed, applying the metric's rules.
     *
     * @param {{branchName?: string, baseRef?: string}} options
     */
    async verify({ branchName = 'HEAD', baseRef = null } = {}) {
      const range = baseRef ? `${baseRef}..${branchName}` : branchName;
      const listed = await git(['rev-list', '--no-merges', range]);
      if (listed.code !== 0) return { attributed: [], malformed: [], checked: 0 };

      const commits = listed.stdout.split('\n').filter(Boolean);
      const attributed = [];
      const malformed = [];

      for (const commit of commits) {
        const body = await git(['show', '-s', '--format=%B', commit]);
        if (body.code !== 0) continue;
        const trailers = parseCommitTrailers(body.stdout);
        const sessions = trailers[FORMAL_AI_TRAILER_KEYS.session.toLowerCase()] || [];
        const evidencePaths = trailers[FORMAL_AI_TRAILER_KEYS.evidence.toLowerCase()] || [];
        if (sessions.length === 0 && evidencePaths.length === 0) continue;

        if (sessions.length === 0 || evidencePaths.length === 0) {
          malformed.push({ commit, reason: `records only one of ${FORMAL_AI_TRAILER_KEYS.session}/${FORMAL_AI_TRAILER_KEYS.evidence}` });
          continue;
        }

        let ok = true;
        for (const evidence of evidencePaths) {
          const check = validateEvidencePath(evidence);
          if (!check.valid) {
            malformed.push({ commit, reason: check.reason });
            ok = false;
            break;
          }
          const files = await git(['ls-tree', '-r', '--name-only', commit, '--', evidence]);
          const names = files.code === 0 ? files.stdout.split('\n').filter(Boolean) : [];
          if (names.length === 0) {
            malformed.push({ commit, reason: `evidence ${evidence} is not present in the commit` });
            ok = false;
            break;
          }
          let identifies = false;
          let recordsSession = false;
          for (const name of names) {
            const content = await git(['show', `${commit}:${name}`]);
            if (content.code !== 0) continue;
            if (content.stdout.toLowerCase().includes('formal-ai')) identifies = true;
            if (sessions.every(session => content.stdout.includes(session))) recordsSession = true;
          }
          if (!identifies) {
            malformed.push({ commit, reason: `evidence ${evidence} does not identify formal-ai` });
            ok = false;
            break;
          }
          if (!recordsSession) {
            malformed.push({ commit, reason: `evidence ${evidence} does not record session ${sessions.join(', ')}` });
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        attributed.push({
          commit,
          session: sessions[0],
          evidence: evidencePaths[0],
          model: (trailers[FORMAL_AI_TRAILER_KEYS.model.toLowerCase()] || [])[0] || null,
          pullRequest: (trailers[FORMAL_AI_TRAILER_KEYS.pullRequest.toLowerCase()] || [])[0] || null,
        });
      }

      return { attributed, malformed, checked: commits.length };
    },

    /**
     * Add `Formal-AI-Pull-Request` to attributed commits that were made before
     * the pull request existed.
     *
     * Deliberately narrow, because rewriting history is how attribution stops
     * being trustworthy: only commits that are not yet on the remote, only when
     * none of them is a merge or signed, and only by rebuilding them with
     * `git commit-tree` so the trees, authorship and dates are byte-identical.
     * Anything unexpected leaves history untouched and says what it would have
     * needed.
     */
    async backfillPullRequestTrailer({ branchName, remote = 'origin' } = {}) {
      if (!state.enabled || !state.prUrl || !branchName) return { rewritten: 0, reason: 'nothing to backfill' };

      const upstream = `refs/remotes/${remote}/${branchName}`;
      const hasUpstream = await git(['rev-parse', '--verify', '--quiet', upstream]);
      if (hasUpstream.code !== 0) return { rewritten: 0, reason: `${upstream} does not exist, so the unpushed range is unknown` };

      const listed = await git(['rev-list', '--reverse', `${upstream}..${branchName}`]);
      if (listed.code !== 0) return { rewritten: 0, reason: 'could not list unpushed commits' };
      const commits = listed.stdout.split('\n').filter(Boolean);
      if (commits.length === 0) return { rewritten: 0, reason: 'no unpushed commits' };

      const needed = [];
      for (const commit of commits) {
        const body = await git(['show', '-s', '--format=%B', commit]);
        const trailers = parseCommitTrailers(body.stdout);
        const hasSession = (trailers[FORMAL_AI_TRAILER_KEYS.session.toLowerCase()] || []).length > 0;
        const hasPullRequest = (trailers[FORMAL_AI_TRAILER_KEYS.pullRequest.toLowerCase()] || []).length > 0;
        if (hasSession && !hasPullRequest) needed.push(commit);
      }
      if (needed.length === 0) return { rewritten: 0, reason: 'every attributed commit already records its pull request' };

      for (const commit of commits) {
        const shape = await git(['show', '-s', '--format=%P%x09%G?', commit]);
        const [parents, signature] = shape.stdout.trim().split('\t');
        if ((parents || '').trim().split(/\s+/).filter(Boolean).length > 1) return { rewritten: 0, reason: `the unpushed range contains merge commit ${commit}` };
        if (signature && signature !== 'N') return { rewritten: 0, reason: `the unpushed range contains signed commit ${commit}` };
      }

      const oldTip = (await git(['rev-parse', branchName])).stdout.trim();
      let parent = (await git(['rev-parse', upstream])).stdout.trim();

      for (const commit of commits) {
        const details = await git(['show', '-s', '--format=%an%x09%ae%x09%aI%x09%cn%x09%ce%x09%cI', commit]);
        const [authorName, authorEmail, authorDate, committerName, committerEmail, committerDate] = details.stdout.trim().split('\t');
        const body = await git(['show', '-s', '--format=%B', commit]);
        let message = body.stdout;
        if (needed.includes(commit)) {
          // Through a file rather than stdin, so that an injected `runGit` only
          // ever has to implement one shape: (args, {cwd, env}).
          const scratch = path.join(state.stagingDir, 'backfill-message.txt');
          fsImpl.writeFileSync(scratch, message, 'utf8');
          const applied = await git(['interpret-trailers', '--in-place', '--if-exists', 'replace', '--trailer', `${FORMAL_AI_TRAILER_KEYS.pullRequest}: ${state.prUrl}`, scratch]);
          if (applied.code !== 0) return { rewritten: 0, reason: 'git interpret-trailers refused the pull request trailer' };
          message = fsImpl.readFileSync(scratch, 'utf8');
          fsImpl.rmSync(scratch, { force: true });
        }
        const tree = (await git(['rev-parse', `${commit}^{tree}`])).stdout.trim();
        const created = await runGit(['commit-tree', tree, '-p', parent, '-m', message], {
          cwd: repositoryPath,
          env: {
            ...env,
            GIT_AUTHOR_NAME: authorName,
            GIT_AUTHOR_EMAIL: authorEmail,
            GIT_AUTHOR_DATE: authorDate,
            GIT_COMMITTER_NAME: committerName,
            GIT_COMMITTER_EMAIL: committerEmail,
            GIT_COMMITTER_DATE: committerDate,
          },
        });
        if (created.code !== 0) return { rewritten: 0, reason: `git commit-tree failed for ${commit}: ${created.stderr.trim()}` };
        parent = created.stdout.trim();
      }

      const updated = await git(['update-ref', `refs/heads/${branchName}`, parent, oldTip]);
      if (updated.code !== 0) return { rewritten: 0, reason: `git update-ref refused the rewrite: ${updated.stderr.trim()}` };

      await log(`🧾 Recorded ${FORMAL_AI_TRAILER_KEYS.pullRequest} on ${needed.length} unpushed commit(s)`);
      return { rewritten: needed.length, reason: null };
    },

    /** Final flush plus the report. */
    async finalize({ branchName = null, baseRef = null, remote = 'origin' } = {}) {
      if (!state.enabled) return { enabled: false, reason: state.rejection, attributed: [], malformed: [] };

      await flush();

      if (!state.sessionId) {
        await log('⚠️  Formal AI attribution: the Agent CLI never reported a session id, so no commit could be attributed', { level: 'warning' });
        return { enabled: true, reason: 'no session id', attributed: [], malformed: [] };
      }

      if (branchName) await this.backfillPullRequestTrailer({ branchName, remote });

      const report = await this.verify({ branchName: branchName || 'HEAD', baseRef });
      if (report.attributed.length > 0) {
        await log(`🧾 Formal AI attributed ${report.attributed.length} commit(s) to ${buildModelTrailerValue(version)} (session ${state.sessionId})`);
        for (const entry of report.attributed) {
          await log(`   ${entry.commit.slice(0, 8)} → ${entry.evidence}${entry.pullRequest ? '' : ' (no pull request trailer)'}`, { verbose: true });
        }
      } else {
        await log('ℹ️  Formal AI attribution: no commit carried the evidence bundle (the model may not have committed anything)');
      }
      for (const entry of report.malformed) {
        await log(`⚠️  Commit ${entry.commit.slice(0, 8)} would fail formal-ai's metric: ${entry.reason}`, { level: 'warning' });
      }

      return { enabled: true, reason: null, ...report, sessionId: state.sessionId, records: state.written };
    },
  };
};

/**
 * Keep the bundle out of `git status` until it is committed.
 *
 * A commit that is aborted (or made with `--no-verify`) leaves the copied files
 * in the working tree. Untracked residue is what restarts a solve run forever
 * (issue #2135), and `.git/info/exclude` is local to the clone, so it never
 * reaches the pull request. `git add -f` in the hooks overrides it.
 */
export const ensureEvidenceExcluded = async ({ gitDir, evidencePath, fsImpl = fs }) => {
  const excludePath = path.join(gitDir, 'info', 'exclude');
  const entry = `/${evidencePath}/`;
  const header = '# hive-mind: Formal AI evidence bundle, committed explicitly (issue #2229)';
  try {
    let existing = '';
    try {
      existing = fsImpl.readFileSync(excludePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') return { applied: false, reason: error.message };
    }
    const lines = new Set(
      existing
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    );
    if (lines.has(entry)) return { applied: true, reason: 'already_present' };
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    fsImpl.mkdirSync(path.dirname(excludePath), { recursive: true });
    fsImpl.writeFileSync(excludePath, `${existing}${separator}${header}\n${entry}\n`, 'utf8');
    return { applied: true, reason: null };
  } catch (error) {
    return { applied: false, reason: error?.message || String(error) };
  }
};

export default {
  buildAttributionGitEnv,
  buildAttributionTrailers,
  buildEvidenceDirectory,
  buildModelTrailerValue,
  buildPostCommitHook,
  buildPreCommitHook,
  buildPrepareCommitMsgHook,
  buildSessionEvidence,
  collectModelIdentities,
  createFormalAiAttributionSession,
  detectHostedModel,
  ensureEvidenceExcluded,
  installAttributionHooks,
  isCanonicalPullRequestUrl,
  parseCommitTrailers,
  parseGitConfigEnv,
  validateEvidencePath,
  FORMAL_AI_EVIDENCE_ROOT,
  FORMAL_AI_TRAILER_KEYS,
};
