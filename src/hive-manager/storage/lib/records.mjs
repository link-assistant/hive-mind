import { output } from './process.mjs';

// Run in the selected environment so custom app folders and the installed
// start-command codec resolve there. The public status and list commands
// reconcile pause state, and the store API can write a decoded cache.
async function readStore() {
  const { accessSync, closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { homedir } = await import('node:os');
  const { delimiter, join, resolve } = await import('node:path');
  const { ids, uuids, execution } = JSON.parse(process.argv[1]);
  const folder = process.env.START_APP_FOLDER || join(homedir(), '.start-command');
  const fd = openSync(join(folder, 'executions.lino'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let source;
  try {
    const stat = fstatSync(fd);
    const { size } = stat;
    if (!stat.isFile() || size > 16 * 1024 ** 2) throw new Error('Execution store exceeded its read budget or is not a regular file.');
    const bytes = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== size) throw new Error('Execution store changed while reading it.');
    source = bytes.toString('utf8', 0, offset);
  } finally {
    closeSync(fd);
  }
  let records = [];
  if (source.trim()) {
    try {
      records = JSON.parse(source);
    } catch {
      const cli = (process.env.PATH ?? '/usr/bin:/bin')
        .split(delimiter)
        .map(directory => resolve(directory, '$'))
        .find(candidate => {
          try {
            accessSync(candidate, constants.X_OK);
            return statSync(candidate).isFile();
          } catch {
            return false;
          }
        });
      if (!cli) throw new Error('Cannot locate the installed start-command codec.');
      const require = createRequire(realpathSync(cli));
      records = require('lino-objects-codec').decode({ notation: source });
    }
  }
  if (!Array.isArray(records)) throw new Error('Invalid start-command execution store.');
  if (execution) {
    const record = records.find(item => item?.uuid?.toLowerCase() === execution);
    if (!record) throw new Error('Execution absent from the start-command store.');
    process.stdout.write(JSON.stringify(record));
    return;
  }
  const containers = new Set(ids);
  const tasks = new Set(uuids);
  const selected = [];
  for (const item of records) {
    if (typeof item?.uuid !== 'string') continue;
    const { isolated, containerId, sessionName } = item.options ?? {};
    const history = Array.isArray(item.attemptHistory) ? item.attemptHistory.filter(attempt => containers.has(attempt?.containerId)) : [];
    if (tasks.has(item.uuid.toLowerCase()) || (isolated === 'docker' && (containers.has(containerId) || history.length))) {
      selected.push({ uuid: item.uuid, command: item.command, options: { isolated, containerId, sessionName }, attemptHistory: history.map(({ containerId, sessionName }) => ({ containerId, sessionName })) });
    }
  }
  process.stdout.write(JSON.stringify(selected));
}

export async function taskRecords(docker, instance, query, options) {
  const args = ['--max-old-space-size=192', '--input-type=module', '-e', `await (${readStore.toString()})();`, '--', JSON.stringify(query)];
  const currentOptions = () => (typeof options === 'function' ? options() : options);
  try {
    return { data: JSON.parse(await docker(['exec', '--user', 'box', instance, 'node', ...args], currentOptions())), local: false };
  } catch {
    return { data: JSON.parse(await output(process.execPath, args, currentOptions())), local: true };
  }
}
