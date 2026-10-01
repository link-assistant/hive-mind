#!/usr/bin/env node
// Issue #2395: replay the exact `gh pr checks` codex records from the p-vs-np#623
// and agent#323 logs through a repeated-tool-call guard.
//
//   node experiments/replay-gh-pr-checks-polling-2395.mjs            # current src/
//   node experiments/replay-gh-pr-checks-polling-2395.mjs /path/src  # e.g. a checkout of v2.33.2
//
// v2.33.2 (always on, limit 3, failures counted by input only) trips on the
// third poll of both runs; the fixed breaker is off by default and, even when
// enabled, never counts CI polling.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(process.argv[2] || join(repoRoot, 'src'));
const { createToolCallLoopGuard } = await import(pathToFileURL(join(srcDir, 'tool-call-loop-guard.lib.mjs')).href);

for (const fixture of ['issue-2395-p-vs-np-gh-pr-checks.jsonl', 'issue-2395-agent-gh-pr-checks.jsonl']) {
  for (const limit of [undefined, 3]) {
    const guard = createToolCallLoopGuard(limit === undefined ? {} : { limit });
    const lines = readFileSync(join(repoRoot, 'tests', 'fixtures', fixture), 'utf8')
      .trim()
      .split('\n');
    let poll = 0;
    for (const line of lines) {
      poll++;
      if (await guard.observeOutput(`${line}\n`)) break;
    }
    console.log(`${fixture} limit=${limit ?? 'default'}: ${guard.tripped ? `TRIPPED on poll ${poll}: ${guard.verdict.reason.slice(0, 120)}` : 'not tripped'}`);
  }
}
