// Exercise the production scheduler with complete and skipped GitHub runs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { E2E_MATRIX } from '../../scripts/e2e-hello-world.lib.mjs';

const scenario = process.argv[2] || 'skipped';
const currentTag = 'v0.352.1';
const files = new Map();
const requests = [];
let output = '';
let lastDownload;
const rows = E2E_MATRIX.map(({ tool, model }) => ({ name: `${tool} / ${model}`, status: 'completed', conclusion: 'success' }));
const candidateRows = scenario === 'complete' ? rows : scenario === 'missing' ? rows.slice(1) : rows.map(row => ({ ...row, conclusion: scenario === 'failed' ? 'failure' : 'skipped' }));
const exportsFor = {
  'node:fs': {
    appendFileSync: (_, text) => {
      output += text;
    },
    mkdirSync() {},
    readFileSync: file => {
      if (!files.has(file)) throw new Error('Artifact missing');
      return files.get(file);
    },
    writeFileSync: (file, text) => files.set(file, text),
  },
  'node:fs/promises': { mkdtemp: async () => '/tmp/matrix-metadata-fixture', rm: async () => {} },
  'node:os': { tmpdir: () => '/tmp' },
  'node:path': { join },
  './e2e-hello-world.lib.mjs': { E2E_MATRIX },
  './github-actions.lib.mjs': {
    ghJson: async args => {
      requests.push(args);
      if (args[0] === 'release') return { tagName: currentTag };
      if (args[1] === 'list') return [{ databaseId: 2 }, { databaseId: 1 }];
      if (args[1] === 'view') return { jobs: args[2] === '2' ? candidateRows : rows };
      throw new Error(`Unexpected request: ${args.join(' ')}`);
    },
    gh: async args => {
      requests.push(args);
      lastDownload = args[2];
      files.set(join(args.at(-1), 'matrix.json'), JSON.stringify({ formalAiTag: args[2] === '2' ? currentTag : 'v0.351.0' }));
    },
  },
};
const context = vm.createContext({ process: { env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_EVENT_NAME: 'schedule', GITHUB_OUTPUT: '/tmp/output', E2E_METADATA_DIR: '/tmp/result' } }, console: { log() {} } });
const script = new vm.SourceTextModule(readFileSync(new URL('../../scripts/e2e-matrix-schedule.mjs', import.meta.url), 'utf8'), { context });
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
console.log(JSON.stringify({ scenario, output, lastDownload, requests, metadata: JSON.parse(files.get('/tmp/result/matrix.json')) }));
