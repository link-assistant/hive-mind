/** Establish the upstream Codex stock catalog in an empty, credential-free home. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverCodexStock, executeVersionProbe, withRuntimeProbeHome } from './agent-runtime-probe.lib.mjs';
import { assertCodexStockSkillDiscovery } from './codex-stock-catalog.lib.mjs';
import { captureCodexStockSkills } from './codex-stock-skills.lib.mjs';

let cached;

async function fileRevision(file) {
  const info = await fs.stat(file, { bigint: true });
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}

export async function getInstalledCodexStockManifest(env) {
  const command = path.join(env.BUN_INSTALL, 'bin', 'codex');
  const entrypoint = await fs.realpath(command);
  // The npm package can keep its JavaScript launcher while changing which
  // platform-specific Codex build it depends on.
  const packageManifest = path.resolve(path.dirname(entrypoint), '../package.json');
  const [launcherRevision, packageRevision] = await Promise.all([
    fileRevision(entrypoint),
    fileRevision(packageManifest).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    }),
  ]);
  const revision = `${entrypoint}:${launcherRevision}:${packageRevision}`;
  if (cached?.revision === revision) return cached.manifest;
  const manifest = withRuntimeProbeHome(async ({ home, cwd, env: probeEnv }) => {
    const { stdout } = await executeVersionProbe(command, { env: probeEnv, cwd, maxBuffer: 64 * 1024 });
    const cliVersion = stdout.trim();
    if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/u.test(cliVersion)) throw new Error('Installed upstream Codex did not report a version.');
    const result = await discoverCodexStock(command, cwd, probeEnv);
    const files = await captureCodexStockSkills(path.join(home, '.codex/skills/.system'));
    const captured = { cliVersion, files };
    assertCodexStockSkillDiscovery({ result, home, cwd, manifest: captured });
    return captured;
  });
  cached = { revision, manifest };
  try {
    return await manifest;
  } catch (error) {
    if (cached?.manifest === manifest) cached = undefined;
    throw error;
  }
}
