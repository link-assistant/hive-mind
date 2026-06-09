#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1864: command-stream replacements need an exec-like adapter for
 * existing raw shell command call sites.
 */

import assert from 'node:assert/strict';

import { commandStreamExec } from '../src/command-stream-exec.lib.mjs';

let mirroredStdout = '';
const originalWrite = process.stdout.write;
process.stdout.write = function interceptStdout(chunk, encoding, callback) {
  mirroredStdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  if (typeof callback === 'function') callback();
  return true;
};

try {
  const result = await commandStreamExec('printf issue-1864');
  assert.deepEqual(result, { stdout: 'issue-1864', stderr: '' });
} finally {
  process.stdout.write = originalWrite;
}

assert.equal(mirroredStdout, '', 'commandStreamExec should capture stdout without mirroring it to process stdout');

await assert.rejects(
  () => commandStreamExec('printf out; printf err >&2; exit 7'),
  error => {
    assert.equal(error.code, 7);
    assert.equal(error.stdout, 'out');
    assert.equal(error.stderr, 'err');
    assert.match(error.message, /Command failed: printf out/);
    return true;
  }
);

console.log('✅ commandStreamExec wrapper preserves exec-like behavior');
