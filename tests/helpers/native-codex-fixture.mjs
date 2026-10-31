// @hive-mind-test-skip
/** Static packaging fixtures. Their ELF-shaped bytes must never be executed. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function nativeCodexPackagingFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-codex-identity-fixture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const src = path.join(root, 'src');
  const platform = `linux-${process.arch}`;
  const native = path.join(src, 'native-codex');
  const runtime = path.join(native, 'runtime', platform);
  await fs.mkdir(path.join(runtime, 'licenses'), { recursive: true });
  await fs.copyFile(new URL('../../src/native-codex-runtime.lib.mjs', import.meta.url), path.join(src, 'native-codex-runtime.lib.mjs'));
  const recipe = JSON.parse(await fs.readFile(new URL('../../src/native-codex/recipe.json', import.meta.url), 'utf8'));
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const license = Buffer.from('Synthetic packaging fixture license, not upstream license text.\n');
  recipe.licenses = { LICENSE: sha256(license) };
  const recipeBytes = Buffer.from(JSON.stringify(recipe));
  const recipeSha256 = sha256(recipeBytes);
  await fs.writeFile(path.join(native, 'recipe.json'), recipeBytes);
  await fs.writeFile(path.join(runtime, 'recipe.json'), recipeBytes);
  await fs.writeFile(path.join(runtime, 'licenses/LICENSE'), license);
  // This ELF-shaped identity fixture is never executed. Full actual CLI
  // behavior is checked separately using the compiled installed npm artifact.
  const binary = Buffer.alloc(128);
  binary.set([127, 69, 76, 70, 2, 1, 1]);
  binary.writeUInt16LE(3, 16);
  binary.writeUInt16LE(recipe.targets[platform].elfMachine, 18);
  await fs.writeFile(path.join(runtime, 'codex'), binary, { mode: 0o755 });
  const compiler = `rustc ${recipe.rustToolchain} (synthetic packaging fixture)\nhost: ${recipe.targets[platform].target}\n`;
  const source = Buffer.from(JSON.stringify({ schema: 1, recipeSha256, upstreamCommit: recipe.upstreamCommit, compiler, cargoEnvironment: recipe.cargoEnvironment, sourceFiles: JSON.parse(await fs.readFile(new URL('../../src/native-codex/source-files.json', import.meta.url), 'utf8')) }));
  await fs.writeFile(path.join(runtime, 'source.json'), source);
  await fs.writeFile(path.join(runtime, 'manifest.json'), JSON.stringify({ schema: 1, platform, target: recipe.targets[platform].target, version: recipe.version, upstreamCommit: recipe.upstreamCommit, recipeSha256, sourceSha256: sha256(source), compiler, cargoEnvironment: recipe.cargoEnvironment, licenses: recipe.licenses, binary: { sha256: sha256(binary), bytes: binary.length } }));
  for (const name of ['native-codex-command.lib.mjs', 'native-agent-command.lib.mjs']) await fs.copyFile(new URL(`../../src/${name}`, import.meta.url), path.join(src, name));
  const commandApi = await import(pathToFileURL(path.join(src, 'native-codex-command.lib.mjs')));
  const api = await import(pathToFileURL(path.join(src, 'native-codex-runtime.lib.mjs')));
  return { root, runtime, api, commandApi, destination: path.join(root, 'native') };
}
