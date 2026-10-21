#!/usr/bin/env node
// Issue #3125: shows on this Linux host that the BASH_ENV hook raises the OOM
// score of an AI tool shell and of the build it starts, while the AI CLI keeps
// its own score. No privileges are needed.
//
// It does not trigger a real OOM kill. The "build" allocates 64 MiB inside
// `ulimit -v` (1 GiB of address space), so it cannot take the host down. The
// kernel's badness (/proc/<pid>/oom_score) is printed for each process instead;
// the OOM killer picks the highest one.
//
// Usage: node experiments/issue-3125-tool-shell-oom-score.mjs
/* global process, console */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { armToolShellOomScoreAdj } from '../src/tool-shell-oom-score.lib.mjs';

if (process.platform !== 'linux') {
  console.log('Linux only.');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-oom-3125-'));
try {
  const env = { PATH: process.env.PATH, HOME: dir, SHLVL: '1' };
  console.log('Armed:', armToolShellOomScoreAdj({ env, platform: 'linux', dir }));

  // Stand-in AI CLI: runs one tool command with `bash -c`, like Claude Code's Bash tool.
  const cli = path.join(dir, 'fake-cli.cjs');
  fs.writeFileSync(
    cli,
    `const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const score = pid => fs.readFileSync('/proc/' + pid + '/oom_score_adj', 'utf8').trim() + ' (badness ' + fs.readFileSync('/proc/' + pid + '/oom_score', 'utf8').trim() + ')';
console.log('AI CLI       pid ' + process.pid + ': oom_score_adj ' + score(process.pid));
process.stdout.write(execFileSync('bash', ['-c', process.argv[2]], { encoding: 'utf8' }));
`
  );

  // The "build": tail holds 64 MiB until its input ends, bounded by ulimit -v.
  const build = `ulimit -v 1048576
echo "tool shell   pid $$: oom_score_adj $(cat /proc/$$/oom_score_adj) (badness $(cat /proc/$$/oom_score))"
{ head -c 67108864 /dev/zero; sleep 1; } | tail -c 67108864 > /dev/null &
build=$!
sleep 0.5
echo "build        pid $build: oom_score_adj $(cat /proc/$build/oom_score_adj 2>/dev/null) (badness $(cat /proc/$build/oom_score 2>/dev/null))"
wait $build`;

  // solve starts the CLI from a shell; a bash launcher is the case the launcher guard covers.
  process.stdout.write(execFileSync('bash', ['-c', `"${process.execPath}" "${cli}" "$0"; true`, build], { env, encoding: 'utf8' }));
  console.log(`solve        pid ${process.pid}: oom_score_adj ${fs.readFileSync('/proc/self/oom_score_adj', 'utf8').trim()}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
