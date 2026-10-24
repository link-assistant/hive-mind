#!/usr/bin/env node
/**
 * Issue #3614: measure the status checks with real Docker containers and a real
 * start-command binary (the load replay in issue-3614-load-simulation.mjs uses
 * stubs and scaled time).
 *
 * It starts TASKS detached docker-isolated tasks (`$ --isolated docker
 * --detached -- sleep …`), then for SECONDS real seconds:
 *
 * - counts the `docker` processes start-command's own detached monitors start
 *   per task (link-foundation/start#238 — the 1 s loop the issue measured), and
 * - lets four bot callers (status query, `isSessionRunning`, backend probe,
 *   `pgrep`) ask about every task 95 times a minute through hive-mind's real
 *   status code, counting the `$` / `docker` processes the bot starts and the
 *   CPU time of the bot's reaped child processes (`cutime + cstime` from
 *   /proc/self/stat, which includes the `docker` processes `$` itself runs).
 *
 * Logging shims for `docker` and `$` sit first on PATH. Monitors and the bot
 * write to separate logs, so their counts never mix.
 *
 * Usage:
 *   node experiments/issue-3614-live-measurement.mjs [--start-command <path to $>]
 *     [--seconds 60] [--tasks 3] [--interval-ms <bot min interval>]
 *     [--src <hive-mind src dir, e.g. a main worktree>] [--image alpine:3.20]
 *     [--skip-bot] [--idle-chat]
 * --idle-chat runs the session monitor's isolation-state reconciliation and
 * default CPU penalty pass every 30 seconds instead of the synthetic callers.
 */
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const repoSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const srcDir = path.resolve(option('src', repoSrc));
const seconds = Number(option('seconds', 60));
const taskCount = Number(option('tasks', 3));
const image = option('image', 'alpine:3.20');
const intervalMs = option('interval-ms', null);
const skipBot = process.argv.includes('--skip-bot');
const idleChat = process.argv.includes('--idle-chat');
const realStart = path.resolve(option('start-command', (await execFileAsync('sh', ['-c', 'command -v "$"'])).stdout.trim()));
const realDocker = (await execFileAsync('sh', ['-c', 'command -v docker'])).stdout.trim();

const shimDir = await mkdtemp(path.join(os.tmpdir(), 'hive-3614-live-'));
const monitorLog = path.join(shimDir, 'monitor.log');
const botLog = path.join(shimDir, 'bot.log');
await writeFile(monitorLog, '');
await writeFile(botLog, '');
const shim = async (name, target) => {
  // One line per process even when an argument (a `sh -c` script) spans lines.
  await writeFile(path.join(shimDir, name), `#!/bin/sh\nline=$(printf ' %s' "$@" | tr '\\n' ' ')\nname='${name}'\nprintf '%s\\n' "$name$line" >> "$HIVE_3614_SHIM_LOG"\nexec '${target}' "$@"\n`);
  await chmod(path.join(shimDir, name), 0o755);
};
await shim('docker', realDocker);
await shim('$', realStart);
process.env.PATH = `${shimDir}${path.delimiter}${process.env.PATH}`;

const runId = `${process.pid}`;
const sessions = Array.from({ length: taskCount }, (_, i) => `hive-3614-live-${runId}-${i + 1}`);
const version = (await execFileAsync(realStart, ['--version'])).stdout.split('\n')[0];
console.log(`${version}; ${taskCount} tasks; ${seconds} s window; image ${image}; hive-mind src ${srcDir}`);

const cleanup = async () => {
  for (const session of sessions) await execFileAsync(realDocker, ['rm', '-f', session]).catch(() => {});
};
process.on('SIGINT', () => cleanup().finally(() => process.exit(130)));

const readLines = async file => (await readFile(file, 'utf8')).split('\n').filter(Boolean);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Children CPU (reaped descendants) in seconds; fields 16/17 of /proc/self/stat.
const childCpuSeconds = async () => {
  const stat = await readFile('/proc/self/stat', 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return (Number(fields[13]) + Number(fields[14])) / 100;
};

// CPU (own + reaped children, seconds) of start-command's detached monitor
// shells: the processes whose command line names one of our tasks.
const monitorCpu = async () => {
  const totals = new Map();
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    try {
      const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmdline.startsWith('sh') && !cmdline.startsWith('/bin/sh')) continue;
      if (!sessions.some(session => cmdline.includes(session))) continue;
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      totals.set(pid, fields.slice(11, 15).reduce((sum, value) => sum + Number(value), 0) / 100);
    } catch {
      // the process ended while we looked
    }
  }
  return totals;
};

