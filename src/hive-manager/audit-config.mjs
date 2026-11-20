import { runAgentConfigAudit } from '../agent-config-audit.lib.mjs';

const args = process.argv.slice(2);
const usage = 'Usage: hive-manager audit-config [--repair]\nAudit global agent settings and quarantine supported additions with --repair.\n';
if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
  process.stdout.write(usage);
} else if (args.length > 1 || (args.length === 1 && args[0] !== '--repair')) {
  process.stderr.write(usage);
  process.exitCode = 1;
} else {
  try {
    await runAgentConfigAudit({ env: process.env, autoRepair: args[0] === '--repair', requireClean: true, log: async message => console.log(message) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
