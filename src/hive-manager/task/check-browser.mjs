import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readAttemptEvidence } from './lib/evidence.mjs';

const chrome = /^(?:chrome|chromium|chromium-browse|headless_shell|chrome-headless|chrome-headless-shell)$/;
const usage = `Usage: hive-manager tasks check-browser PID [--transcript CLAUDE_JSONL | --detached] [--terminate sha256:HEX]
Sample a same-user headless browser in its process namespace. Review the result before signaling an eligible browser.
`;

function readProcess(pid) {
  try {
    const directory = `/proc/${pid}`;
    if (statSync(directory).uid !== process.getuid()) return null;
    const stat = readFileSync(`${directory}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    const started = Number(fields[19]);
    const ticks = Number(fields[11]) + Number(fields[12]);
    if (fields[0] === 'Z' || !Number.isSafeInteger(started) || !Number.isSafeInteger(ticks)) return null;
    return { pid, command: stat.slice(stat.indexOf('(') + 1, close), parent: Number(fields[1]), started, ticks };
  } catch {
    return null;
  }
}

function processArgs(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  } catch {
    return [];
  }
}

function browserSample(pid) {
  const root = readProcess(pid);
  if (!root || !chrome.test(root.command)) throw new Error('Specify a running same-user Chrome or Chromium browser PID.');
  const args = processArgs(pid);
  const browser = args.includes('--remote-debugging-pipe') && !args.some(arg => arg.startsWith('--type='));
  const headless = args.some(arg => /^--headless(?:=|$)/.test(arg)) || /headless/.test(root.command);
  if (!browser || !headless) throw new Error('The PID must be a headless browser using a remote debugging pipe.');
  const entries = readdirSync('/proc').filter(name => /^\d+$/.test(name));
  if (entries.length > 8192) throw new Error('Select the browser’s task container so the process sample is bounded.');
  const children = new Map();
  for (const name of entries) {
    const process = readProcess(Number(name));
    if (process) children.set(process.parent, [...(children.get(process.parent) ?? []), process]);
  }
  const observed = new Map([[pid, root]]);
  for (const process of observed.values()) {
    for (const child of children.get(process.pid) ?? []) observed.set(child.pid, child);
  }
  return observed;
}

function playwrightParent(browser) {
  let parent = browser.parent;
  let mcp;
  for (let depth = 0; depth < 20 && parent > 1; depth++) {
    const ancestor = readProcess(parent);
    if (!ancestor) break;
    const args = processArgs(parent);
    if (mcp && (ancestor.command === 'claude' || basename(args[0] || '') === 'claude')) {
      try {
        return { mcp, claude: ancestor, cwd: readlinkSync(`/proc/${ancestor.pid}/cwd`) };
      } catch {
        return null;
      }
    }
    const script = args[1];
    if (['node', 'nodejs'].includes(basename(args[0] || '')) && script?.startsWith('/') && /playwright[/-]mcp|\/mcp\/cli\./.test(script)) {
      try {
        const resolved = realpathSync(`/proc/${parent}/root${script}`);
        const directory = /^(.*\/node_modules\/@playwright\/mcp)\//.exec(resolved)?.[1];
        const manifest = directory && JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'));
        const version = manifest?.name === '@playwright/mcp' && /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
        if (version && (+version[1] > 0 || +version[2] > 0 || +version[3] >= 83) && args.includes('--isolated')) mcp = { ...ancestor, version: manifest.version };
      } catch {
        // A missing or ambiguous package cannot authorize termination.
      }
    }
    parent = ancestor.parent;
  }
  return null;
}

export function claudeBrowserActivity(text, startMs, nowMs, cwd) {
  const first = startMs - 5 * 60_000;
  const calls = new Map();
  const results = new Map();
  const other = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }
    const at = Date.parse(event?.timestamp);
    if (!['assistant', 'user'].includes(event?.type) || !Number.isFinite(at) || at < first || at > nowMs) continue;
    const sameDirectory = !cwd || event.cwd === cwd;
    for (const part of Array.isArray(event.message?.content) ? event.message.content : []) {
      if (part?.type === 'tool_use' && typeof part.name === 'string') {
        if (part.name.startsWith('mcp__playwright__') && typeof part.id === 'string') calls.set(part.id, { at, sameDirectory });
        else if (sameDirectory && !['Read', 'ToolSearch'].includes(part.name)) other.push(at);
      } else if (part?.type === 'tool_result') {
        results.set(part.tool_use_id, at);
      }
    }
  }
  const ended = [...calls].filter(([id, call]) => results.get(id) >= call.at);
  const last = ended.reduce((max, [id]) => Math.max(max ?? 0, results.get(id)), null);
  const launched = [...calls.values()].some(call => call.sameDirectory && call.at <= startMs + 60_000);
  const pending = calls.size - ended.length;
  const idleMs = last === null ? 0 : nowMs - last;
  const workSince = last === null ? 0 : other.filter(at => at > last).length;
  const callCount = calls.size;
  return { launched, pending, last, callCount, idleMinutes: Math.floor(idleMs / 60_000), workSince, idle: launched && pending === 0 && (idleMs >= 30 * 60_000 || (idleMs >= 5 * 60_000 && workSince >= 3)) };
}

function adoptedByInit(browser) {
  return browser.parent === 1 && /^(?:tini|docker-init|init|systemd)$/.test(readFileSync('/proc/1/comm', 'utf8').trim());
}

async function browserTranscript(file, started, cwd) {
  if (!file?.endsWith('.jsonl')) return null;
  const directory = join(file.slice(0, -6), 'subagents');
  let children = [];
  try {
    children = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => join(directory, entry.name));
    if (children.length > 8) return null;
  } catch (error) {
    if (error.code !== 'ENOENT') return null;
  }
  const snippets = [];
  for (const path of [file, ...children]) {
    const excerpt = await readAttemptEvidence(path, 0, Infinity, children.length ? 1024 * 1024 : undefined);
    if (!excerpt.available || excerpt.bounded || !excerpt.text.endsWith('\n')) return null;
    snippets.push(excerpt.text);
  }
  return claudeBrowserActivity(snippets.join(''), started, Date.now(), cwd);
}

async function checkBrowser() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, transcript: { type: 'string' }, detached: { type: 'boolean' }, terminate: { type: 'string' } } });
  if (values.help) return process.stdout.write(usage);
  const reviewedDigest = values.terminate?.replace(/^sha256:/, '');
  if (process.platform !== 'linux' || positionals.length !== 1 || !/^[1-9]\d{0,6}$/.test(positionals[0]) || Number(positionals[0]) <= 1 || (values.transcript && values.detached) || (reviewedDigest !== undefined && !/^[a-f\d]{64}$/.test(reviewedDigest))) throw new Error('Use a Linux browser PID and one optional evidence source. See tasks check-browser --help.');
  const pid = Number(positionals[0]);
  const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 5000 }));
  const boot = Number(/^btime (\d+)$/m.exec(readFileSync('/proc/stat', 'utf8'))?.[1]) * 1000;
  if (!Number.isSafeInteger(hz) || hz <= 0 || !Number.isSafeInteger(boot) || boot <= 0) throw new Error('Could not read the Linux process clock.');
  const before = browserSample(pid);
  const begin = performance.now();
  await setTimeout(3000);
  const after = browserSample(pid);
  const elapsed = (performance.now() - begin) / 1000;
  const root = after.get(pid);
  if (before.get(pid).started !== root.started || before.get(pid).parent !== root.parent) throw new Error('The selected browser changed during sampling.');
  const ticks = [...after.values()].reduce((sum, item) => {
    const first = before.get(item.pid);
    return first?.started === item.started ? sum + Math.max(0, item.ticks - first.ticks) : sum;
  }, 0);
  const cpuCores = ticks / hz / elapsed;
  const started = boot + (root.started / hz) * 1000;
  const parent = playwrightParent(root);
  const file = values.transcript ? resolve(values.transcript) : null;
  const activity = () => (parent ? browserTranscript(file, started, parent.cwd) : null);
  const evidence = await activity();
  const reparented = adoptedByInit(root);
  const detached = values.detached === true && reparented;
  const eligible = detached || (evidence?.idle === true && cpuCores >= 0.5);
  const digest = eligible
    ? createHash('sha256')
        .update(JSON.stringify({ pid, started, parent: root.parent, detached, file, last: evidence?.last, callCount: evidence?.callCount, mcp: parent?.mcp.pid, claude: parent?.claude.pid }))
        .digest('hex')
    : null;
  if (reviewedDigest !== undefined) {
    if (reviewedDigest !== digest) throw new Error('The browser is no longer eligible for that reviewed termination.');
    const current = browserSample(pid).get(pid);
    const currentParent = playwrightParent(current);
    const latest = await activity();
    const confirmed = detached ? adoptedByInit(current) : latest?.idle && latest.last === evidence.last && latest.callCount === evidence.callCount && currentParent?.mcp.started === parent.mcp.started && currentParent?.claude.started === parent.claude.started && currentParent.cwd === parent.cwd;
    if (!confirmed || current.started !== root.started || current.parent !== root.parent || readProcess(pid)?.started !== root.started) throw new Error('The browser or its activity changed before termination.');
    process.kill(pid, 'SIGTERM');
  }
  process.stdout.write(`${JSON.stringify({ pid, started: new Date(started).toISOString(), processes: after.size, cpuCores: Number(cpuCores.toFixed(2)), reparented, playwrightVersion: parent?.mcp.version ?? null, activity: evidence, approval: digest ? `sha256:${digest}` : null, signaled: reviewedDigest !== undefined }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await checkBrowser();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
