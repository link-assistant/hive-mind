/**
 * An in-memory GitHub, Git and task runner for the real E2E matrix (issue #3630).
 *
 * It answers the REST endpoints, `gh` commands and process launches the
 * production row runner, finalizer and fixture sweep use, with the shapes and
 * error messages GitHub and `gh` give. `runE2eRow`, `finalizeRow` and
 * `cleanupStaleFixtures` run unchanged against it, so the lifecycle matrix
 * exercises the same code as the live workflow without a token.
 *
 * - `api(endpoint, options)`, `list(endpoint)`, `ghJson(args)` and `gh(args)`
 *   replace the adapters in scripts/github-actions.lib.mjs;
 * - `exec(command, argv, options)` replaces spawning `docker` and `act`; the
 *   solve session is a scripted agent that pushes a branch and opens a pull
 *   request;
 * - `useReplay(fixture)` makes the session deliver what a recorded attempt
 *   delivered and act print the recorded act log (scripts/e2e-replay.lib.mjs);
 * - `fail({ method, match, message, times })` injects errors;
 * - `calls` records every request, so a test can prove what was (not) done.
 *
 * `installRealGitHubTripwire()` puts failing `gh`, `git`, `docker`, `act`,
 * `curl` and `wget` first on PATH, removes tokens and makes `fetch` throw:
 * any attempt to reach real GitHub is recorded and fails.
 *
 * @hive-mind-test-skip
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const httpError = (status, message) => Object.assign(new Error(`gh: ${message} (HTTP ${status})`), { status });
const notFound = () => httpError(404, 'Not Found');

/** The agent the solve session runs: what it pushes and how it ends. */
export const AGENTS = Object.freeze({
  /** A correct answer: program, staged workflow and a final pull request. */
  hello: { files: { 'src/main.rs': '// Run with cargo.\nfn main() {\n    println!("Hello, World!");\n}\n', 'ci/test-hello-world.yml': 'name: Test Hello World\non: [push, pull_request]\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: cargo run\n' }, title: 'Implement Hello World in Rust', body: 'Adds a Rust Hello World program and a workflow that runs it.\n\nFixes #{issue}', draft: false, exitCode: 0 },
  /** The model delivers, but the program prints the wrong text. */
  wrongOutput: { files: { 'src/main.rs': 'fn main() {\n    println!("Hello World");\n}\n', 'ci/test-hello-world.yml': 'name: Test\non: [pull_request]\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - run: cargo run\n' }, title: 'Implement Hello World in Rust', body: 'Hello World.\n\nFixes #{issue}', draft: false, exitCode: 0 },
  /** The session fails before it opens a pull request. */
  noPullRequest: { files: null, exitCode: 1 },
  /** The session never ends on its own: it is cancelled or the runner dies. */
  hang: { hang: true },
});

/** The unified diff GitHub reports for an added text file. */
const addedPatch = content => {
  const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
  return [`@@ -0,0 +1${lines.length === 1 ? '' : `,${lines.length}`} @@`, ...lines.map(line => `+${line}`), ...(content.endsWith('\n') ? [] : ['\\ No newline at end of file'])].join('\n');
};

/** Point a recorded delivery at the task this replay created. */
const renumber = (text, from, to) => (from ? String(text).replace(new RegExp(`(#|issue-|issues/)${from}\\b`, 'g'), `$1${to}`) : String(text));

let shaCounter = 0;
const nextSha = () => (++shaCounter).toString(16).padStart(40, '0');

/**
 * @param {object} [options]
 * @param {string} [options.repository]
 * @param {string} [options.formalAiVersion] what the task image reports
 * @param {string} [options.agent] a key of AGENTS
 * @param {() => Date} [options.now]
 */
