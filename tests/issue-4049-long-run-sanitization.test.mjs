/**
 * @hive-mind-test-suite default
 * Issue #4049: one long run of base64, hex or percent-escape characters (a JSONL
 * line holding a screenshot) made Hive Mind's encoded-run regexes overflow V8's
 * regexp stack, and the fail-closed publication boundary blocked the whole log.
 * Upstream link-foundation/sensitive-data-sanitizer#172: the library's own
 * credential-word regex overflows the same way on a letter run of about 4 MiB
 * in two-byte text; src/sensitive-data-sanitizer.lib.mjs isolates long runs.
 * Upstream #173: a credential keyword followed by one long value scans at about
 * 12 µs per character; that is a documented limit, and the output stays correct.
 *
 * Synthetic data only; sizes are just above each failure threshold.
 * Run with: node tests/issue-4049-long-run-sanitization.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { __runScannersForTests as scanners, findDecodableRuns, findWrappedBase64Runs } from '../src/encoded-credential-detection.lib.mjs';
import { findCredentialFindings, loadSensitiveDataSanitizer, sanitizeWithPolicy, UPSTREAM } from '../src/sensitive-data-sanitizer.lib.mjs';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';

const MiB = 1024 * 1024;
const SECRET = ['xx', 'private', 'value', '0123456789'].join('-');
const TIMEOUT = { timeout: 180_000 };

// The patterns the scanners replaced; they must still agree on every input.
const REFERENCE = {
  base64: String.raw`[A-Za-z0-9+/_-]{24,}={0,2}`,
  hex: String.raw`\b[0-9a-fA-F]{32,}\b`,
  percent: String.raw`%[0-9a-fA-F]{2}(?:%[0-9a-fA-F]{2}|[A-Za-z0-9._~!*'()-])*`,
  escape: String.raw`(?:\\u00[0-9a-fA-F]{2}|\\x[0-9a-fA-F]{2}){8,}`,
  entity: String.raw`(?:&#x?[0-9a-fA-F]{1,5};){8,}`,
};
const PIECES = ['a', 'F', '0', '9', 'g', '+', '/', '_', '-', '=', '==', '%', '%4', '%41', '\\x41', '\\u0041', '&#65;', '&#x41;', '.', '~', ' ', '\t', '\n', '\r\n', '\r', 'é', 'abcdef0123456789', 'QUJDREVGR0hJSktMTU5PUA', '\\x41\\x42\\u0043\\x44', '&#65;&#x42;&#67;&#68;'];

test('#4049: the linear run scanners return exactly the matches of the patterns they replaced', () => {
  let seed = 4049;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let iteration = 0; iteration < 3000; iteration++) {
    const text = Array.from({ length: Math.floor(random() * 40) }, () => PIECES[Math.floor(random() * PIECES.length)]).join('');
    for (const [name, source] of Object.entries(REFERENCE)) {
      assert.deepEqual(
        scanners[name](text),
        [...text.matchAll(new RegExp(source, 'g'))].map(match => ({ run: match[0], index: match.index })),
        `${name}: ${JSON.stringify(text)}`
      );
    }
    const lines = [...text.matchAll(/(\r?\n)([ \t]*)([A-Za-z0-9+/_-]{16,}={0,2})[ \t]*(?=\r?\n|$)/g)].map(match => {
      const start = match.index + match[1].length + match[2].length;
      return { index: match.index, start, end: start + match[3].length, lastIndex: match.index + match[0].length };
    });
    assert.deepEqual(scanners.wrappedLines(text), lines, `wrapped lines: ${JSON.stringify(text)}`);
  }
});

test('#4049: runs past the old regexp-stack limits are scanned, not thrown on', TIMEOUT, () => {
  const encoded = Buffer.from(`password=${SECRET}`).toString('base64');
  const cases = {
    base64: `{"type":"image","data":"${'Ab'.repeat(3 * MiB)}"} ${encoded}\n`,
    hex: `${'ab12'.repeat(1.5 * MiB)}\n`,
    percent: `%41${'a'.repeat(8 * MiB + 1024)}\n`,
    wrapped: `x\n${'Ab'.repeat(3 * MiB)}\n`,
  };
  for (const [name, text] of Object.entries(cases)) assert.doesNotThrow(() => findDecodableRuns(text), name);
  assert.ok(
    findDecodableRuns(cases.base64).some(run => run.decoded.includes(SECRET)),
    'the encoded secret after the long run is still decoded'
  );
  assert.equal(findWrappedBase64Runs(cases.wrapped).length, 1);
});

test('#4049: a log block with a 6 MiB base64 record is published with its credential masked', TIMEOUT, async () => {
  const run = 'Ab'.repeat(3 * MiB);
  const output = await sanitizeForPublication(`{"type":"image","data":"${run}"}\npassword=${SECRET}\n`);
  assert.ok(!output.includes(SECRET));
  assert.ok(output.includes(run), 'the long run is kept intact');
});

test('upstream #172: the library still overflows, so the workaround stays registered', TIMEOUT, () => {
  assert.equal(UPSTREAM.longLetterRunStackOverflow, 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/172');
  const sanitizer = loadSensitiveDataSanitizer().createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } });
  // When this stops throwing, the library fixed #172: drop the fallback and this entry.
  assert.throws(() => sanitizer.sanitize(`${'A'.repeat(4 * MiB)}\n🔐 token refreshed\n`), { code: 'ERR_SANITIZATION' });
});

test('upstream #172: a long letter run in two-byte text is sanitized around the run', TIMEOUT, () => {
  const run = 'A'.repeat(4 * MiB);
  const text = `${run}\n🔐 token refreshed\npassword=${SECRET}\n`;
  let redactions = 0;
  const output = sanitizeWithPolicy(text, { onFindings: count => (redactions += count) });
  assert.ok(!output.includes(SECRET));
  assert.ok(output.startsWith(`${run}\n🔐 token refreshed\npassword=`), 'the run and the key stay');
  assert.ok(redactions >= 1);
  // The multi-pass core sees its own `xx-…789` mask (two-byte) on the second pass.
  assert.equal(sanitizeCredentialText(text), output);
  const findings = findCredentialFindings(text);
  assert.ok(findings.length > 0);
  for (const finding of findings) assert.equal(text.slice(finding.start, finding.end), SECRET, 'offsets are relative to the whole text');
  assert.equal(findings[0].line, 3);
});

test('upstream #172: the fallback fails closed when a credential reaches into a long run', TIMEOUT, () => {
  // The value is the run itself; a window cannot see all of it, so nothing is guessed.
  // (A Bearer value keeps this fast: `password=` + 4 MiB costs ~50 s in the library's
  // generic-api-key rule, see UPSTREAM.longCredentialValueScan.)
  assert.throws(() => sanitizeWithPolicy(`🔐 Authorization: Bearer ${'A'.repeat(4 * MiB)}\n`), { code: 'ERR_SANITIZATION' });
});

test('upstream #173: a long credential value is still masked completely, only slowly', TIMEOUT, () => {
  assert.equal(UPSTREAM.longCredentialValueScan, 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/173');
  let seed = 173;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const value = Array.from({ length: 64 * 1024 }, () => alphabet[(seed = (seed * 1103515245 + 12345) % 2147483648) % alphabet.length]).join('');
  const output = sanitizeWithPolicy(`config loaded\npassword=${value}\ndone\n`);
  assert.ok(output.startsWith('config loaded\npassword='));
  assert.ok(output.endsWith('\ndone\n'));
  assert.ok(!output.includes(value.slice(4096, 4096 + 32)), 'no part of the value survives');
});

test('upstream #172 and #4049: a 16 MiB JSONL record and a credential are sanitized as a file', TIMEOUT, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-4049-'));
  try {
    const sourcePath = path.join(dir, 'in.log');
    const destPath = path.join(dir, 'out.log');
    const run = 'Ab'.repeat(8 * MiB);
    await fs.writeFile(sourcePath, `{"type":"image","data":"${run}"}\n🔐 token refreshed\npassword=${SECRET}\n`);
    await sanitizeLogFileToFile({ sourcePath, destPath });
    const output = await fs.readFile(destPath, 'utf8');
    assert.ok(!output.includes(SECRET));
    assert.ok(output.includes(run));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
