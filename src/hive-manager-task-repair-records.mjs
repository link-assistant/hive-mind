import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { withStateLock } from './state-lock.lib.mjs';

const run = promisify(execFile);
const uuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const usage = `Usage: hive-manager tasks repair-records [--apply] [UUID...]
Preview adoption of running, attributed Docker resumes missing their task record update.
Requires start-command 0.44.0. For records already marked executing, use tasks resume-all.
`;

async function startLibraries() {
  try {
    const { stdout } = await run('bash', ['-c', "command -v '$'"], { timeout: 5000, maxBuffer: 4096 });
    const executable = await realpath(stdout.trim());
    const root = dirname(dirname(dirname(executable)));
    const { name, version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (name !== 'start-command' || version !== '0.44.0') throw new Error();
    const require = createRequire(executable);
    return {
      ...require('../lib/execution-store.js'),
      ...require('../lib/execution-resume.js'),
      ...require('../lib/execution-attempt.js'),
      ...require('../lib/docker-cleanup.js'),
      ...require('../lib/docker-command-handoff.js'),
      ...require('../lib/launch-owner.js'),
    };
  } catch {
    throw new Error('Recorded-resume repair needs the start-command 0.44.0 executable installed on PATH.');
  }
}

async function docker(args) {
  try {
    return (await run('docker', args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  } catch {
    throw new Error('Could not inspect Docker task state.');
  }
}

function repairPlan(record, container, start) {
  const options = record.options ?? {};
  if (record.status !== 'executed' || options.isolated !== 'docker' || options.isolationMode !== 'detached' || start.hasActiveLaunch(record)) return null;
  const { Id, Name, Config, State } = container;
  const labels = Config?.Labels ?? {};
  const root = options.rootSession || options.sessionNameHistory?.[0] || options.sessionName;
  const name = Name?.slice(1);
  const count = Number(labels['start-command.resume-count']);
  const started = Date.parse(State?.StartedAt);
  const finished = Date.parse(record.endTime);
  if (!State?.Running || State.Paused || State.Restarting || !root || !/^[a-f\d]{64}$/.test(Id) || !Number.isFinite(finished) || started <= finished || !Number.isFinite(started)) return null;
  if (labels['start-command.uuid'] !== record.uuid || labels['start-command.root-session'] !== root || labels['start-command.session'] !== name) return null;
  if (!Number.isSafeInteger(count) || count !== (Number(options.resumeCount) || 0) + 1 || name !== start.buildResumedSessionName(options.sessionName, count)) return null;
  const image = start.buildSnapshotImageName(options.sessionName, count);
  if (Config.Image !== image || labels['start-command.snapshot-image'] !== image || typeof record.command !== 'string') return null;
  const expectedCommand = start.buildCommandHandoffArgs(['sh', '-c', record.command], start.commandHandoffPath(name));
  if (!Array.isArray(Config.Cmd) || Config.Cmd.join('\0') !== expectedCommand.join('\0')) return null;
  return {
    mode: 'docker-snapshot',
    backend: 'docker',
    attempt: count,
    sessionName: options.sessionName,
    newSessionName: name,
    snapshotImage: Config.Image,
    command: record.command,
  };
}

async function repair() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, apply: { type: 'boolean' } } });
  if (values.help) return process.stdout.write(usage);
  if (!positionals.every(value => uuidPattern.test(value))) throw new Error('Specify complete task UUIDs.');
  const start = await startLibraries();
  const store = new start.ExecutionStore({ appFolder: process.env.START_APP_FOLDER });
  const selected = new Set(positionals);
  const perform = async () => {
    const records = new Map(
      store
        .getAll()
        .filter(record => uuidPattern.test(record.uuid) && (!selected.size || selected.has(record.uuid)))
        .map(record => [record.uuid, record])
    );
    const listing = await docker(['ps', '-q', '--no-trunc', '--filter', 'label=start-command.snapshot-image', '--filter', 'status=running']);
    const ids = listing.split('\n').filter(id => /^[a-f\d]{64}$/.test(id));
    const candidates = new Map();
    for (const id of ids) {
      const [container] = JSON.parse(await docker(['inspect', id]));
      const uuid = container.Config?.Labels?.['start-command.uuid'];
      const record = records.get(uuid);
      const plan = record && repairPlan(record, container, start);
      if (!plan) continue;
      candidates.set(uuid, [...(candidates.get(uuid) ?? []), { id, name: plan.newSessionName }]);
    }

    const outcomes = [];
    for (const [uuid, matches] of candidates) {
      if (matches.length > 1) {
        outcomes.push({ uuid, state: 'ambiguous' });
        continue;
      }
      const { id, name } = matches[0];
      if (!values.apply) {
        outcomes.push({ uuid, container: name, state: 'eligible' });
        continue;
      }
      const [container] = JSON.parse(await docker(['inspect', id]));
      const current = store.get(uuid);
      const plan = current && repairPlan(current, container, start);
      if (!plan) {
        outcomes.push({ uuid, container: name, state: 'changed' });
        continue;
      }
      const record = new start.ExecutionRecord({ ...current, options: { ...current.options } });
      const attempt = start.createAttempt(record, plan);
      attempt.startedAt = new Date(container.State.StartedAt).toISOString();
      attempt.launchAcceptedAt = attempt.startedAt;
      const updated = start.applyResumeToRecord(record, plan, id, attempt);
      store.reserveLaunch(updated, current);
      const attached = start.startDetachedDockerCompletionWatcher(name, start.getDockerContainerCleanupPolicy(updated.options), updated.logPath, uuid, { since: attempt.startedAt, attemptNumber: attempt.number, recoverOnKill: false });
      if (attached) start.patchAttempt(store, updated, { watcherAttachedAt: new Date().toISOString() });
      outcomes.push({ uuid, container: name, state: attached ? 'repaired' : 'watcher-unconfirmed' });
    }
    process.stdout.write(`${JSON.stringify({ mode: values.apply ? 'apply' : 'preview', outcomes }, null, 2)}\n`);
    if (outcomes.some(item => item.state === 'watcher-unconfirmed')) throw new Error('A repaired record has no confirmed watcher. Run tasks resume-all to reconcile it.');
  };
  if (values.apply) await withStateLock('hive-manager-task-repair-records', perform, { timeoutMs: 5000, staleMs: 60 * 60 * 1000 });
  else await perform();
}

try {
  await repair();
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
