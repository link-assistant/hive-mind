/** @hive-mind-test-suite default,pr-essential */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { AGENTIC_CLI_TARGETS, isAgenticCliAutoUpdateEnabled, listAgenticCliUpdateTargets, rememberInstalledCodexStock, updateAgenticClisWhenIdle } from '../src/agentic-cli-updater.lib.mjs';
import { buildStartCommandArgs } from '../src/isolation-runner.lib.mjs';
import { validateAgentConfigAuditInputs } from '../src/agent-config-audit-inputs.lib.mjs';
import { CodexStockBaselineError } from '../src/codex-stock-skills.lib.mjs';

const execFileAsync = promisify(execFile);
const agenticIds = ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen', 'copilot'];
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

for (const dockerfile of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
  test(`${dockerfile} allows the bundled CLIs to update by default`, async () => {
    const content = await read(dockerfile);
    const excluded = content.match(/^ENV HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE=([^\n]*)/mu)?.[1];
    const env = excluded === undefined ? {} : { HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE: excluded };
    assert.equal(isAgenticCliAutoUpdateEnabled(env), true);
    assert.deepEqual(
      listAgenticCliUpdateTargets(env, { only: agenticIds })
        .map(({ id }) => id)
        .sort(),
      [...agenticIds].sort()
    );
    assert.deepEqual(listAgenticCliUpdateTargets(env), AGENTIC_CLI_TARGETS);
  });

  test(`${dockerfile} resolves stable upstream CLI releases at build time`, async () => {
    const content = await read(dockerfile);
    assert.match(content, /bash \/tmp\/claude-code-install\.sh latest/u);
    for (const { package: packageName } of AGENTIC_CLI_TARGETS.filter(({ id }) => agenticIds.includes(id) && id !== 'claude')) {
      assert.ok(content.includes(`${packageName}@latest`), `Missing a fresh installation of ${packageName}`);
    }
    assert.match(content, /ARG HIVE_MIND_AGENTIC_CLI_REFRESH/u);
  });
}

test('Docker task launch passes explicit CLI update settings, including an empty exclusion', async () => {
  const options = { backend: 'docker', tool: 'copilot', existsSync: () => false };
  const prefix = 'HIVE_MIND_AGENTIC_CLI_';
  const updateArgs = args => args.filter((arg, index) => args[index - 1] === '-e' && arg.startsWith(prefix));
  assert.deepEqual(updateArgs(await buildStartCommandArgs('solve', [], { ...options, env: {} })), []);
  assert.deepEqual(
    updateArgs(
      await buildStartCommandArgs('solve', [], {
        ...options,
        env: {
          HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE: '0',
          HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'agent,codex',
          HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE: '',
          HIVE_MIND_AGENTIC_CLI_UNRELATED: 'not-forwarded',
        },
      })
    ).sort(),
    [`${prefix}AUTO_UPDATE=0`, `${prefix}UPDATE_EXCLUDE=`, `${prefix}UPDATE_ONLY=agent,codex`]
  );
  assert.deepEqual(
    listAgenticCliUpdateTargets({ HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE: 'codex,gemini' }, { only: agenticIds }).map(({ id }) => id),
    ['claude', 'agent', 'qwen', 'copilot', 'opencode']
  );
});

for (const dockerfile of ['Dockerfile', 'Dockerfile.dind']) {
  test(`${dockerfile} keeps native dispatchers on PATH after Box sources its shell profile`, async t => {
    const home = await mkdtemp(path.join(tmpdir(), 'hive-4168-profile-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const bashrc = path.join(home, '.bashrc');
    await writeFile(bashrc, 'export PATH="$HOME/.bun/bin:$PATH"\n');
    const content = await read(dockerfile);
    const install = content.match(/^RUN (echo 'export PATH="\$HOME\/\.local\/bin:\$PATH"' >> "\$HOME\/\.bashrc")$/mu);
    assert.ok(install, 'Missing dispatcher PATH precedence in the shell profile');
    const { stdout } = await execFileAsync('bash', ['-c', `${install[1]} && source "$HOME/.bashrc" && printf '%s' "$PATH"`], { env: { HOME: home, PATH: '/usr/bin:/bin' } });
    assert.deepEqual(stdout.split(path.delimiter).slice(0, 2), [path.join(home, '.local/bin'), path.join(home, '.bun/bin')]);
    assert.match(content, /^RUN --network=none \/usr\/local\/bin\/entrypoint\.sh node .*verify-agent-runtime\.mjs/mu);
  });
}

test('the new Codex catalog and its recorded predecessor are audited by content', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'hive-4168-stock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bun', 'bin');
  const home = path.join(root, 'home');
  const stock = path.join(home, '.codex', 'skills', '.system');
  const command = path.join(bin, 'codex');
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(stock, 'new-skill'), { recursive: true });
  const install = (version, content) =>
    writeFile(
      command,
      `#!${process.execPath}
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
if (process.argv.includes('--version')) {
  console.log('codex-cli ${version}');
} else {
  const directory = path.join(process.env.CODEX_HOME, 'skills', '.system', 'new-skill');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'SKILL.md');
  await writeFile(file, ${JSON.stringify(content)});
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const { id, method } = JSON.parse(line);
    const result = method === 'skills/list' ? { data: [{ cwd: process.cwd(), errors: [], skills: [{ path: file, name: 'new-skill', scope: 'system', enabled: true }] }] } : {};
    if (id) console.log(JSON.stringify({ id, result }));
  }
}
`,
      { mode: 0o700 }
    );
  const env = { HIVE_MIND_IMAGE_NATIVE_BIN: path.join(root, 'native'), BUN_INSTALL: path.dirname(bin), HIVE_MIND_STATE_DIR: path.join(root, 'state') };
  const check = () => validateAgentConfigAuditInputs({ tool: 'codex', homeDir: home, env, systemRoots: { codex: path.join(root, 'managed') } });
  const skill = path.join(stock, 'new-skill', 'SKILL.md');
  await install('0.171.0', 'previous upstream content');
  await writeFile(skill, 'previous upstream content');
  await check();

  const update = await updateAgenticClisWhenIdle({
    env,
    only: ['codex'],
    getActiveTasksImpl: async () => [],
    run: async (binary, args) => {
      if (binary === 'npm') return { stdout: '0.172.0' };
      if (binary === 'bun') {
        await install('0.172.0', 'current upstream content');
        return {};
      }
      assert.equal(binary, command);
      return execFileAsync(command, args);
    },
  });
  assert.deepEqual(update.updated, [{ id: 'codex', from: '0.171.0', to: '0.172.0' }]);
  await check(); // A stock tree written before the binary update remains valid.
  await writeFile(skill, 'current upstream content');
  await check();
  // A replacement image brings its own CLI and retains the bot's state.
  await rememberInstalledCodexStock({ env });
  await install('0.173.0', 'replacement image content');
  await check();
  await writeFile(skill, 'replacement image content');
  await check();
  await writeFile(skill, 'modified content');
  await assert.rejects(check(), CodexStockBaselineError);
});
