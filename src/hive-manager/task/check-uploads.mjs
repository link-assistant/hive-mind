import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { basename, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const uploadCommands = new Set(['gh-upload-log', 'gh-upload-log.mjs', 'gh-upload-file', 'gh-upload-file.mjs', 'sensitive-data-sanitizer', 'sensitive-data-sanitizer.mjs']);
const runtimes = new Set(['bun', 'node', 'nodejs']);

function uploadCommand(args) {
  const executable = basename(args[0] ?? '');
  const script = runtimes.has(executable) ? basename(args[args[1] === 'run' || args[1] === '--' ? 2 : 1] ?? '') : executable;
  return uploadCommands.has(script) ? script : null;
}

function sample(pid) {
  const directory = `/proc/${pid}`;
  try {
    if (statSync(directory).uid !== process.getuid()) return null;
    const command = uploadCommand(readFileSync(`${directory}/cmdline`, 'utf8').split('\0'));
    if (!command) return null;
    const stat = readFileSync(`${directory}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(fields[11]) + Number(fields[12]);
    const started = Number(fields[19]);
    if (!Number.isSafeInteger(ticks) || !Number.isSafeInteger(started)) return null;

    let io = null;
    try {
      const counters = /^rchar: (\d+)\nwchar: (\d+)$/m.exec(readFileSync(`${directory}/io`, 'utf8'));
      if (counters) io = { read: BigInt(counters[1]), written: BigInt(counters[2]) };
    } catch {
      // Some process namespaces restrict I/O counters even for the same UID.
    }
    return { pid, command, ticks, started, io };
  } catch {
    // A process can exit or become inaccessible during inspection.
    return null;
  }
}

export function classifyUpload(before, after, { ticksPerSecond, seconds, uptime, minutes, percent }) {
  if (!after || before.started !== after.started || before.command !== after.command || after.ticks < before.ticks) return null;
  const ageSeconds = Math.floor(uptime - after.started / ticksPerSecond);
  const cpu = ((after.ticks - before.ticks) * 100) / (ticksPerSecond * seconds);
  const progress = before.io && after.io ? before.io.read !== after.io.read || before.io.written !== after.io.written : null;
  return {
    pid: after.pid,
    command: after.command,
    ageSeconds,
    cpuPercent: Math.round(cpu),
    ioProgress: progress,
    stalled: progress === false && ageSeconds >= minutes * 60 && cpu >= percent,
  };
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < minimum || number > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  return number;
}

async function checkUploads() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      minutes: { type: 'string', default: '30' },
      percent: { type: 'string', default: '80' },
      'sample-seconds': { type: 'string', default: '3' },
      terminate: { type: 'string' },
    },
  });
  if (values.help) {
    process.stdout.write('Usage: hive-manager tasks check-uploads [--minutes N] [--percent N] [--sample-seconds N] [--terminate PID]\nInspect same-user Linux log upload processes. Termination requires a stalled process and an explicit PID.\n');
    return;
  }
  if (process.platform !== 'linux') throw new Error('Upload diagnostics require Linux /proc.');
  const minutes = boundedInteger(values.minutes, 1, 1440, 'Minimum process age in minutes');
  const percent = boundedInteger(values.percent, 1, 100, 'Minimum CPU percentage');
  const sampleSeconds = boundedInteger(values['sample-seconds'], 1, 15, 'Sample duration');
  const terminate = values.terminate ? boundedInteger(values.terminate, 2, 4194304, 'Process ID') : null;
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 5000 }));
  if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond <= 0) throw new Error('Could not read the Linux clock tick rate.');

  const pids = terminate
    ? [terminate]
    : readdirSync('/proc')
        .filter(name => /^\d+$/.test(name))
        .map(Number);
  const first = pids.map(sample).filter(Boolean);
  const started = performance.now();
  if (first.length) await setTimeout(sampleSeconds * 1000);
  const seconds = (performance.now() - started) / 1000;
  const uptime = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  if (!Number.isFinite(uptime)) throw new Error('Could not read Linux uptime.');

  const uploads = [];
  let terminated = null;
  for (const before of first) {
    const after = sample(before.pid);
    const result = classifyUpload(before, after, { ticksPerSecond, seconds, uptime, minutes, percent });
    if (!result) continue;
    uploads.push(result);
    if (terminate === result.pid && result.stalled) {
      const latest = sample(terminate);
      if (latest?.started !== after.started || latest.command !== after.command || latest.io?.read !== after.io.read || latest.io?.written !== after.io.written) continue;
      process.kill(terminate, 'SIGTERM');
      terminated = terminate;
    }
  }
  process.stdout.write(`${JSON.stringify({ uploads, terminated }, null, 2)}\n`);
  if (terminate && !terminated) throw new Error(`PID ${terminate} was not confirmed stalled.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await checkUploads();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
