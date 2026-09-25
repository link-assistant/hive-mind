#!/usr/bin/env node
/**
 * Issue #2296: run inspectUnsavedWork (the exit-code safety net) against a real
 * git repository with a real command-stream `$`, to check it reads results the
 * same way on command-stream 0.x (string stdout) and 1.x (Readable stdout).
 *
 * Usage: node experiments/issue-2296/unsaved-work-command-stream.mjs [path-to-command-stream/src/$.mjs]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectUnsavedWork } from '../../src/tool-failure-exit.lib.mjs';

const modulePath = process.argv[2];
const { $ } = modulePath ? await import(path.resolve(modulePath)) : await (await (await import('../../src/use-m-bootstrap.lib.mjs')).ensureUseM())('command-stream');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2296-cs-'));
const work = path.join(root, 'work');
git(root, 'init', '-q', '--bare', 'remote.git');
git(root, 'clone', '-q', path.join(root, 'remote.git'), work);
git(work, 'config', 'user.email', 't@example.com');
git(work, 'config', 'user.name', 't');
fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
git(work, 'add', '-A');
git(work, 'commit', '-q', '-m', 'init');
git(work, 'push', '-q', 'origin', 'HEAD');
console.log('clean     ', JSON.stringify(await inspectUnsavedWork({ tempDir: work, $ })));
fs.writeFileSync(path.join(work, 'b.txt'), 'b\n');
console.log('untracked ', JSON.stringify(await inspectUnsavedWork({ tempDir: work, $ })));
git(work, 'add', '-A');
git(work, 'commit', '-q', '-m', 'local');
console.log('unpushed  ', JSON.stringify(await inspectUnsavedWork({ tempDir: work, $ })));
fs.rmSync(root, { recursive: true, force: true });
