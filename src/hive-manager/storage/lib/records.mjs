import { output } from './process.mjs';
import { readExecutionStore } from '../../task/lib/read-execution-store.mjs';

// Run in the selected environment so custom app folders and the installed
// start-command codec resolve there. The public status and list commands
// reconcile pause state, and the store API can write a decoded cache.
async function readStore() {
  const { ids, uuids, execution } = JSON.parse(process.argv[1]);
  const records = await readExecutionStore();
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
  const script = `${readExecutionStore.toString()}\nawait (${readStore.toString()})();`;
  const args = ['--max-old-space-size=192', '--input-type=module', '-e', script, '--', JSON.stringify(query)];
  const currentOptions = () => (typeof options === 'function' ? options() : options);
  try {
    return { data: JSON.parse(await docker(['exec', '--user', 'box', instance, 'node', ...args], currentOptions())), local: false };
  } catch {
    return { data: JSON.parse(await output(process.execPath, args, currentOptions())), local: true };
  }
}
