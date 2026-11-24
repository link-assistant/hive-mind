import { parseArgs } from 'node:util';
import { applyAutoFix, autoFixWorker, getAutoFixStatus, previewAutoFix } from './index.mjs';

const usage = `Usage: hive-manager deploy --profile FILE auto-fix [POLICY_FLAGS]
       hive-manager deploy --profile FILE auto-fix [POLICY_FLAGS] --apply sha256:PLAN_SHA256 [--after-interruption RUN_UUID]
       hive-manager deploy --profile FILE auto-fix --status [--run RUN_UUID]

Preview an ordered host and deployment recovery plan. Apply submits a detached
worker and returns a run receipt. Use --status to follow it after reconnecting.

Policy flags:
  --start-docker             Allow starting the inactive systemd Docker service
  --start-instance           Allow starting the existing stopped deployment
  --cleanup-preview UUID     Use the reviewed --instance-only cleanup preview
  --repair-record UUID       Allow repair and watcher attachment for this execution (repeatable)
  --recover-limit COUNT      Review up to 10 first retries for confirmed memory failures
  --recover-execution UUID --recover-attempt NUMBER [--max-resumes COUNT]
                             Review one exact failure with a retry cap
  --min-free-gib COUNT       Minimum free space on host filesystems (default 1)
  --min-memory-mib COUNT     Minimum available memory (default 512)
`;

function integer(value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error('Policy limits must be integers.');
  return Number(value);
}

try {
  const [name, stateDir, socket, variant, ...args] = process.argv.slice(2);
  if (name === '--worker' && args.length === 2) {
    await autoFixWorker(stateDir, socket, variant, args[0], JSON.parse(args[1]));
  } else {
    const { values } = parseArgs({
      args,
      options: {
        help: { type: 'boolean', short: 'h' },
        status: { type: 'boolean' },
        run: { type: 'string' },
        apply: { type: 'string' },
        'after-interruption': { type: 'string' },
        'start-docker': { type: 'boolean' },
        'start-instance': { type: 'boolean' },
        'cleanup-preview': { type: 'string' },
        'repair-record': { type: 'string', multiple: true },
        'recover-limit': { type: 'string' },
        'recover-execution': { type: 'string' },
        'recover-attempt': { type: 'string' },
        'max-resumes': { type: 'string' },
        'min-free-gib': { type: 'string' },
        'min-memory-mib': { type: 'string' },
      },
    });
    if (values.help) process.stdout.write(usage);
    else {
      let result;
      if (values.status) {
        if (Object.keys(values).some(key => !['status', 'run'].includes(key))) throw new Error('Use --status separately from apply and policy options.');
        result = await getAutoFixStatus({ name }, { runId: values.run });
      } else {
        if (values.run !== undefined || (values['after-interruption'] !== undefined && values.apply === undefined)) throw new Error('Use --run with --status and --after-interruption with --apply.');
        const recovery = { limit: integer(values['recover-limit']), execution: values['recover-execution'], attempt: integer(values['recover-attempt']), maxResumes: integer(values['max-resumes']) };
        const options = {
          name,
          stateDir,
          socket,
          variant,
          startDocker: values['start-docker'],
          startInstance: values['start-instance'],
          cleanupPreview: values['cleanup-preview'],
          repairRecords: values['repair-record'],
          recovery: Object.values(recovery).some(value => value !== undefined) ? recovery : undefined,
          minFreeGiB: integer(values['min-free-gib']),
          minMemoryMiB: integer(values['min-memory-mib']),
        };
        result = values.apply === undefined ? await previewAutoFix(options) : await applyAutoFix(options, values.apply, { afterInterruption: values['after-interruption'] });
      }
      process.stdout.write(JSON.stringify(result, (key, value) => (key === 'id' && /^[a-f0-9]{64}$/.test(value) ? `sha256:${value}` : value), 2) + '\n');
      if (['blocked', 'uncertain', 'interrupted'].includes(result.status)) process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
