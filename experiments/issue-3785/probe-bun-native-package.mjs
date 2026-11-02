// Tiny real-Bun image-package installation; ELF-shaped fixtures are never run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeCodexPackagingFixture } from '../../tests/helpers/native-codex-fixture.mjs';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const bun = process.argv[2] || 'bun';
const cleanup = [];
const run = (command, args, env, cwd) => execute(command, args, { env, cwd, maxBuffer: 262144, timeout: 20000, killSignal: 'SIGKILL' });
try {
  for (const layout of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
    const fixture = await nativeCodexPackagingFixture({ after: operation => cleanup.push(operation) });
    const root = fixture.root;
    const source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.cp(path.join(root, 'src'), path.join(source, 'src'), { recursive: true });
    const env = { ...process.env, BUN_INSTALL: path.join(root, 'bun'), BUN_INSTALL_CACHE_DIR: path.join(root, 'cache'), PATH: `${path.join(root, 'bun/bin')}:${process.env.PATH}` };
    const version = '0.0.0-synthetic';
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: '@link-assistant/hive-mind', version, type: 'module', bin: { hive: 'src/hive.mjs' } }));
    await fs.writeFile(path.join(source, 'src/hive.mjs'), `#!/usr/bin/env node\nconsole.log('${version}');\n`, { mode: 0o755 });
    for (const name of ['verify-agent-runtime.mjs', 'codex-stock-skills-0.164.0.json', 'install-native-gemini.mjs', 'install-native-codex.mjs', 'native-gemini/recipe/manifest.json']) {
      const target = path.join(source, 'src', name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, '{}\n');
    }
    const other = process.arch === 'x64' ? 'arm64' : 'x64';
    const otherRoot = path.join(source, 'src/native-codex/runtime', `linux-${other}`);
    await fs.mkdir(otherRoot, { recursive: true });
    for (const name of ['codex', 'manifest.json']) await fs.writeFile(path.join(otherRoot, name), '{}\n');

    const stock = path.join(root, 'stock');
    await fs.mkdir(path.join(stock, 'bin'), { recursive: true });
    await fs.writeFile(path.join(stock, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.164.0', bin: { codex: 'bin/codex.js' } }));
    await fs.writeFile(path.join(stock, 'bin/codex.js'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    const { stdout } = await run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', root], env, stock);
    const archive = path.join(root, stdout.trim());
    const docker = await fs.readFile(path.join(repository, layout), 'utf8');
    const selection = docker.match(/RUN bun install ([^\n]*?)@openai\/codex@0\.164\.0/u);
    assert.ok(selection, `${layout} must retain the pinned stock package installation.`);
    await run(bun, ['install', ...selection[1].trim().split(/\s+/u), archive], env, root);
    await run('bash', [path.join(repository, 'scripts/install-image-package.sh'), source], env, root);

    const installed = path.join(env.BUN_INSTALL, 'install/global/node_modules');
    const stockRoot = path.join(installed, '@openai/codex');
    const hiveRoot = path.join(installed, '@link-assistant/hive-mind');
    const stockMetadata = await fs.stat(path.join(stockRoot, 'package.json'));
    const nativeBinary = path.join(hiveRoot, 'src/native-codex/runtime', `linux-${process.arch}`, 'codex');
    const payload = await fs.stat(nativeBinary);
    console.log(JSON.stringify({ layout, stockMetadataLinks: stockMetadata.nlink, nativePayloadLinks: payload.nlink }));
    assert.equal(stockMetadata.nlink, 1, 'Pinned stock metadata must have independent cache bytes.');
    assert.equal(payload.nlink, 1, 'Bundled native payloads must have independent cache bytes.');
    const api = await import(pathToFileURL(path.join(hiveRoot, 'src/native-codex-command.lib.mjs')));
    const command = path.join(env.BUN_INSTALL, 'bin/codex');
    const stockBefore = await fs.readFile(path.join(stockRoot, 'bin/codex.js'));
    const ready = await api.installNativeCodexCommand({ command });
    assert.equal((await api.verifyNativeCodexCommand({ command })).entrypoint, ready.entrypoint);
    const selected = await fs.lstat(command);
    assert.equal((await api.installNativeCodexCommand({ command })).entrypoint, ready.entrypoint);
    assert.equal((await fs.lstat(command)).ino, selected.ino);
    assert.deepEqual(await fs.readFile(path.join(stockRoot, 'bin/codex.js')), stockBefore);

    // Re-run a later production global install's backend without network access.
    // Existing verified bytes and the activated command must stay independent.
    const later = docker.match(/bun install ([^\n]*?)@link-assistant\/agent@0\.27\.0/u);
    assert.ok(later);
    await run(bun, ['install', ...later[1].trim().split(/\s+/u), archive], env, root);
    assert.equal((await fs.stat(nativeBinary)).nlink, 1);
    assert.equal((await fs.stat(nativeBinary)).ino, payload.ino);
    assert.equal((await fs.stat(path.join(stockRoot, 'package.json'))).nlink, 1);
    // Reinstalling the stock fixture deliberately restores its bin link; the
    // actual installer must safely reselect the same admitted generation.
    assert.equal((await api.installNativeCodexCommand({ command })).entrypoint, ready.entrypoint);
    console.log(`PASS: ${layout} installs real-Bun packages with independent bytes and activates the verified native generation idempotently.`);
  }
} finally {
  for (const operation of cleanup.reverse()) await operation();
}
