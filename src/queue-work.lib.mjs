/**
 * Work accounting for queue display and admission (#4021). A vendor service's
 * lifetime is not a task: app-server work is represented by live executions.
 * Process argv is used only for classification, never logged or returned.
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const TOOLS = ['claude', 'codex', 'agent', 'qwen', 'gemini'];
// Use actual subcommands per tool: e.g. `claude status` and `gemini login`
// are prompts, whereas `claude auth` and `codex login` are administration.
const SERVICES = {
  claude: new Set(['agents', 'attach', 'auth', 'auto-mode', 'doctor', 'gateway', 'import', 'install', 'logs', 'mcp', 'plugin', 'plugins', 'purge', 'respawn', 'rm', 'setup-token', 'stop', 'kill', 'update', 'upgrade']),
  codex: new Set(['agents', 'app-server', 'exec-server', 'remote-control', 'mcp', 'mcp-server', 'login', 'logout', 'plugin', 'completion', 'update', 'doctor', 'sandbox', 'debug', 'apply', 'a', 'queue', 'archive', 'delete', 'migrate-rollouts', 'migrate-nfs-db', 'unarchive', 'cloud', 'features', 'help']),
  agent: new Set(['auth', 'mcp', 'models']),
  qwen: new Set(['agents', 'attach', 'auth', 'autofix-pr', 'board', 'channel', 'extensions', 'hooks', 'mcp', 'memory', 'serve', 'daemon', 'sessions', 'update', 'managed-runtime-bootstrap', 'managed-runtime-bootstrap-worker']),
  gemini: new Set(['mcp', 'extensions', 'hooks', 'skills', 'policies']),
};
const HELPER_FLAGS = new Set(['--chrome-native-host', '--claude-in-chrome-mcp', '--mcp-server', '--experimental-acp', '--acp', '--version', '-v', '-V', '--help', '-h']);
const VALUE_FLAGS = new Set(['--model', '-m', '--config', '-c', '--profile', '--enable', '--disable', '--cd', '-C', '--sandbox', '--ask-for-approval', '-a', '--session-id', '--output-format', '--input-format', '--permission-mode', '--log-level', '--log-file']);

function invocation(record) {
  const argv = record.argv || [];
  let executable = basename(argv[0] || '');
  let offset = 1;
  if (/^(?:node|nodejs|bun)(?:\.exe)?$/.test(executable)) {
    // Only the script position identifies a CLI. A prompt mentioning a vendor
    // must never turn a shell, test runner or unrelated Node service into work.
    while (argv[offset]?.startsWith('-')) {
      if (['--require', '-r', '--import', '--loader'].includes(argv[offset])) offset++;
      offset++;
    }
    const script = argv[offset] || '';
    executable = basename(script).replace(/\.[cm]?js$/, '');
    if (/\/@anthropic-ai\/claude-code\/.*cli\.js$/.test(script)) executable = 'claude';
    if (/\/@google\/gemini-cli\/.*(?:index|gemini)\.js$/.test(script)) executable = 'gemini';
    if (/\/@qwen-code\/qwen-code\/.*cli(?:-entry)?\.js$/.test(script)) executable = 'qwen';
    if (/\/@link-assistant\/agent\/.*(?:index|cli)\.[cm]?js$/.test(script)) executable = 'agent';
    offset++;
  } else if (TOOLS.includes(record.commandName)) {
    // Native Claude installs run from a version-number path but keep comm=claude.
    executable = record.commandName;
  }
  return TOOLS.includes(executable) ? { tool: executable, args: argv.slice(offset) } : null;
}

function isForeground(tool, args) {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (HELPER_FLAGS.has(arg)) return false;
    // The remainder is prompt content, not command switches or subcommands.
    if (arg === '-p' || arg === '--prompt' || arg === '--') return true;
    if (VALUE_FLAGS.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return !SERVICES[tool].has(arg);
  }
  return true; // interactive CLI, possibly waiting for a response
}

function ancestors(record, byPid) {
  const ids = [];
  const seen = new Set();
  let current = record;
  while (current && !seen.has(current.pid)) {
    seen.add(current.pid);
    ids.push(current.pid);
    current = byPid.get(current.ppid);
  }
  return ids;
}

function screenKey(name) {
  return String(name || '').replace(/^\d+\./, '');
}

/** Collapse each foreground wrapper/native child tree into one job. */
export function classifyToolProcesses(records) {
  const byPid = new Map(records.map(record => [Number(record.pid), { ...record, pid: Number(record.pid), ppid: Number(record.ppid) }]));
  const candidates = new Map();
  for (const record of byPid.values()) {
    const cli = invocation(record);
    if (cli && !/^[ZX]/.test(record.state || '') && isForeground(cli.tool, cli.args)) candidates.set(record.pid, { ...record, tool: cli.tool });
  }
  const jobs = new Map();
  for (const record of candidates.values()) {
    const lineage = ancestors(record, byPid);
    const launcher = lineage.find(pid => (byPid.get(pid)?.argv || []).some((arg, index) => index < 2 && /^(?:solve|solve\.mjs)$/.test(basename(arg))));
    const root = launcher || lineage.filter(pid => candidates.get(pid)?.tool === record.tool).at(-1);
    const key = `${record.tool}:${root}`;
    const job = jobs.get(key) || { tool: record.tool, pid: root, pids: [], ancestorPids: [], screenSessionName: null };
    job.pids.push(record.pid);
    job.ancestorPids = [...new Set([...job.ancestorPids, ...lineage])];
    job.screenSessionName ||= screenKey(record.screenSessionName) || null;
    // A solve launcher's positional URL identifies in-flight queue work before
    // the detached-session registry is populated. Do not search prompt text.
    for (const pid of lineage) {
      const argv = byPid.get(pid)?.argv || [];
      const launchIndex = argv.findIndex((arg, index) => index < 2 && /^(?:solve|solve\.mjs)$/.test(basename(arg)));
      if (launchIndex >= 0) job.url ||= argv.slice(launchIndex + 1).find(arg => /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/\d+\/?$/.test(arg)) || null;
    }
    jobs.set(key, job);
  }
  return [...jobs.values()];
}

