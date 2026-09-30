// Drive the real integration test without GitHub or a preconfigured global identity.
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';

const operations = [];
const identity = {};
const context = vm.createContext({ process: { env: {}, execPath: process.execPath }, console: { log() {}, error() {} }, URL });
const exportsFor = {
  'node:assert/strict': {
    default: {
      match(value, pattern) {
        if (!pattern.test(value)) throw new Error('Prompt assertion failed');
      },
      deepEqual() {},
    },
  },
  'node:child_process': {
    execFile: (command, args, options, callback) => {
      if (typeof options === 'function') callback = options;
      operations.push({ command, args });
      if (command === 'git') identity[args.at(-2)] = args.at(-1);
      const error = command !== 'git' && (!identity['user.name'] || !identity['user.email']) ? new Error('Git identity not configured') : null;
      callback(error, { stdout: 'Issue to solve:\nNew comments on the pull request: 2\n', stderr: '' });
    },
  },
  'node:util': { promisify },
  'node:fs/promises': { mkdtemp: async () => '/tmp/fixture', writeFile: async () => {}, rm: async () => {} },
  'node:os': { tmpdir },
  'node:path': { join },
  'node:crypto': { randomUUID: () => 'fixture' },
  'node:timers/promises': { setTimeout: async () => {} },
  '../scripts/github-actions.lib.mjs': {
    gh: async () => {},
    ghApi: async endpoint => (endpoint.endsWith('/pulls') ? { number: 2, html_url: 'https://github.com/fixture/task/pull/2' } : { sha: 'fixture', object: { sha: 'fixture' } }),
  },
  '../scripts/task-fixture.lib.mjs': {
    fixtureBranch: () => 'e2e/integration/fixture',
    createBranchFixture: async () => ({ issueNumber: 1, branches: [] }),
    cleanupBranchFixture: async () => [],
  },
};
const script = new vm.SourceTextModule(readFileSync(new URL('../../tests/test-feedback-lines-integration.mjs', import.meta.url), 'utf8'), {
  context,
  initializeImportMeta: meta => {
    meta.url = new URL('../../tests/test-feedback-lines-integration.mjs', import.meta.url).href;
  },
});
await script.link(
  specifier =>
    new vm.SyntheticModule(
      Object.keys(exportsFor[specifier]),
      function () {
        for (const [name, value] of Object.entries(exportsFor[specifier])) this.setExport(name, value);
      },
      { context }
    )
);
await script.evaluate();
console.log(JSON.stringify(operations));
