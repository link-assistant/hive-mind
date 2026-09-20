#!/usr/bin/env node
// Issue #2119: `--jq '... == "${x}"'` inside a command-stream template.
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream');
const login = 'konard';
const broken = await $`gh api /users/${login} --jq 'select(.login == "${login}") | .login'`;
console.log(
  'interpolated inside jq quotes:',
  JSON.stringify(broken.stdout.toString().trimEnd()),
  'code',
  broken.code,
  String(broken.stderr || '')
    .trim()
    .slice(0, 160)
);
const fixed = await $`gh api /users/${login} --jq ${`select(.login == "${login}") | .login`}`;
console.log('pre-built jq expression:      ', JSON.stringify(fixed.stdout.toString().trimEnd()), 'code', fixed.code);
