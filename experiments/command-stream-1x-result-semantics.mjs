#!/usr/bin/env node
// Shows how command-stream@1 completed results differ from 0.x (PR #2297).
// Usage: node experiments/command-stream-1x-result-semantics.mjs [path-to-command-stream-src/$.mjs]
const modulePath = process.argv[2];
const { $ } = modulePath ? await import(modulePath) : await (await (await import('../src/use-m-bootstrap.lib.mjs')).ensureUseM())('command-stream');
const $quiet = $({ mirror: false });

const empty = await $quiet`true`;
const hello = await $quiet`echo hello`;
console.log('typeof empty.stdout:', typeof empty.stdout, empty.stdout?.constructor?.name);
console.log('Boolean(empty.stdout):', Boolean(empty.stdout), '(0.x: false)');
console.log('empty.stderr || "fallback":', JSON.stringify(`${empty.stderr || 'fallback'}`), '(0.x: "fallback")');
console.log('empty.stdout?.toString() || "fallback":', JSON.stringify(empty.stdout?.toString() || 'fallback'));
console.log('hello.stdout.trim():', JSON.stringify(hello.stdout.trim()));
console.log('`${hello.stdout}`:', JSON.stringify(`${hello.stdout}`));