/** Read one Linux process snapshot for all tools, without spawning pgrep per tool. */
export async function readToolProcessSnapshot(verbose = false, { procRoot = '/proc' } = {}) {
  const records = [];
  try {
    const entries = await readdir(procRoot);
    // Sequential reads bound open files and memory on busy hosts.
    for (const pid of entries.filter(entry => /^\d+$/.test(entry))) {
      try {
        const dir = join(procRoot, pid);
        const stat = await readFile(join(dir, 'stat'), 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const argv = (await readFile(join(dir, 'cmdline'), 'utf8')).split('\0');
        if (argv.at(-1) === '') argv.pop();
        const commandName = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
        const record = { pid: Number(pid), ppid: Number(fields[1]), state: fields[0], commandName, argv };
        if (invocation(record)) {
          // STY joins screen-isolated work to its tracked execution. Never log
          // the environment, command line or a user's prompt.
          const env = await readFile(join(dir, 'environ'), 'utf8').catch(() => '');
          record.screenSessionName =
            env
              .split('\0')
              .find(value => value.startsWith('STY='))
              ?.slice(4) || null;
        }
        records.push(record);
      } catch {
        // Processes can exit between readdir and readFile; no stale PID count.
      }
    }
  } catch (error) {
    if (verbose) console.error('[VERBOSE] /queue process snapshot unavailable:', error.message);
  }
  const jobs = classifyToolProcesses(records);
  if (verbose) console.log(`[VERBOSE] /queue classified work: ${JSON.stringify(jobs)}`);
  return jobs;
}

export function processesForTool(jobs, tool) {
  const matching = jobs.filter(job => job.tool === tool);
  return { count: matching.length, processes: matching.map(job => `${job.pid}:${tool}`), jobs: matching };
}

function sameExecution(left, right) {
  const leftIds = [left.sessionName, left.sessionId, left.executionUuid].filter(Boolean);
  const rightIds = [right.sessionName, right.sessionId, right.executionUuid].filter(Boolean);
  return leftIds.some(id => rightIds.includes(id));
}

function processMatchesSession(job, session) {
  // Container PIDs belong to a different namespace and cannot identify a host job.
  if (String(session.isolationBackend || '').startsWith('docker')) return false;
  const names = [session.sessionName, session.sessionId, session.screenSessionName].filter(Boolean).map(screenKey);
  if (job.screenSessionName && names.includes(screenKey(job.screenSessionName))) return true;
  if (session.id && job.url && urlKey(job.url) === urlKey(session.url)) return true;
  const pids = Object.values(session.processIds || {})
    .map(Number)
    .filter(pid => pid > 1);
  return pids.some(pid => job.ancestorPids.includes(pid));
}

const urlKey = value =>
  String(value || '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();

/** Merge known identities; distinct local and detached jobs must be added, not maxed. */
export function mergeToolWork({ jobs = [], sessionItems = [], processingItems = [], tools = TOOLS }) {
  const items = [];
  for (const session of sessionItems) {
    const tool = session.tool || 'claude';
    // The registry query has already reconciled status against backend liveness.
    if (!items.some(item => item.tool === tool && sameExecution(item, session))) items.push({ ...session, tool });
  }
  for (const item of processingItems) {
    const tool = item.tool || 'claude';
    if (!items.some(session => session.tool === tool && (sameExecution(session, item) || (urlKey(item.url) && urlKey(session.url) === urlKey(item.url))))) items.push({ ...item, tool });
  }
  for (const job of jobs) {
    if (!items.some(item => item.tool === job.tool && processMatchesSession(job, item))) items.push(job);
  }
  const byTool = Object.fromEntries(tools.map(tool => [tool, items.filter(item => item.tool === tool).length]));
  return { items, byTool, total: Object.values(byTool).reduce((sum, count) => sum + count, 0) };
}

/** Shared by compact/detailed display and admission. Supports legacy injected counters. */
export async function getQueueWorkSnapshot(queue, tools) {
  const sessionItems = await queue.getRunningSessionItemsFn(queue.verbose);
  const jobs = [];
  const processByTool = {};
  const unidentifiedByTool = {};
  const processSnapshot = queue.getToolProcessSnapshotFn ? await queue.getToolProcessSnapshotFn(queue.verbose) : null;
  for (const tool of tools) {
    const result = processSnapshot ? processesForTool(processSnapshot, tool) : await queue.getRunningProcessesFn(tool, queue.verbose);
    processByTool[tool] = result?.count || 0;
    // Older injected counters have no PID identities; retain their lower bound.
    jobs.push(...(result?.jobs || []));
    unidentifiedByTool[tool] = result?.jobs ? 0 : result?.count || 0;
  }
  const isolatedByTool = {};
  for (const session of sessionItems) {
    if (session.isolationBackend) isolatedByTool[session.tool || 'claude'] = (isolatedByTool[session.tool || 'claude'] || 0) + 1;
  }
  const processingItems = [...queue.processing.values(), ...queue.startReservations.values()];
  const merged = mergeToolWork({ jobs, sessionItems, processingItems, tools });
  if (queue.getRunningIsolatedSessionsFn) {
    const isolated = await queue.getRunningIsolatedSessionsFn(queue.verbose);
    for (const tool of tools) {
      isolatedByTool[tool] = Math.max(isolatedByTool[tool] || 0, isolated.byTool?.[tool] || 0);
    }
  }
  for (const tool of tools) {
    const count = Math.max(merged.byTool[tool], unidentifiedByTool[tool], isolatedByTool[tool] || 0);
    for (let index = merged.byTool[tool]; index < count; index++) merged.items.push({ tool, sessionName: `${tool}-work-${index + 1}` });
    merged.byTool[tool] = count;
  }
  const total = Object.values(merged.byTool).reduce((sum, count) => sum + count, 0);
  if (queue.verbose) queue.log(`Work counts: ${JSON.stringify({ byTool: merged.byTool, processByTool, isolatedByTool, total })}`);
  return { ...merged, total, sessionItems, processByTool, isolatedByTool, processTotal: Object.values(processByTool).reduce((sum, count) => sum + count, 0), isolatedTotal: Object.values(isolatedByTool).reduce((sum, count) => sum + count, 0) };
}
