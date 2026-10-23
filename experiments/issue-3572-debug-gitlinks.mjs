/* global process, console */
// Debug helper for issue #3572: print what findUnregisteredStagedGitlinks sees in a repo.
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream');
const dir = process.argv[2];
const ls = await $({ cwd: dir, mirror: false })`git ls-files -s -z`;
console.log(JSON.stringify(ls.stdout.toString()));
const diff = await $({ cwd: dir, mirror: false })`git diff --cached --name-only --no-renames -z`;
console.log(diff.code, JSON.stringify(diff.stdout.toString()));
const { findUnregisteredStagedGitlinks } = await import('../src/unregistered-gitlinks.lib.mjs');
console.log('unregistered:', await findUnregisteredStagedGitlinks(dir, $));
const reg = await $({ cwd: dir, mirror: false })`git config -f .gitmodules --get-regexp path`;
console.log(reg.code, JSON.stringify(reg.stdout.toString()));
