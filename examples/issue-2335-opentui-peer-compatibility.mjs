#!/usr/bin/env node
/** Reproduce the remaining upstream peer constraint without executing package scripts. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
for (const version of ['0.25.10', '0.27.0']) {
  const directory = await mkdtemp(join(tmpdir(), 'issue-2335-opentui-peer-'));
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'opentui-peer-reproduction', version: '1.0.0', private: true, dependencies: { '@opentui/core': '0.5.13', 'web-tree-sitter': version } }));
    try {
      const result = await promisify(execFile)('npm', ['install', '--package-lock-only', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund'], { cwd: directory, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=256' }, maxBuffer: 2 * 1024 * 1024 });
      results.push({ version, code: 0, ...result });
    } catch (error) {
      results.push({ version, code: error.code, stdout: error.stdout, stderr: error.stderr });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const output = new URL('../docs/case-studies/issue-2335/data/opentui-peer-reproduction.json', import.meta.url);
await writeFile(output, `${JSON.stringify(results, null, 2)}\n`);
console.log(results.map(({ version, code }) => `web-tree-sitter@${version}: exit ${code}`).join('\n'));
if (results[0].code !== 0 || results[1].code === 0 || !results[1].stderr?.includes('ERESOLVE')) process.exitCode = 1;
