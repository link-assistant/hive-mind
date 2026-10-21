// Lists files whose `hive/require-exec-timeout` finding count differs from the baseline.
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
const rootDir = process.cwd();
const name = 'require-exec-timeout';
const file = path.join(rootDir, 'eslint-rules/baselines', `${name}.json`);
const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
const eslint = new ESLint({ cwd: rootDir, overrideConfig: { rules: { [`hive/${name}`]: ['error', { baseline: {} }] } } });
const results = await eslint.lintFiles(Object.keys(baseline).map(f => path.join(rootDir, f)));
for (const r of results) {
  const rel = path.relative(rootDir, r.filePath);
  const n = r.messages.filter(m => m.ruleId === `hive/${name}`).length;
  if (n !== baseline[rel].count) console.log(`${rel}\t${baseline[rel].count} -> ${n}`);
}
