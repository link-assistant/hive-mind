/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareDockerIsolationHostPaths } from '../src/isolation-runner.mounts.lib.mjs';

const layouts = { claude: ['.claude', 'projects'], codex: ['.codex', 'sessions'], agent: ['selected-data', 'link-assistant-agent'], opencode: ['selected-data', 'opencode'] };

async function fixture(t, tool) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-history-path-'));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const [directory, child] = layouts[tool];
  const parent = path.join(homeDir, directory);
  const foreign = path.join(homeDir, 'foreign');
  await fs.mkdir(parent);
  await fs.mkdir(foreign);
  const protectedFile = path.join(foreign, 'auth-and-history-sentinel');
  await fs.writeFile(protectedFile, 'synthetic protected state', { mode: 0o640 });
  const before = await fs.stat(protectedFile);
  const unchanged = async () => {
    assert.deepEqual(await fs.readdir(foreign), ['auth-and-history-sentinel'], 'preparation must not create directories through a replaced parent');
    assert.equal(await fs.readFile(protectedFile, 'utf8'), 'synthetic protected state');
    const after = await fs.stat(protectedFile);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
  };
  return { parent, foreign, child, unchanged, options: { tool, homeDir, env: { XDG_DATA_HOME: parent } } };
}

for (const tool of Object.keys(layouts)) {
  test(`${tool} rejects a linked history/data parent without touching its target`, async t => {
    const { parent, foreign, unchanged, options } = await fixture(t, tool);
    await fs.rmdir(parent);
    await fs.symlink(foreign, parent);
    await assert.rejects(prepareDockerIsolationHostPaths(options), /(?:history|data).*unavailable|shared tool data/iu);
    await unchanged();
  });

  test(`${tool} parent replacement during directory creation cannot write through the replacement`, { skip: process.platform !== 'linux' }, async t => {
    const { parent, foreign, child, unchanged, options } = await fixture(t, tool);
    let replaced = false;
    const fsImpl = {
      promises: {
        ...fs,
        mkdir: async (target, settings) => {
          if (!replaced && path.basename(target) === child) {
            replaced = true;
            await fs.rename(parent, `${parent}-original`);
            await fs.symlink(foreign, parent);
          }
          return fs.mkdir(target, settings);
        },
      },
    };
    await assert.rejects(prepareDockerIsolationHostPaths({ ...options, fsImpl }), /(?:history|data).*unavailable|shared tool data/iu);
    assert.equal(replaced, true, 'exercise the replacement at the actual mkdir boundary');
    await unchanged();
  });
}
