// Run with --experimental-vm-modules. Exercise the production access decisions
// without a network call or loading the solver's unrelated runtime dependencies.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const cases = [
  { token: 'ghs_fixture_installation', permissions: { admin: false, maintain: false, pull: false, push: false, triage: false } },
  { token: 'github_pat_fixture', permissions: { push: false, pull: true } },
  { token: 'ghp_fixture', permissions: { push: true } },
];
const results = [];
for (const fixture of cases) {
  const context = vm.createContext({ console, process: { env: { GH_TOKEN: fixture.token } } });
  context.use = async () => ({ $: async () => ({ code: 0, stdout: JSON.stringify(fixture.permissions), stderr: '' }) });
  const log = async () => {};
  const ghCmdRetry = async fn => fn();
  const modules = new Map();
  const synthetic = (name, values) => {
    const module = new vm.SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      },
      { context }
    );
    modules.set(name, module);
  };
  synthetic('./use-m-bootstrap.lib.mjs', { ensureUseM: async () => {} });
  synthetic('./lib.mjs', { log, ghCmdRetry });
  synthetic('./github.lib.mjs', { detectRepositoryVisibility: async () => ({ isPublic: true }) });
  const link = async name => {
    if (!modules.has(name)) modules.set(name, new vm.SourceTextModule(readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8'), { context }));
    const module = modules.get(name);
    if (module.status === 'unlinked') await module.link(link);
    if (module.status === 'linked') await module.evaluate();
    return module;
  };
  const forkModule = new vm.SourceTextModule(readFileSync(new URL('../../src/solve.fork-detection.lib.mjs', import.meta.url), 'utf8'), {
    context,
    importModuleDynamically: link,
  });
  await forkModule.link(link);
  await forkModule.evaluate();
  const argv = { autoFork: true, fork: false };
  await forkModule.namespace.handleAutoForkOption({
    owner: 'fixture',
    repo: 'task',
    argv,
    safeExit: async () => {
      throw new Error('Unexpected exit');
    },
  });

  // Load the actual exported write-access function with the same command mock.
  const githubSource = readFileSync(new URL('../../src/github.lib.mjs', import.meta.url), 'utf8');
  const start = githubSource.indexOf('export const checkRepositoryWritePermission =');
  const end = githubSource.indexOf('\n/**', start);
  const writeModule = new vm.SourceTextModule(`import { log, ghCmdRetry } from './lib.mjs';\nimport { repositoryWriteAccess } from './github-write-access.lib.mjs';\nconst { $ } = await use('command-stream');\nconst QUIET_PROBE = {};\nconst reportError = () => {};\nconst cleanErrorMessage = String;\n${githubSource.slice(start, end)}`, { context });
  await writeModule.link(link);
  await writeModule.evaluate();
  const canProceed = await writeModule.namespace.checkRepositoryWritePermission('fixture', 'task');
  results.push({ ...fixture, fork: argv.fork, canProceed });
}
console.log(JSON.stringify(results));
