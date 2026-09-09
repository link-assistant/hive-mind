#!/usr/bin/env node

/**
 * Issue #2233 — does the draft command survive solve's own parser?
 *
 * The workflow builds a solve command line in `scripts/formal-ai-draft.lib.mjs`.
 * A typo there fails 90 minutes into a container run, in a log nobody reads. So
 * this probe feeds the built argv to solve's real yargs configuration and prints
 * what came out, including how the issue URL binds.
 *
 * Two measured facts this probe established, both of which the test now encodes:
 *
 *   1. solve declares `.command('$0 <issue-url>')`, so the URL lands on
 *      `argv.issueUrl` and `argv._` is EMPTY. An assertion on `argv._` would
 *      have failed against a correct command line.
 *   2. `--no-auto-restart-until-mergeable` reaches the parser as
 *      `autoRestartUntilMergeable: false` (boolean-negation is enabled).
 *
 * Run: node experiments/issue-2233/probe-solve-argv.mjs
 *
 * Note: this must be a real file. `node -e "import(...)"` fails inside the
 * use-m bootstrap with ERR_INVALID_ARG_VALUE, because `createRequire('[eval]')`
 * is not a path.
 */

import { buildSolveArgv, DRAFT_SOLVE_FLAGS, FORBIDDEN_DRAFT_SOLVE_FLAGS } from '../../scripts/formal-ai-draft.lib.mjs';
import { createYargsConfig } from '../../src/solve.config.lib.mjs';
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
import { resolveYargsFactory } from '../../src/yargs-factory.lib.mjs';

const issueUrl = process.argv[2] || 'https://github.com/link-assistant/hive-mind/issues/2233';
const logDir = process.argv[3] || '/home/box/logs';

const argvList = buildSolveArgv({ issueUrl, logDir });
console.log('built command line:\n  solve', argvList.join(' '), '\n');

const use = await ensureUseM();
const yargs = resolveYargsFactory(await use('yargs@17.7.2'));
const argv = await createYargsConfig(yargs(argvList)).parse();

console.log(
  'parsed:',
  JSON.stringify(
    {
      _: argv._,
      issueUrl: argv.issueUrl,
      tool: argv.tool,
      model: argv.model,
      attachLogs: argv.attachLogs,
      verbose: argv.verbose,
      attribution: argv.attribution,
      logDir: argv.logDir,
      autoRestartUntilMergeable: argv.autoRestartUntilMergeable,
      autoMerge: argv.autoMerge,
      autoClosePullRequestOnFail: argv.autoClosePullRequestOnFail,
    },
    null,
    2
  )
);

console.log('\nflags passed:', DRAFT_SOLVE_FLAGS.join(' '));
console.log('flags never passed:', FORBIDDEN_DRAFT_SOLVE_FLAGS.join(' '));

// The parser is strict; prove it, so "it parsed" means something.
let rejected = false;
try {
  await createYargsConfig(yargs([issueUrl, '--attatch-logs']))
    .fail(false)
    .parse();
} catch (error) {
  rejected = /unknown argument/i.test(error.message);
}
console.log(`\nstrict mode rejects a typo (--attatch-logs): ${rejected}`);
