import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { HiveManagerError } from '../../lib/error.mjs';
import { taskUuidPattern } from './inspection.mjs';

const run = promisify(execFile);
const containerIdPattern = /^[a-f\d]{64}$/;

export async function startLibraries() {
  try {
    const { stdout } = await run('bash', ['-c', "command -v '$'"], { timeout: 5000, maxBuffer: 4096 });
    const executable = await realpath(stdout.trim());
    const root = dirname(dirname(dirname(executable)));
    const { name, version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (name !== 'start-command' || version !== '0.44.0') throw new Error();
    const require = createRequire(executable);
    return {
      require,
      ...require('../lib/execution-store.js'),
      ...require('../lib/execution-resume.js'),
      ...require('../lib/execution-attempt.js'),
      ...require('../lib/docker-cleanup.js'),
      ...require('../lib/docker-command-handoff.js'),
      ...require('../lib/launch-owner.js'),
    };
  } catch {
    throw new HiveManagerError('START_COMMAND_UNAVAILABLE', 'Recorded-resume repair needs the start-command 0.44.0 executable installed on PATH.');
  }
}

async function docker(args) {
  try {
    return (await run('docker', args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  } catch {
    throw new HiveManagerError('DOCKER_INSPECTION_FAILED', 'Could not inspect Docker task state.');
  }
}

export async function inspectRepairContainer(id) {
  const json = await docker(['inspect', id]);
  try {
    const containers = JSON.parse(json);
    if (!Array.isArray(containers) || containers.length !== 1 || containers[0]?.Id !== id) throw new Error();
    return containers[0];
  } catch {
    throw new HiveManagerError('DOCKER_INSPECTION_FAILED', 'Could not inspect Docker task state.');
  }
}

export function repairPlan(record, container, start) {
  const options = record.options ?? {};
  if (record.status !== 'executed' || options.isolated !== 'docker' || options.isolationMode !== 'detached' || start.hasActiveLaunch(record)) return null;
  const { Id, Name, Config, State } = container;
  const labels = Config?.Labels ?? {};
  const root = options.rootSession || options.sessionNameHistory?.[0] || options.sessionName;
  const name = Name?.slice(1);
  const count = Number(labels['start-command.resume-count']);
  const started = Date.parse(State?.StartedAt);
  const finished = Date.parse(record.endTime);
  if (!State?.Running || State.Paused || State.Restarting || !root || !containerIdPattern.test(Id) || !Number.isFinite(finished) || started <= finished || !Number.isFinite(started)) return null;
  if (labels['start-command.uuid'] !== record.uuid || labels['start-command.root-session'] !== root || labels['start-command.session'] !== name) return null;
  if (!Number.isSafeInteger(count) || count !== (Number(options.resumeCount) || 0) + 1 || name !== start.buildResumedSessionName(options.sessionName, count)) return null;
  const image = start.buildSnapshotImageName(options.sessionName, count);
  if (Config.Image !== image || labels['start-command.snapshot-image'] !== image || typeof record.command !== 'string') return null;
  const expectedCommand = start.buildCommandHandoffArgs(['sh', '-c', record.command], start.commandHandoffPath(name));
  if (!Array.isArray(Config.Cmd) || Config.Cmd.length !== expectedCommand.length || Config.Cmd.some((arg, index) => arg !== expectedCommand[index])) return null;
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

export function repairSelection(uuids = []) {
  if (!Array.isArray(uuids) || !uuids.every(value => typeof value === 'string' && taskUuidPattern.test(value))) {
    throw new HiveManagerError('INVALID_INPUT', 'Specify complete task UUIDs.');
  }
  return new Set(uuids.map(uuid => uuid.toLowerCase()));
}

export async function findRepairCandidates(records, selected, start) {
  const byUuid = new Map(records.filter(record => taskUuidPattern.test(record.uuid) && (!selected.size || selected.has(record.uuid.toLowerCase()))).map(record => [record.uuid, record]));
  const listing = await docker(['ps', '-q', '--no-trunc', '--filter', 'label=start-command.snapshot-image', '--filter', 'status=running']);
  const ids = listing.split('\n').filter(id => containerIdPattern.test(id));
  const candidates = new Map();
  for (const id of ids) {
    const container = await inspectRepairContainer(id);
    const uuid = container.Config?.Labels?.['start-command.uuid'];
    const record = byUuid.get(uuid);
    const plan = record && repairPlan(record, container, start);
    if (!plan) continue;
    const matches = candidates.get(uuid) ?? [];
    matches.push({ id, name: plan.newSessionName });
    candidates.set(uuid, matches);
  }
  return candidates;
}

async function readRepairRecords(start, appFolder) {
  try {
    // ExecutionStore creates an app directory and getAll persists a decoded cache.
    // Decode the same pinned store format directly so a preview only reads it.
    const content = await readFile(join(appFolder || start.DEFAULT_APP_FOLDER, start.LINO_DB_FILE), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (!content.trim()) return [];
    let records;
    try {
      records = start.require('lino-objects-codec').decode({ notation: content });
    } catch {
      records = JSON.parse(content);
    }
    if (!Array.isArray(records) || records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) throw new Error();
    return records.map(record => start.ExecutionRecord.fromObject(record));
  } catch {
    throw new HiveManagerError('TASK_RECORDS_UNAVAILABLE', 'Could not read start-command task records.');
  }
}

export async function previewTaskRecordRepair({ uuids, appFolder = process.env.START_APP_FOLDER } = {}) {
  const selected = repairSelection(uuids);
  if (appFolder !== undefined && typeof appFolder !== 'string') throw new HiveManagerError('INVALID_INPUT', 'Specify a start-command app folder path.');
  const start = await startLibraries();
  const records = await readRepairRecords(start, appFolder);
  const candidates = await findRepairCandidates(records, selected, start);
  const outcomes = [...candidates].map(([uuid, matches]) => (matches.length === 1 ? { uuid, container: matches[0].name, state: 'eligible' } : { uuid, state: 'ambiguous' }));
  return { mode: 'preview', outcomes };
}
