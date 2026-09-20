#!/usr/bin/env node

import { spawn } from 'child_process';

const gistId = process.argv[2] || '35d63558e0013785b384033f584d1717';

const oldCaseCode = ["globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;", "const { $ } = await use('command-stream');", `await $\`gh api gists/${gistId} --jq '{owner: .owner.login, files: .files, history: .history}'\`;`].join('\n');

const fixedCaseCode = ["globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;", "const { $ } = await use('command-stream');", 'const $silent = $({ mirror: false, capture: true });', `const result = await $silent\`gh api gists/${gistId} --jq '{owner: .owner.login, history: .history, fileNames: (.files | keys)}'\`;`, 'if (result.code !== 0) process.exit(result.code);'].join('\n');

const runCaseWithClosedStdoutPipe = (label, childCode, destroyStdoutImmediately) =>
  new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childCode], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    if (destroyStdoutImmediately) {
      child.stdout.destroy();
    }

    child.on('close', (code, signal) => {
      resolve({ label, code, signal, stdout, stderr });
    });
  });

const summarize = result => {
  const lines = [];
  lines.push(`CASE ${result.label}`);
  lines.push(`code=${result.code} signal=${result.signal || ''}`.trim());
  if (result.stderr.trim()) {
    lines.push('stderr:');
    lines.push(result.stderr.trim());
  }
  if (result.stdout.trim()) {
    lines.push('stdout:');
    lines.push(result.stdout.trim().slice(0, 400));
  }
  return lines.join('\n');
};

const oldCase = await runCaseWithClosedStdoutPipe('old-query', oldCaseCode, true);
const fixedCase = await runCaseWithClosedStdoutPipe('fixed-query', fixedCaseCode, true);

console.log(summarize(oldCase));
console.log('');
console.log(summarize(fixedCase));
console.log('');

const oldFailedWithEpipe = oldCase.code !== 0 && /EPIPE/.test(oldCase.stderr);
const fixedSucceeded = fixedCase.code === 0 && !/EPIPE/.test(fixedCase.stderr);

if (!oldFailedWithEpipe) {
  console.error('Expected old query to fail with EPIPE after stdout pipe closure');
  process.exit(1);
}

if (!fixedSucceeded) {
  console.error('Expected fixed query to succeed after stdout pipe closure');
  process.exit(1);
}

console.log('VERDICT old-query reproduces EPIPE, fixed-query avoids it');
