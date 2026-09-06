#!/usr/bin/env node

/**
 * Issue #2187, item E — print what this host could reclaim.
 *
 * Read-only: it measures idle solver workspaces, orphaned agent snapshot
 * stores, superseded docker images, docker's own reclaimable figure and
 * superseded toolchains, then prints exactly the lines the disk gate now prints
 * before it defers work.
 *
 *   node experiments/issue-2187-reclaimable-space.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { collectReclaimableSpace, formatReclaimableSpaceLines } from '../src/reclaimable-space.lib.mjs';

// `--demo` stages a throwaway host (an idle workspace, an orphaned snapshot
// store, a superseded node version and a stubbed docker daemon) so the report
// can be seen on a machine that happens to be clean.
const demo = process.argv.includes('--demo');

const stageDemoHost = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2187-demo-'));
  const write = async (target, megabytes) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.alloc(megabytes * 1024 * 1024, 7));
  };
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await write(path.join(root, 'tmp', 'gh-issue-solver-1788000000000', 'repo', 'blob.bin'), 40);
  await fs.utimes(path.join(root, 'tmp', 'gh-issue-solver-1788000000000'), old, old);
  await write(path.join(root, 'agent', 'snapshot', 'orphan-1', 'pack.bin'), 25);
  await fs.mkdir(path.join(root, 'agent', 'storage', 'project'), { recursive: true });
  await fs.writeFile(path.join(root, 'agent', 'storage', 'project', 'orphan-1.json'), JSON.stringify({ worktree: path.join(root, 'gone') }));
  await fs.utimes(path.join(root, 'agent', 'snapshot', 'orphan-1'), old, old);
  await write(path.join(root, 'home', '.nvm', 'versions', 'node', 'v20.20.2', 'bin', 'node'), 90);
  await write(path.join(root, 'home', '.nvm', 'versions', 'node', 'v24.20.0', 'bin', 'node'), 95);
  await fs.mkdir(path.join(root, 'home', '.nvm', 'alias'), { recursive: true });
  await fs.writeFile(path.join(root, 'home', '.nvm', 'alias', 'default'), '24\n');
  await fs.mkdir(path.join(root, 'proc'), { recursive: true });

  const images = [
    { ID: 'sha256:aaa', Repository: 'konard/hive-mind', Tag: 'latest', CreatedAt: '2026-09-02 10:00:00 +0000 UTC', Size: '12.4GB' },
    { ID: 'sha256:bbb', Repository: 'konard/hive-mind', Tag: 'v2.16.0', CreatedAt: '2026-08-20 10:00:00 +0000 UTC', Size: '11.9GB' },
  ];
  const df = ['TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE', 'Images          2         1         24.3GB    11.9GB (48%)', 'Containers      1         0         0B        0B', 'Local Volumes   4         0         12.1GB    12.1GB (100%)', 'Build Cache     37        0         0B        0B'].join('\n');
  const exec = async (file, args) => {
    if (file === 'du') throw new Error('du disabled in the demo, the JS fallback is exercised instead');
    const command = args.join(' ');
    if (command.startsWith('image ls')) return { stdout: images.map(image => JSON.stringify(image)).join('\n') };
    if (command.startsWith('ps')) return { stdout: '' };
    if (command.startsWith('system df')) return { stdout: df };
    throw new Error(`unexpected: ${file} ${command}`);
  };
  return { root, options: { tmpRoot: path.join(root, 'tmp'), agentDataHome: path.join(root, 'agent'), homeDir: path.join(root, 'home'), procRoot: path.join(root, 'proc'), exec } };
};

const staged = demo ? await stageDemoHost() : null;
const summary = await collectReclaimableSpace(staged ? staged.options : {});

const lines = formatReclaimableSpaceLines(summary);
if (lines.length === 0) {
  console.log('Nothing reclaimable on this host.');
} else {
  for (const line of lines) console.log(line);
}

for (const source of summary.sources) {
  if (source.items.length === 0) continue;
  console.log(`\n${source.label}${source.command ? ` — ${source.command}` : ''}`);
  for (const item of source.items) console.log(`   ${item.label}${item.command ? ` (${item.command})` : ''}`);
}

for (const failure of summary.errors) console.log(`\n⚠️  ${failure.id}: ${failure.message}`);

if (staged) await fs.rm(staged.root, { recursive: true, force: true });
