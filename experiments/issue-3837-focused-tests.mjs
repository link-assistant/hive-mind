/** Run the prompt-related regression targets sequentially within a bounded heap. */
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const targets = readFileSync(new URL('./issue-3837-focused-targets.txt', import.meta.url), 'utf8')
  .trim()
  .split('\n');
const logDirectory = process.argv[2] || '/tmp/issue-3837-focused-tests';
mkdirSync(logDirectory, { recursive: true });
let failures = 0;
for (const target of targets) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=192', '--import', './experiments/issue-3837-installed-dependencies.mjs', target], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(`${logDirectory}/${target.split('/').pop()}.log`, `${result.stdout || ''}${result.stderr || ''}`);
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${target}${result.error ? `: ${result.error.message}` : ''}`);
  if (result.status !== 0) failures++;
}
process.exitCode = failures ? 1 : 0;
