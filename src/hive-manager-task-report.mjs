import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';

const execFileAsync = promisify(execFile);
const usage = 'Usage: hive-manager tasks report [--limit NUMBER]\nSummarize tracked tasks and recent failures without command lines or logs.\n';

async function report() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, limit: { type: 'string', default: '25' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const limit = Number(values.limit);
  if (!/^\d+$/.test(values.limit) || limit < 1 || limit > 1000) throw new Error('Report limit must be between 1 and 1000.');

  let executions;
  try {
    const { stdout } = await execFileAsync('$', ['--list', '--output-format', 'json'], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    ({ executions } = JSON.parse(stdout));
    if (!Array.isArray(executions)) throw new Error();
  } catch {
    throw new Error('Could not load start-command task records. Check that $ is installed and that tasks list succeeds.');
  }

  const counts = { running: 0, paused: 0, succeeded: 0, failed: 0, unknown: 0 };
  const failures = [];
  for (const task of executions) {
    if (task.status === 'executing') {
      counts[task.paused === true ? 'paused' : 'running']++;
    } else if (task.status === 'executed' && task.exitCode === 0) {
      counts.succeeded++;
    } else if (task.status === 'failed' || (task.status === 'executed' && Number.isInteger(task.exitCode))) {
      counts.failed++;
      if (failures.length < limit) {
        failures.push({
          id: task.uuid,
          exitCode: task.exitCode ?? null,
          finishedAt: task.endTime ?? null,
          memoryExhausted: task.memoryExhausted === true || task.oomKilled === true,
          reason: task.exitReason ?? null,
        });
      }
    } else {
      counts.unknown++;
    }
  }
  process.stdout.write(`${JSON.stringify({ counts, failures }, null, 2)}\n`);
}

try {
  await report();
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
