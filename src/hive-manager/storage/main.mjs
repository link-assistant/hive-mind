import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { cleanupWorker, jobDirectory, launchCleanup, readCleanupStatus } from './cleanup.mjs';
import { dockerRoot, executionId, localDocker, overlaps, runtimeRoots } from './lib/docker.mjs';
import { cleanupPreserved, preserveLayer } from './preserve.mjs';
import { diskReport } from './report.mjs';

const usage = {
  disk: `Usage: hive-manager deploy disk [--budget SECONDS]
Show bounded, read-only host and Docker storage measurements in JSON.
Use --docker-summary to request Docker's verbose storage walk separately.
`,
  scoped: `Usage: hive-manager deploy cleanup --scoped [--dry-run | --status | --apply PREVIEW_ID] [--instance-only]
Start a detached disk-space-saviour preview on the Linux Docker host.
Poll --status after reconnecting. Review a completed preview before applying it.
`,
  preserve: `Usage: hive-manager deploy tasks preserve-layer CONTAINER --output NEW_DIRECTORY [--execution UUID]
Archive the stopped task's writable layer with ownership, original container facts, execution record and available logs.
Back up mounted data separately.
`,
  'cleanup-preserved': `Usage: hive-manager deploy tasks cleanup-preserved DIRECTORY [--apply SHA256]
Verify stopped writable-layer preservation and preview removal of the exact container.
`,
};

function linuxRoot() {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Run this action as root on the Linux Docker daemon host.');
}

async function main([action, socket, instance, stateDir, ...args]) {
  if (action === 'worker') {
    linuxRoot();
    process.umask(0o077);
    return cleanupWorker(jobDirectory, socket, instance, stateDir, ...args);
  }
  const options = {
    help: { type: 'boolean', short: 'h' },
    ...(action === 'disk' ? { budget: { type: 'string', default: '60' } } : {}),
    ...(action === 'scoped' ? { 'dry-run': { type: 'boolean' }, status: { type: 'boolean' }, apply: { type: 'string' }, 'instance-only': { type: 'boolean' } } : {}),
    ...(action === 'preserve' ? { output: { type: 'string' }, execution: { type: 'string' } } : {}),
    ...(action === 'cleanup-preserved' ? { apply: { type: 'string' } } : {}),
  };
  const { values, positionals } = parseArgs({ args, options, allowPositionals: action === 'preserve' || action === 'cleanup-preserved' });
  if (values.help) {
    process.stdout.write(usage[action]);
    return;
  }
  let result;
  if (action === 'scoped' && values.status && !values['dry-run'] && values.apply === undefined) {
    linuxRoot();
    const status = (await readCleanupStatus(jobDirectory)) ?? { status: 'idle' };
    if (['failed', 'interrupted', 'pressure-stopped'].includes(status.status)) process.exitCode = 1;
    process.stdout.write(JSON.stringify(status, null, 2) + '\n');
    return;
  }
  const docker = localDocker(socket);
  switch (action) {
    case 'disk': {
      if (process.platform !== 'linux') throw new Error('Run the disk report on the Linux Docker daemon host.');
      const budget = Number(values.budget);
      if (!/^\d+$/.test(values.budget) || budget < 1 || budget > 180) throw new Error('Use a report budget between 1 and 180 seconds.');
      result = await diskReport(docker, instance, budget);
      break;
    }
    case 'scoped': {
      linuxRoot();
      if ([values.status, values['dry-run'], values.apply !== undefined].filter(Boolean).length > 1 || (values.apply !== undefined && !executionId.test(values.apply))) {
        throw new Error('Choose --dry-run, --status, or --apply with a preview ID.');
      }
      const root = realpathSync(await dockerRoot(docker));
      if ([root, ...runtimeRoots].some(path => overlaps(path, jobDirectory))) throw new Error('Scoped cleanup state overlaps runtime storage.');
      result = await launchCleanup(jobDirectory, socket, instance, stateDir, values.apply, values['instance-only']);
      if (['failed', 'interrupted', 'pressure-stopped'].includes(result.status)) process.exitCode = 1;
      break;
    }
    case 'preserve':
      linuxRoot();
      if (positionals.length !== 1 || !values.output || values.output.endsWith('/') || !/^[a-zA-Z\d][a-zA-Z\d_.-]*$/.test(positionals[0]) || (values.execution !== undefined && !executionId.test(values.execution))) throw new Error(usage.preserve.trim());
      result = await preserveLayer(docker, instance, positionals[0], values.output, values.execution);
      break;
    case 'cleanup-preserved':
      linuxRoot();
      if (positionals.length !== 1 || (values.apply !== undefined && !/^[a-f0-9]{64}$/.test(values.apply))) throw new Error(usage['cleanup-preserved'].trim());
      result = await cleanupPreserved(docker, positionals[0], values.apply);
      break;
    default:
      throw new Error('Unknown deploy storage action.');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
