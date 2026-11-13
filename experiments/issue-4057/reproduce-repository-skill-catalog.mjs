// Issue #4057: run the real Codex binary against a synthetic checkout that has
// the same *shape* as the failing downstream repository (ten skills under
// `.agents/skills`, one under `.codex/skills`, and `.claude/skills` entries
// that are symlinks back into `.agents/skills`), then validate the
// model-visible catalog with the current Hive Mind preflight.
//
// Optional flags:
//   --host-skill        plant a user-level skill in `$HOME/.agents/skills` (host leak)
//   --outside-symlink   add `.agents/skills/linked` -> a directory outside the checkout
//
// Usage:
//   node experiments/issue-4057/reproduce-repository-skill-catalog.mjs <absolute native codex binary> [--host-skill] [--outside-symlink]
//
// No network access is used: the provider points at 127.0.0.1:1 and the key is synthetic.
import process from 'node:process';
import console from 'node:console';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const { runCodexCapabilityPreflight } = await import(path.resolve('src/codex-capability-preflight.lib.mjs'));

const binary = process.argv[2];
const withHostSkill = process.argv.includes('--host-skill');
const withOutsideSymlink = process.argv.includes('--outside-symlink');
if (!binary || !path.isAbsolute(binary)) {
  console.error('Usage: node experiments/issue-4057/reproduce-repository-skill-catalog.mjs <absolute native codex binary> [--host-skill]');
  process.exit(2);
}

const write = async (file, content) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
};
const skill = name => `---\nname: ${name}\ndescription: synthetic ${name} skill for issue 4057\n---\nbody\n`;

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-4057-'));
const canonical = path.join(root, 'canonical-codex-home');
const home = path.join(root, 'home');
const projectDir = path.join(root, 'gh-issue-solver-checkout');
for (const directory of [canonical, home, projectDir]) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
await execute('git', ['init', '-q', projectDir]);

const agentsSkills = Array.from({ length: 10 }, (_, index) => `repo-agents-skill-${index + 1}`);
for (const name of agentsSkills) await write(path.join(projectDir, '.agents', 'skills', name, 'SKILL.md'), skill(name));
await write(path.join(projectDir, '.codex', 'skills', 'repo-codex-skill', 'SKILL.md'), skill('repo-codex-skill'));
// The downstream repository mirrors two skills into `.claude/skills` as symlinks.
await fs.mkdir(path.join(projectDir, '.claude', 'skills'), { recursive: true });
for (const name of agentsSkills.slice(0, 2)) await fs.symlink(path.join('..', '..', '.agents', 'skills', name), path.join(projectDir, '.claude', 'skills', name));
await write(path.join(projectDir, 'AGENTS.md'), '# Synthetic repository\n\nFollow the repository conventions.\n');
if (withOutsideSymlink) {
  await write(path.join(root, 'outside', 'linked', 'SKILL.md'), skill('linked'));
  await fs.symlink(path.join(root, 'outside', 'linked'), path.join(projectDir, '.agents', 'skills', 'linked'));
}
if (withHostSkill) await write(path.join(home, '.agents', 'skills', 'host-only-skill', 'SKILL.md'), skill('host-only-skill'));

await fs.writeFile(path.join(canonical, 'config.toml'), 'model="gpt-5.5"\nmodel_provider="offline"\n[features]\nremote_plugin=false\napps=false\n[model_providers.offline]\nname="Offline"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\n');
await fs.writeFile(path.join(canonical, 'auth.json'), '{"OPENAI_API_KEY":"sk-SYNTHETIC"}', { mode: 0o600 });
const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: canonical, CODEX_AUTH_HOME: canonical, RUST_LOG: 'off', GIT_CONFIG_GLOBAL: '/dev/null', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost' };
const runCommand = async ({ args, env: commandEnv, cwd }) => {
  try {
    const result = await execute(binary, args, { env: commandEnv, cwd, maxBuffer: 1 << 22, timeout: 30000 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: Number.isInteger(error.code) ? error.code : 1, stdout: error.stdout || '', stderr: error.stderr || error.message };
  }
};

let exitCode = 0;
try {
  const result = await runCodexCapabilityPreflight({
    owner: 'fixture',
    repo: 'issue-4057',
    projectDir,
    baseCodexHome: canonical,
    env,
    codexPath: binary,
    runCommand,
    log: async message => console.log('  log:', String(message).trim().slice(0, 240)),
  });
  console.log('RESULT allowed:', result.skillCatalog?.map(entry => `${entry.name} [${entry.providerId}]`).join(', ') || 'none');
  await result.dispose?.();
} catch (error) {
  exitCode = 1;
  console.log('RESULT failed:', error.name, error.message.slice(0, 600));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
process.exit(exitCode);
