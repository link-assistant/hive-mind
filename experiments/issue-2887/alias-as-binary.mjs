#!/usr/bin/env node
/**
 * Issue #2887 experiment: run both spellings of a kill-recovery command the way
 * start-command runs `$ --resume <id> -- <command>` — through `sh -c` — with a
 * stub `solve` on PATH that prints its argv.
 *
 *   node experiments/issue-2887/alias-as-binary.mjs
 *
 * Expected output (after the fix):
 *   display → exit 127, "sh: 1: /codex: not found"   (what the incident ran)
 *   shell   → exit 0, the stub received the persisted argv unchanged
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildResumeCommand } from '../../src/session-resume.lib.mjs';

const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2887-'));
fs.writeFileSync(path.join(bin, 'solve'), '#!/bin/sh\nfor a in "$@"; do printf "  argv: %s\\n" "$a"; done\n', { mode: 0o755 });

const command = buildResumeCommand({
  sessionInfo: {
    command: 'solve',
    commandAlias: 'codex',
    url: 'https://github.com/link-assistant/router/issues/728',
    args: ['https://github.com/link-assistant/router/issues/728', '--tool', 'codex', '--think', 'xhigh', '--prompt', "it's $HOME"],
  },
  lastSessionId: '01a1200a-276e-76b2-9674-c219f0f54121',
});

const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
for (const form of ['display', 'shell']) {
  console.log(`\n${form}: sh -c ${JSON.stringify(command[form])}`);
  const result = spawnSync('sh', ['-c', command[form]], { env, encoding: 'utf8' });
  process.stdout.write(result.stdout);
  if (result.stderr) process.stdout.write(result.stderr.replace(/^(?=.)/gm, '  stderr: '));
  console.log(`  exit ${result.status}`);
}

fs.rmSync(bin, { recursive: true, force: true });
console.log(`\nsh: ${execFileSync('sh', ['-c', 'readlink -f "$(command -v sh)"'], { encoding: 'utf8' }).trim()}`);