export function createGitHubEmulator({ repository = 'link-assistant/hive-mind', formalAiVersion = '0.360.0', agent = 'hello', now = () => new Date('2026-10-21T12:00:00Z') } = {}) {
  const serverUrl = 'https://github.com';
  const state = {
    blobs: new Map(),
    trees: new Map(),
    commits: new Map(),
    refs: new Map(),
    issues: new Map(),
    pulls: new Map(),
    comments: new Map(),
    labels: new Set(),
    runs: new Map(),
    jobs: new Map(),
    runLogs: new Map(),
    artifacts: [],
    deletionRules: [],
    agent,
    replay: null,
    sessions: 0,
  };
  const calls = [];
  const faults = [];
  let nextNumber = 1;
  let nextCommentId = 1000;

  const take = (method, endpoint) => {
    const index = faults.findIndex(fault => (!fault.method || fault.method === method) && fault.match.test(endpoint));
    if (index === -1) return;
    const fault = faults[index];
    if (--fault.times <= 0) faults.splice(index, 1);
    throw typeof fault.message === 'function' ? fault.message() : new Error(fault.message);
  };
  const timestamp = () => now().toISOString();
  const filesOf = sha => (sha ? state.commits.get(sha)?.files || {} : {});
  const commit = ({ message, files, parents = [] }) => {
    const sha = nextSha();
    state.commits.set(sha, { sha, message, files, parents, date: timestamp() });
    return sha;
  };
  const issueView = issue => ({ ...issue, labels: issue.labels.map(name => ({ name })), comments: (state.comments.get(issue.number) || []).length });
  const pullView = pull => ({ number: pull.number, title: pull.title, body: pull.body, state: pull.state, draft: pull.draft, merged: false, html_url: pull.html_url, head: { ref: pull.head, sha: state.refs.get(pull.head) || pull.headSha, repo: { full_name: repository } }, base: { ref: pull.base, repo: { full_name: repository } } });

  function openPullRequest({ head, base, title, body, draft }) {
    const number = nextNumber++;
    const pull = { number, head, headSha: state.refs.get(head), base, title, body, draft, state: 'open', html_url: `${serverUrl}/${repository}/pull/${number}`, created_at: timestamp() };
    state.pulls.set(number, pull);
    state.issues.set(number, { number, title, body, state: 'open', state_reason: null, labels: [], html_url: pull.html_url, created_at: pull.created_at, pull_request: { url: pull.html_url } });
    return pull;
  }

  async function api(endpoint, { method = 'GET', body, paginate = false } = {}) {
    calls.push({ method, endpoint, body });
    take(method, endpoint);
    const url = new URL(endpoint, 'https://api.github.invalid/');
    const query = url.searchParams;
    const root = `/repos/${repository}`;
    if (!url.pathname.startsWith(root)) throw notFound();
    const path = url.pathname.slice(root.length);
    const page = items => (paginate ? [items] : items);
    let match;
    if (path === '' && method === 'GET') return { full_name: repository, default_branch: 'main', html_url: `${serverUrl}/${repository}` };
    if (path === '/git/blobs' && method === 'POST') {
      const sha = nextSha();
      state.blobs.set(sha, body.content);
      return { sha };
    }
    if (path === '/git/trees' && method === 'POST') {
      const sha = nextSha();
      state.trees.set(sha, Object.fromEntries(body.tree.map(entry => [entry.path, state.blobs.get(entry.sha)])));
      return { sha };
    }
    if (path === '/git/commits' && method === 'POST') {
      const sha = nextSha();
      state.commits.set(sha, { sha, message: body.message, files: state.trees.get(body.tree), parents: body.parents, date: timestamp() });
      return { sha, message: body.message };
    }
    if (path === '/git/refs' && method === 'POST') {
      const branch = body.ref.replace(/^refs\/heads\//, '');
      if (state.refs.has(branch)) throw httpError(422, 'Reference already exists');
      state.refs.set(branch, body.sha);
      return { ref: body.ref, object: { sha: body.sha } };
    }
    if ((match = path.match(/^\/git\/ref\/heads\/(.+)$/)) && method === 'GET') {
      if (!state.refs.has(match[1])) throw notFound();
      return { ref: `refs/heads/${match[1]}`, object: { sha: state.refs.get(match[1]) } };
    }
    if ((match = path.match(/^\/git\/refs\/heads\/(.+)$/)) && method === 'DELETE') {
      if (state.deletionRules.some(pattern => pattern.test(match[1]))) throw new Error('gh: Repository rule violations found\n\nCannot delete this branch\n\n (HTTP 422)');
      if (!state.refs.delete(match[1])) throw httpError(422, 'Reference does not exist');
      return null;
    }
    if ((match = path.match(/^\/git\/commits\/([0-9a-f]+)$/))) {
      const found = state.commits.get(match[1]);
      if (!found) throw notFound();
      return { sha: found.sha, message: found.message, committer: { date: found.date } };
    }
    if ((match = path.match(/^\/commits\/([0-9a-f]+)$/))) {
      const found = state.commits.get(match[1]);
      if (!found) throw notFound();
      return { sha: found.sha, commit: { message: found.message, committer: { date: found.date } } };
    }
    if (path === '/branches') return page([...state.refs].map(([name, sha]) => ({ name, commit: { sha } })));
    if ((match = path.match(/^\/rules\/branches\/(.+)$/))) return state.deletionRules.some(pattern => pattern.test(match[1])) ? [{ type: 'deletion', ruleset_source_type: 'Organization', ruleset_id: 1 }] : [];
    if (path === '/issues' && method === 'POST') {
      const number = nextNumber++;
      const issue = { number, title: body.title, body: body.body, state: 'open', state_reason: null, labels: body.labels || [], html_url: `${serverUrl}/${repository}/issues/${number}`, created_at: timestamp() };
      state.issues.set(number, issue);
      return issueView(issue);
    }
    if (path === '/issues' && method === 'GET') {
      const wanted = query.get('state') || 'open';
      const labels = (query.get('labels') || '').split(',').filter(Boolean);
      const issues = [...state.issues.values()].filter(issue => (wanted === 'all' || issue.state === wanted) && labels.every(label => issue.labels.includes(label))).sort((a, b) => b.number - a.number);
      return page(issues.map(issueView));
    }
    if ((match = path.match(/^\/issues\/(\d+)$/))) {
      const issue = state.issues.get(Number(match[1]));
      if (!issue) throw notFound();
      if (method === 'PATCH') {
        Object.assign(issue, body.state ? { state: body.state, state_reason: body.state_reason ?? (body.state === 'closed' ? 'completed' : null) } : {}, body.title ? { title: body.title } : {});
        if (state.pulls.has(issue.number) && body.state) state.pulls.get(issue.number).state = body.state;
      }
      return issueView(issue);
    }
    if ((match = path.match(/^\/issues\/(\d+)\/comments$/))) {
      const number = Number(match[1]);
      if (!state.issues.has(number)) throw notFound();
      const comments = state.comments.get(number) || [];
      if (method === 'POST') {
        const comment = { id: nextCommentId++, body: body.body, created_at: timestamp(), html_url: `${serverUrl}/${repository}/issues/${number}#issuecomment-${nextCommentId}` };
        state.comments.set(number, [...comments, comment]);
        return comment;
      }
      return page(comments);
    }
    if (path === '/pulls' && method === 'GET') {
      const wanted = query.get('state') || 'open';
      const base = query.get('base');
      return page([...state.pulls.values()].filter(pull => (wanted === 'all' || pull.state === wanted) && (!base || pull.base === base)).map(pullView));
    }
    if ((match = path.match(/^\/pulls\/(\d+)$/))) {
      const pull = state.pulls.get(Number(match[1]));
      if (!pull) throw notFound();
      if (method === 'PATCH' && body.state) {
        pull.state = body.state;
        state.issues.get(pull.number).state = body.state;
      }
      return pullView(pull);
    }
    if ((match = path.match(/^\/pulls\/(\d+)\/files$/))) {
      const pull = state.pulls.get(Number(match[1]));
      if (!pull) throw notFound();
      const head = filesOf(state.refs.get(pull.head) || pull.headSha);
      const base = filesOf(state.refs.get(pull.base));
      return page(
        Object.keys(head)
          .filter(file => head[file] !== base[file])
          .map(filename => ({ filename, status: filename in base ? 'modified' : 'added', ...(filename in base ? {} : { patch: addedPatch(head[filename]) }) }))
      );
    }
    if (path === '/actions/runs' && method === 'GET') {
      const sha = query.get('head_sha');
      return page({ total_count: 0, workflow_runs: [...state.runs.values()].filter(run => !sha || run.head_sha === sha) });
    }
    if ((match = path.match(/^\/actions\/runs\/(\d+)$/))) {
      const run = state.runs.get(match[1]);
      if (!run) throw notFound();
      return run;
    }
    if ((match = path.match(/^\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?\/jobs$/))) {
      const run = state.runs.get(match[1]);
      if (!run) throw notFound();
      return { total_count: 0, jobs: state.jobs.get(`${match[1]}/${match[2] || run.run_attempt}`) || [] };
    }
    if (path === '/actions/artifacts') {
      const artifacts = state.artifacts.filter(artifact => !query.get('name') || artifact.name === query.get('name'));
      return { total_count: artifacts.length, artifacts: artifacts.map(({ files: _files, ...artifact }) => artifact) };
    }
    throw notFound();
  }

  const list = async endpoint => (await api(endpoint, { paginate: true })).flat();

  async function gh(args) {
    calls.push({ method: 'GH', endpoint: args.join(' ') });
    take('GH', args.join(' '));
    const [command, subcommand] = args;
    if (command === 'label' && subcommand === 'create') {
      state.labels.add(args[2]);
      return '';
    }
    if (command === 'repo' && subcommand === 'clone') {
      const [, , , directory] = args;
      const branch = args[args.indexOf('--branch') + 1];
      if (!state.refs.has(branch)) throw new Error(`fatal: Remote branch ${branch} not found in upstream origin`);
      for (const [file, content] of Object.entries(filesOf(state.refs.get(branch)))) {
        mkdirSync(dirname(join(directory, file)), { recursive: true });
        writeFileSync(join(directory, file), content);
      }
      return '';
    }
    if (command === 'run' && subcommand === 'view') return state.runLogs.get(args[2]) || '';
    if (command === 'run' && subcommand === 'download') {
      const runId = args[2];
      const name = args[args.indexOf('--name') + 1];
      const directory = args[args.indexOf('--dir') + 1];
      const artifact = state.artifacts.find(candidate => String(candidate.workflow_run.id) === String(runId) && candidate.name === name);
      if (!artifact) throw new Error(`no artifact matches ${name}`);
      for (const [file, content] of Object.entries(artifact.files)) writeFileSync(join(directory, file), content);
      return '';
    }
    throw new Error(`emulator: unsupported gh ${args.join(' ')}`);
  }

  async function ghJson(args) {
    if (args[0] !== 'pr' || args[1] !== 'list') return JSON.parse(await gh(args));
    calls.push({ method: 'GH', endpoint: args.join(' ') });
    take('GH', args.join(' '));
    return [...state.pulls.values()].map(pull => ({ number: pull.number, headRefName: pull.head, isDraft: pull.draft, state: pull.state.toUpperCase(), title: pull.title, body: pull.body, url: pull.html_url, headRefOid: state.refs.get(pull.head) || pull.headSha, baseRefName: pull.base }));
  }

  /** The agent's session: push `issue-<n>-…` from the base branch and open a pull request. */
  async function solveSession(argv, { onData, signal }) {
    state.sessions += 1;
    const script = AGENTS[state.agent];
    const issueUrl = argv.find(arg => /\/issues\/\d+$/.test(arg));
    const issueNumber = Number(issueUrl.split('/').pop());
    const baseBranch = argv.includes('--base-branch') ? argv[argv.indexOf('--base-branch') + 1] : 'main';
    if (state.replay) return replaySession({ issueNumber, baseBranch, onData });
    onData(`[solve] working on ${issueUrl}\n`);
    if (script.hang)
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        if (signal?.aborted) abort();
        signal?.addEventListener('abort', abort, { once: true });
      });
    if (script.files) {
      const head = `issue-${issueNumber}-0123456789ab`;
      const files = { ...filesOf(state.refs.get(baseBranch)), ...script.files };
      state.refs.set(head, commit({ message: `Solve #${issueNumber}`, files, parents: [state.refs.get(baseBranch)].filter(Boolean) }));
      const pull = openPullRequest({ head, base: baseBranch, title: script.title, body: script.body.replace('{issue}', issueNumber), draft: script.draft });
      onData(`[solve] opened ${pull.html_url}\n`);
    }
    onData(`[solve] exit ${script.exitCode}\n`);
    return { code: script.exitCode, signal: null };
  }

  /** The recorded session: its log, the pull request it left and its exit status. */
  function replaySession({ issueNumber, baseBranch, onData }) {
    const { session, delivery, source } = state.replay;
    const map = text => renumber(text, source.issueNumber, issueNumber);
    if (session) onData(session.log.text);
    const recorded = delivery.pullRequest;
    if (recorded) {
      const head = map(recorded.headRefName);
      const files = { ...filesOf(state.refs.get(baseBranch)), ...Object.fromEntries(delivery.files.map(file => [file.path, file.content])) };
      state.refs.set(head, commit({ message: `Replay of ${state.replay.name}`, files, parents: [state.refs.get(baseBranch)].filter(Boolean) }));
      const pull = openPullRequest({ head, base: baseBranch, title: map(recorded.title), body: map(recorded.body), draft: recorded.isDraft });
      if (recorded.state === 'CLOSED') pull.state = state.issues.get(pull.number).state = 'closed';
      state.comments.set(
        pull.number,
        delivery.comments.map(body => ({ id: nextCommentId++, body: map(body), created_at: timestamp() }))
      );
    }
    return { code: session?.exitCode ?? 1, signal: null };
  }

  /** act runs the workflow in the cloned workspace: the program prints its string literal. */
  function actRun(argv, { onData }) {
    if (state.replay?.act) {
      onData(state.replay.act.log);
      return { code: state.replay.act.exitCode, signal: null };
    }
    const workspace = argv[argv.indexOf('--directory') + 1];
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
    const program = walk(workspace).find(file => /\.(rs|kt|scala)$/.test(file));
    const printed = program ? readFileSync(program, 'utf8').match(/println!?\("([^"]*)"\)/)?.[1] : null;
    onData(`${JSON.stringify({ level: 'info', job: 'run', msg: `  ☁  git clone of ${relative(tmpdir(), workspace)}` })}\n`);
    if (printed !== null && printed !== undefined) onData(`${JSON.stringify({ level: 'info', job: 'run', msg: `${printed}\n` })}\n`);
    onData(`${JSON.stringify({ level: 'info', job: 'run', msg: program ? '🏁  Job succeeded' : '❌  no program' })}\n`);
    return { code: program ? 0 : 1, signal: null };
  }

  async function exec(command, argv, options) {
    calls.push({ method: 'EXEC', endpoint: `${command} ${argv.slice(0, 6).join(' ')}` });
    take('EXEC', `${command} ${argv.join(' ')}`);
    if (options.signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    if (command === 'docker' && argv.includes('--version')) {
      options.onData(`formal-ai ${formalAiVersion}\n`);
      return { code: 0, signal: null };
    }
    if (command === 'docker' && argv[0] === 'image' && argv[1] === 'inspect') {
      options.onData('sha256:e2e0000000000000000000000000000000000000000000000000000000003630\n');
      return { code: 0, signal: null };
    }
    if (command === 'docker' && argv[0] === 'run') return solveSession(argv, options);
    if (command === 'act') return actRun(argv, options);
    throw new Error(`emulator: unsupported command ${command}`);
  }

  return {
    repository,
    state,
    calls,
    api,
    list,
    gh,
    ghJson,
    exec,
    deps: extra => ({ api, list, gh, ghJson, exec, stdout: { write: () => true }, lockWaitMs: 0, pollMs: 0, wait: async () => {}, sleep: async () => {}, ...extra }),
    fail: ({ method = null, match, message, times = 1 }) => faults.push({ method, match, message, times }),
    useAgent: name => {
      state.agent = name;
    },
    /** Deliver what a recorded attempt delivered (a fixture of scripts/e2e-replay.lib.mjs). */
    useReplay: fixture => {
      state.replay = fixture;
    },
    forbidDeletion: pattern => state.deletionRules.push(pattern),
    /** A workflow run of this repository, as the Actions API reports it. */
    setRun: (id, { status = 'completed', conclusion = 'success', runAttempt = 1, jobs = [] } = {}) => {
      state.runs.set(String(id), { id: Number(id), status, conclusion, run_attempt: runAttempt, html_url: `${serverUrl}/${repository}/actions/runs/${id}` });
      state.jobs.set(
        `${id}/${runAttempt}`,
        jobs.map((job, index) => ({ id: Number(id) * 100 + index, status: 'completed', ...job }))
      );
    },
    /** What `actions/upload-artifact` stores. */
    uploadArtifact: ({ runId, name, files }) => {
      state.artifacts.push({ id: state.artifacts.length + 1, name, expired: false, workflow_run: { id: Number(runId) }, files });
    },
    issues: () => [...state.issues.values()].filter(issue => !issue.pull_request),
    pulls: () => [...state.pulls.values()],
    commentsOf: number => (state.comments.get(number) || []).map(comment => comment.body),
    /** Requests that change GitHub: REST writes and `gh label create`. */
    mutations: () => calls.filter(call => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(call.method) || (call.method === 'GH' && call.endpoint.startsWith('label create'))),
  };
}

