#!/usr/bin/env node
// Issue #4063: print the user-prompt notice the AI gets (default --uncommitted-changes-after-clone warn-ai)
// for the java-ai-driven-development-pipeline-template state plus one real change.
// Usage: node experiments/issue-4063-clone-status-prompt.mjs [--uncommitted-changes-after-clone MODE] [--no-neutralize]
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleUncommittedChangesAfterClone } from '../src/clone-status.lib.mjs';

const mode = process.argv.includes('--uncommitted-changes-after-clone') ? process.argv[process.argv.indexOf('--uncommitted-changes-after-clone') + 1] : undefined;
const root = await mkdtemp(path.join(os.tmpdir(), 'issue-4063-prompt-'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
try {
  const origin = path.join(root, 'origin');
  git(root, 'init', '-q', '-b', 'main', origin);
  git(origin, 'config', 'core.autocrlf', 'false');
  await writeFile(path.join(origin, 'mvnw.cmd'), '@echo off\r\necho hi\r\n');
  await writeFile(path.join(origin, 'pom.xml'), '<project/>\n');
  git(origin, 'add', '.');
  await writeFile(path.join(origin, '.gitattributes'), '/mvnw.cmd text eol=crlf\n');
  git(origin, 'add', '.gitattributes');
  git(origin, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init');
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', origin, clone);
  await writeFile(path.join(clone, 'pom.xml'), '<project>changed</project>\n');
  const statusOutput = git(clone, 'status', '--porcelain').trimEnd();
  const log = async (message, options = {}) => console.error(`[log${options.verbose ? ' verbose' : options.level ? ` ${options.level}` : ''}] ${message}`);
  const result = await handleUncommittedChangesAfterClone({ cwd: clone, argv: { uncommittedChangesAfterClone: mode, neutralizeCheckoutConversionArtifacts: !process.argv.includes('--no-neutralize') }, log, statusOutput });
  console.log(`mode=${result.mode} remaining=${JSON.stringify(result.remaining)} neutralized=${JSON.stringify(result.neutralized)}`);
  console.log('----- AI user prompt lines -----');
  console.log(result.promptLines.join('\n'));
  console.log(`----- git status after: ${JSON.stringify(git(clone, 'status', '--porcelain'))}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
