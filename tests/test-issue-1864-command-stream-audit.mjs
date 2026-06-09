#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1864: production command execution should prefer command-stream.
 * Native child_process usage is allowed only where command-stream still lacks
 * the needed process-control, sync, timeout, or execFile-style semantics.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const allowedNativeProcessFiles = new Map([
  ['create-test-repo.mjs', 'sync git push and command-stream quoting workarounds documented in command-stream issue research'],
  ['cleanup-test-repos.mjs', 'interactive prompt reads plus spawnSync argv-array gh deletion loop'],
  ['scripts/preinstall-use-m-packages.mjs', 'preinstall script needs sync npm root lookup before use-m packages are available'],
  ['scripts/detect-code-changes.mjs', 'CI helper uses sync git fetch/diff for process-exit driven workflow gating'],
  ['scripts/validate-changeset.mjs', 'CI helper uses sync git fetch/diff for process-exit driven workflow gating'],
  ['scripts/check-version.mjs', 'release check uses sync git diff during package-script startup'],
  ['scripts/upload-sourcemaps.mjs', 'release helper streams installer/uploader output synchronously to inherited stdio'],
  ['scripts/free-disk-space.mjs', 'CI cleanup helper deliberately streams sudo/docker cleanup commands to inherited stdio'],
  ['scripts/run-tests.mjs', 'test runner must spawn isolated Node test processes with inherited stdio'],
  ['src/hive-screens.lib.mjs', 'screen attach/close requires argv-array spawn and inherited TTY behavior'],
  ['src/telegram-command-execution.lib.mjs', 'deprecated start-screen execution still needs child lifecycle callbacks and captured pipes'],
  ['src/solve.auto-continue.lib.mjs', 'auto-continue resume launches a detached child process with explicit stdio handling'],
  ['src/hive.mjs', 'worker launch and graceful shutdown require detached process groups and signal forwarding'],
  ['src/task.mjs', 'task command execution streams child stdout/stderr with lifecycle callbacks'],
  ['src/version-info.lib.mjs', 'version probes rely on child_process timeout semantics not currently exposed by command-stream'],
  ['src/interactive-mode.shared.lib.mjs', 'execFile-style argv-array execution with stdin/maxBuffer support'],
  ['src/cleanup.os.lib.mjs', 'offline cleanup uses sync execFile with argv arrays and timeouts by design'],
  ['src/task.issue-creation.lib.mjs', 'issue creation path streams child output through lifecycle callbacks'],
  ['src/cleanup.mjs', 'interactive cleanup prompt read uses sync shell stdin handling'],
  ['src/models/index.mjs', 'codex model discovery uses execFile argv arrays and maxBuffer'],
]);

const migratedFiles = ['src/command-stream-exec.lib.mjs', 'src/github-rate-limit.lib.mjs', 'src/github-merge.lib.mjs', 'src/github-merge-ci.lib.mjs', 'src/github-merge-ci-signals.lib.mjs', 'src/github-merge-ready-sync.lib.mjs', 'src/github-merge-repo-actions.lib.mjs', 'src/solve.accept-invite.lib.mjs', 'src/telegram-accept-invitations.lib.mjs', 'src/limits.lib.mjs', 'src/git.lib.mjs', 'src/session-monitor.lib.mjs', 'src/telegram-solve-queue.helpers.lib.mjs', 'src/hive.recheck.lib.mjs', 'src/start-screen.mjs', 'src/telegram-top-command.lib.mjs'];

const nativeProcessPattern = /(?:import\s+[\s\S]*?\sfrom\s+['"](?:node:)?child_process['"]|await\s+import\(['"](?:node:)?child_process['"]\)|require\(['"](?:node:)?child_process['"]\))/g;

async function collectMjsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMjsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(full);
    }
  }
  return files;
}

function matchLines(source, pattern) {
  const lines = source.split('\n');
  const matches = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length;
    matches.push(`${line}: ${lines[line - 1].trim()}`);
  }
  return matches;
}

const rootFiles = (await readdir(repoRoot, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.mjs')).map(entry => path.join(repoRoot, entry.name));
const productionFiles = [...rootFiles, ...(await collectMjsFiles(path.join(repoRoot, 'src'))), ...(await collectMjsFiles(path.join(repoRoot, 'scripts')))].sort();

const unexpectedNativeImports = [];
const seenAllowed = new Set();

for (const file of productionFiles) {
  const rel = path.relative(repoRoot, file);
  const source = await readFile(file, 'utf8');
  const lines = matchLines(source, nativeProcessPattern);
  if (lines.length === 0) continue;
  if (allowedNativeProcessFiles.has(rel)) {
    seenAllowed.add(rel);
  } else {
    unexpectedNativeImports.push(`${rel}\n${lines.map(line => `  ${line}`).join('\n')}`);
  }
}

assert.deepEqual(unexpectedNativeImports, [], `Unexpected native child_process usage; migrate to command-stream or add a documented exception:\n${unexpectedNativeImports.join('\n\n')}`);

const staleAllowlist = [...allowedNativeProcessFiles.keys()].filter(file => !seenAllowed.has(file));
assert.deepEqual(staleAllowlist, [], `Remove stale issue #1864 native-process exceptions:\n${staleAllowlist.join('\n')}`);

for (const rel of migratedFiles) {
  const source = await readFile(path.join(repoRoot, rel), 'utf8');
  nativeProcessPattern.lastIndex = 0;
  assert.equal(nativeProcessPattern.test(source), false, `${rel} must not import child_process after issue #1864 migration`);
}

const githubRateLimitSource = await readFile(path.join(repoRoot, 'src/github-rate-limit.lib.mjs'), 'utf8');
assert.match(githubRateLimitSource, /commandStreamExec/, 'central gh exec retry wrapper should execute through command-stream');

console.log('✅ Issue #1864 command-stream native process audit passed');
