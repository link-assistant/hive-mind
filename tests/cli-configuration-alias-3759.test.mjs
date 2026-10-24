/**
 * @hive-mind-test-suite default
 * Dependency refresh for #3759: preserve application aliases reserved by makeConfig.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseCliArgumentsWithLino } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig } from '../src/hive.config.lib.mjs';

for (const args of [[], ['-c', '3'], ['-c3'], ['-vc3'], ['--concurrency', '3']]) {
  test(`Hive preserves its concurrency alias: ${args.join(' ') || 'defaults'}`, { timeout: 10000 }, () => {
    const parsed = parseCliArgumentsWithLino({ argv: ['node', 'hive', 'https://github.com/example/repo', ...args], createYargsConfig, lenv: { enabled: false }, env: { values: {} } });
    assert.equal(parsed.concurrency, args.length ? 3 : 2);
    if (args.includes('-vc3')) assert.equal(parsed.verbose, true);
  });
}

for (const applicationClaimsAlias of [false, true])
  test(`configuration files remain available (application claims -c=${applicationClaimsAlias})`, { timeout: 10000 }, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'hive-config-alias-3759-'));
    try {
      const file = path.join(root, 'config.lenv');
      writeFileSync(file, 'ALIAS_PROBE: 42\n');
      const parsed = parseCliArgumentsWithLino({
        argv: ['node', 'cli', applicationClaimsAlias ? '--configuration' : '-c', file],
        lenv: { enabled: false },
        env: { values: {} },
        createYargsConfig: parser => {
          if (applicationClaimsAlias) parser.option('concurrency', { type: 'number', alias: 'c', default: 2 });
          return parser.option('probe', { type: 'number', env: 'ALIAS_PROBE' });
        },
      });
      assert.equal(parsed.probe, 42);
      if (applicationClaimsAlias) assert.equal(parsed.concurrency, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

test('conflicting application aliases are still rejected', { timeout: 10000 }, () => {
  assert.throws(() => parseCliArgumentsWithLino({ argv: ['node', 'cli'], lenv: { enabled: false }, env: { values: {} }, createYargsConfig: parser => parser.option('alpha', { alias: 'x' }).option('beta', { alias: 'x' }) }), /Ambiguous option alias X/);
});