try {
  for (const session of sessions) {
    await execFileAsync('$', ['--isolated', 'docker', '--detached', '--image', image, '--session', session, '--', 'sleep', String(seconds + 120)], { env: { ...process.env, HIVE_3614_SHIM_LOG: monitorLog } });
  }
  await sleep(5000); // let the launches settle before the window opens
  const monitorBefore = (await readLines(monitorLog)).length;
  const monitorCpuBefore = await monitorCpu();
  const windowStart = Date.now();

  let bot = null;
  if (!skipBot) {
    process.env.HIVE_3614_SHIM_LOG = botLog;
    if (intervalMs !== null) process.env.HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS = intervalMs;
    const { querySessionStatus, isSessionRunning, checkBackendSessionAlive } = await import(path.join(srcDir, 'isolation-runner.lib.mjs'));
    const { getRunningProcesses } = await import(path.join(srcDir, 'telegram-solve-queue.helpers.lib.mjs'));
    const { getIsolationSessionState } = await import(path.join(srcDir, 'session-monitor.isolation-state.lib.mjs'));
    const { normalizeDockerCpuPenaltyConfig, runDockerCpuPenaltyPass } = await import(path.join(srcDir, 'docker-cpu-penalty.lib.mjs'));
    const sessionInfo = new Map(sessions.map(session => [session, { sessionId: session, isolationBackend: 'docker' }]));
    const trackedSessions = sessions.map(session => ({ sessionName: session, sessionInfo: sessionInfo.get(session) }));
    const cpuPenaltyConfig = normalizeDockerCpuPenaltyConfig();
    const lookup = session => (idleChat ? getIsolationSessionState(session, sessionInfo.get(session)) : Promise.all([querySessionStatus(session), isSessionRunning(session, { backend: 'docker' }), checkBackendSessionAlive(session, 'docker'), getRunningProcesses('claude')]));
    const cpuBefore = await childCpuSeconds();
    const ownBefore = process.cpuUsage();
    let lookups = 0;
    let lastRunning = null;
    while (Date.now() - windowStart < seconds * 1000) {
      const penaltyPass = idleChat ? runDockerCpuPenaltyPass(trackedSessions, { config: cpuPenaltyConfig }) : null;
      const results = await Promise.all(sessions.map(lookup));
      await penaltyPass;
      lastRunning = results.map(result => (idleChat ? result.running : result[1]));
      lookups++;
      await sleep(idleChat ? 30_000 : 60_000 / 95);
    }
    const own = process.cpuUsage(ownBefore);
    bot = { lookups, lastRunning, childCpu: (await childCpuSeconds()) - cpuBefore, ownCpu: (own.user + own.system) / 1e6 };
  } else {
    await sleep(seconds * 1000);
  }
  const elapsedMin = (Date.now() - windowStart) / 60_000;
  const monitorCpuAfter = await monitorCpu();
  let monitorCpuSeconds = 0;
  for (const [pid, before] of monitorCpuBefore) if (monitorCpuAfter.has(pid)) monitorCpuSeconds += monitorCpuAfter.get(pid) - before;

  const monitorLines = (await readLines(monitorLog)).slice(monitorBefore);
  const perMin = n => (n / elapsedMin).toFixed(1);
  console.log(`\nstart-command detached monitors (all ${taskCount} tasks, ${(elapsedMin * 60).toFixed(0)} s):`);
  console.log(`  docker processes: ${monitorLines.length} → ${perMin(monitorLines.length / taskCount)}/min per task`);
  const kinds = new Map();
  for (const line of monitorLines) {
    const key = line
      .replace(/hive-3614-live-\S+/g, '<task>')
      .replace(/\b[0-9a-f]{12,64}\b/g, '<id>')
      .slice(0, 90);
    kinds.set(key, (kinds.get(key) || 0) + 1);
  }
  for (const [key, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${perMin(n / taskCount)}/min per task  ${key}`);
  console.log(`  monitor shells' CPU (${monitorCpuBefore.size} processes, incl. their reaped docker children): ${(monitorCpuSeconds / (elapsedMin * 60)).toFixed(3)} cores (${(monitorCpuSeconds / (elapsedMin * 60) / taskCount).toFixed(3)} per task)`);

  if (bot) {
    const botLines = await readLines(botLog);
    const statusFor = session => botLines.filter(line => line.startsWith(`$ --status ${session}`)).length;
    console.log(`\nbot callers (${idleChat ? 'idle chat: isolation-state reconciliation + CPU penalty every 30 s' : '4 per task'}, ${bot.lookups} lookup rounds = ${perMin(bot.lookups)}/min per caller per task; HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS=${intervalMs ?? 'unset'}):`);
    for (const session of sessions) console.log(`  $ --status ${session.replace(`-${runId}`, '')}: ${perMin(statusFor(session))}/min`);
    const docker = botLines.filter(line => line.startsWith('docker '));
    console.log(`  docker processes (the bot's own + those inside $ --status): ${perMin(docker.length)}/min (${perMin(docker.length / taskCount)}/min per task)`);
    console.log(`  all shimmed processes: ${perMin(botLines.length)}/min; last isSessionRunning: ${JSON.stringify(bot.lastRunning)}`);
    console.log(`  bot child-process CPU: ${bot.childCpu.toFixed(2)} s in ${(elapsedMin * 60).toFixed(0)} s = ${(bot.childCpu / (elapsedMin * 60)).toFixed(3)} cores; bot's own code: ${(bot.ownCpu / (elapsedMin * 60)).toFixed(3)} cores`);
  }
} finally {
  await cleanup();
  await rm(shimDir, { recursive: true, force: true });
}
process.exit(0);
