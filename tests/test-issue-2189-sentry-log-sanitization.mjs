#!/usr/bin/env node

/**
 * Issue #2189, dependency follow-through: structured Sentry logs are sanitized.
 *
 * `@sentry/node` 10.71 turned `enableLogs` on by default. Hive Mind had already
 * turned it on explicitly, and that second pipeline never passed through
 * `beforeSend` — so every credential this repo is careful to mask in events
 * could still leave the process verbatim inside a `Sentry.logger.*` record.
 *
 * What is locked in here:
 *   1. The shared walker masks credentials in strings, nested objects, arrays
 *      and log attributes, and survives a self-referencing payload.
 *   2. `beforeSendLog` returns the record rather than dropping it: sanitizing
 *      must change a log's content, never its delivery.
 *   3. `src/instrument.mjs` actually wires the hook — a masking function nobody
 *      calls masks nothing.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { sanitizeSentryLog, sanitizeSentryValue } from '../src/instrument.sanitize.lib.mjs';

console.log('=== Issue #2189 — Sentry structured logs are sanitized ===\n');

const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';
const ANTHROPIC = 'sk-ant-api03-0123456789abcdefghijklmnop';

console.log('1. The shared walker\n');

assert(!sanitizeSentryValue(`token=${TOKEN}`).includes(TOKEN), 'a credential in a plain string is masked');

const nested = sanitizeSentryValue({ body: `pushed with ${TOKEN}`, attributes: { key: { value: ANTHROPIC, type: 'string' } }, args: [`a ${TOKEN}`, 7, null] });
assert(!nested.body.includes(TOKEN), 'a credential in a log body is masked');
assert(!nested.attributes.key.value.includes(ANTHROPIC), 'a credential inside a log attribute is masked');
assert(!nested.args[0].includes(TOKEN), 'a credential inside an array is masked');
assert(nested.args[1] === 7 && nested.args[2] === null, 'non-string values are left alone');

const cyclic = { body: `see ${TOKEN}` };
cyclic.self = cyclic;
const walked = sanitizeSentryValue(cyclic);
assert(!walked.body.includes(TOKEN), 'a self-referencing payload is still masked');
assert(walked.self === walked, 'a self-referencing payload terminates instead of recursing forever');

console.log('\n2. `beforeSendLog` semantics\n');

const log = sanitizeSentryLog({ level: 'info', body: `cloned with ${TOKEN}`, attributes: {} });
assert(log !== null && log !== undefined, 'the hook returns a log — sanitization must never silently drop telemetry');
assert(!log.body.includes(TOKEN) && log.body.length > 0, `the returned log keeps its message with the credential masked (got ${log.body})`);
assert(log.level === 'info', 'the level survives, so severity routing is unchanged');

console.log('\n3. The hook is actually wired\n');

const instrumentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'instrument.mjs');
const instrument = await fs.readFile(instrumentPath, 'utf8');
assert(/beforeSendLog\s*\(/.test(instrument), 'src/instrument.mjs registers a beforeSendLog hook');
assert(instrument.includes('sanitizeSentryLog'), 'the registered hook is the shared sanitizer, not a second implementation');
assert(instrument.includes('enableLogs: true'), 'structured logs stay an explicit decision rather than an SDK default');

printSummary('Issue #2189 — Sentry log sanitization');
process.exit(getFailCount() > 0 ? 1 : 0);
