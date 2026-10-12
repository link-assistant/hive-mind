#!/usr/bin/env node
// Issue #3001: does command-stream's `$` throw when `df` exits non-zero?
// The production log said "could not parse df output", not "df unavailable",
// which means the call resolved instead of throwing.
import { getCommandStreamDollar } from '../../src/start-command-cli.lib.mjs';

const $ = await getCommandStreamDollar();
const missing = process.argv[2] || '/definitely/not/here-3001';
try {
  const r = await $({ mirror: false })`df -Pk ${missing}`;
  console.log('resolved (did NOT throw)');
  console.log('code:', r.code);
  console.log('stdout:', JSON.stringify(r.stdout?.toString()));
  console.log('stderr:', JSON.stringify(r.stderr?.toString()));
} catch (e) {
  console.log('threw:', e?.message, 'code:', e?.code);
}
