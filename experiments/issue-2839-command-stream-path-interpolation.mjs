#!/usr/bin/env node
/* global console */
// Issue #2839: how command-stream quotes values interpolated inside a gh api path
// (`repos/${owner}/${repo}/git/ref/heads/${baseBranch}`), including branch names with slashes.
import { $ } from 'command-stream';

const owner = 'link-assistant';
const repo = 'hive-mind';
for (const baseBranch of ['main', 'release/2.x', 'feature/a-b_c.1']) {
  const result = await $({ mirror: false })`printf '%s\n' repos/${owner}/${repo}/git/ref/heads/${baseBranch}`;
  console.log(JSON.stringify(baseBranch), '->', JSON.stringify(result.stdout.toString().trim()));
}