/**
 * Make any path to real GitHub fail loudly and leave a trace.
 *
 * @returns {{ invocations: () => string[], restore: () => void, binDir: string }}
 */
export function installRealGitHubTripwire() {
  const binDir = mkdtempSync(join(tmpdir(), 'hive-e2e-tripwire-'));
  const ledger = join(binDir, 'invocations.log');
  writeFileSync(ledger, '');
  for (const tool of ['gh', 'git', 'docker', 'act', 'curl', 'wget']) {
    const file = join(binDir, tool);
    writeFileSync(file, `#!/bin/sh\nprintf '%s %s\\n' "${tool}" "$*" >> "${ledger}"\necho "tripwire: real ${tool} called" >&2\nexit 97\n`);
    chmodSync(file, 0o755);
  }
  const saved = { PATH: process.env.PATH, fetch: globalThis.fetch, env: {} };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'AUTOMATION_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) {
    saved.env[name] = process.env[name];
    delete process.env[name];
  }
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  const fetched = [];
  globalThis.fetch = async input => {
    fetched.push(String(input?.url || input));
    throw new Error(`tripwire: fetch ${input} during an emulated test`);
  };
  return {
    binDir,
    invocations: () => [...readFileSync(ledger, 'utf8').split('\n').filter(Boolean), ...fetched.map(target => `fetch ${target}`)],
    reset: () => {
      writeFileSync(ledger, '');
      fetched.length = 0;
    },
    restore: () => {
      process.env.PATH = saved.PATH;
      globalThis.fetch = saved.fetch;
      for (const [name, value] of Object.entries(saved.env)) if (value !== undefined) process.env[name] = value;
    },
  };
}
