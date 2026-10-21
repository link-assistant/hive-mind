#!/usr/bin/env node
/** Run, verify and finalize one Hello World matrix row; artifacts survive cleanup. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rowExitCode, runE2eRow } from './e2e-row.lib.mjs';

const env = process.env;
env.FORMAL_AI_INSTALL_GRANT ||= 'workspace';
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
// A cancelled job sends SIGINT/SIGTERM: the runner stops its child, records
// `cancelled` and the finalize step closes the task with that outcome.
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort(new Error(`received ${signal}`)));
const evidence = await runE2eRow({
  tool: option('--tool'),
  model: option('--model'),
  isolation: option('--isolation') || 'branch',
  keep: args.includes('--keep') || env.E2E_KEEP === 'true',
  dryRun: args.includes('--dry-run'),
  issueUrl: option('--issue'),
  image: env.E2E_IMAGE || 'hive-e2e:candidate',
  hostLogDir: env.E2E_LOG_DIR || join(env.RUNNER_TEMP || tmpdir(), 'e2e-hello-world-logs'),
  env,
  deps: { signal: controller.signal },
});
if (evidence.dryRun) process.exit(0);
if (!evidence.passed && rowExitCode(evidence, { scope: env.E2E_SCOPE }) === 0) console.log(`::warning title=${evidence.tool}/${evidence.model} model verdict::The model's delivery failed; on a pull request this is advisory and the row is retried on the next commit.`);
if (evidence.finalization?.failed) console.log(`::error title=${evidence.tool}/${evidence.model} finalization::${[...evidence.finalization.errors, ...evidence.finalization.retainedBranches.map(branch => `retained ${branch}`)].join('; ')}`);
process.exitCode = rowExitCode(evidence, { scope: env.E2E_SCOPE }) || (evidence.finalization?.failed ? 1 : 0);
