// Replay the issue #2549 regressions against the source before this fix.
// All GitHub writes are mocked. The checkout and branch are left untouched.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'issue-2549-baseline-'));
const baseline = '03dcb2e6';
const restored = ['pull-request-changes.lib.mjs', 'solve.results.lib.mjs', 'solve.restart-shared.lib.mjs', 'pr-issue-linking.lib.mjs', 'pr-issue-link-repair.lib.mjs', 'solve.progress-monitoring.lib.mjs', 'solve.config.lib.mjs'];
try {
  mkdirSync(join(directory, 'src'));
  mkdirSync(join(directory, 'tests'));
  for (const entry of readdirSync(join(root, 'src'))) {
    if (!restored.includes(entry)) symlinkSync(join(root, 'src', entry), join(directory, 'src', entry));
  }
  for (const file of restored) writeFileSync(join(directory, 'src', file), execFileSync('git', ['show', `${baseline}:src/${file}`], { cwd: root }));
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
  const test = 'pr-description-preservation-2549.test.mjs';
  writeFileSync(join(directory, 'tests', test), readFileSync(join(root, 'tests', test)));
  const result = spawnSync(process.execPath, [join(directory, 'tests', test)], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
