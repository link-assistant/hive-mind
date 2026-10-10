// Experiment for #2315: preserve uncommitted work on recovery/<branch> without touching the PR branch.
import { $ } from 'command-stream';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { commitUncommittedChangesOnCriticalError } from '../src/critical-error-commit.lib.mjs';

const remote = await mkdtemp(join(tmpdir(), 'exp-2315-remote-'));
const dir = await mkdtemp(join(tmpdir(), 'exp-2315-'));
const sh = (cmd, cwd = dir) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();
sh('git init -q --bare', remote);
sh(`git init -q && git config user.email t@t && git config user.name t && echo a > Main.kt && git add . && git commit -qm base && git branch -M issue-1 && git remote add origin ${remote} && git push -qu origin issue-1`);
await writeFile(join(dir, 'Main.kt'), 'fun main() = println("hi")\n');
await writeFile(join(dir, 'notes.md'), 'text\n');
await writeFile(join(dir, 'Main.jar'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 1]));
await mkdir(join(dir, 'target'), { recursive: true });
await writeFile(join(dir, 'target', 'out.txt'), 'x\n');
const head = sh('git rev-parse HEAD');
const result = await commitUncommittedChangesOnCriticalError({ tempDir: dir, branchName: 'issue-1', $, log: async m => console.log(m), reason: 'exp' });
console.log(result);
console.log('HEAD unchanged:', sh('git rev-parse HEAD') === head);
console.log('status:\n' + sh('git status --porcelain --untracked-files=all'));
console.log('recovery tree:', sh(`git --git-dir=${remote} ls-tree -r --name-only recovery/issue-1`));
console.log('remote PR branch:', sh(`git --git-dir=${remote} rev-parse issue-1`) === head);
