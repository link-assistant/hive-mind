#!/usr/bin/env node
// Regression test for issue #1718: hive must not auto-forward `false` for
// solve options whose `type` is `'string'` but whose `default` is `false`
// (e.g. --working-session-live-progress).
//
// Without this guard, hive forwarded `--working-session-live-progress false`
// to every spawned solve worker, which then exited 1 because solve only
// accepts "comment" or "pr" for that flag. Five workers, five crashes,
// zero PRs created — and hive itself exited 0 because it never propagated
// the failure stats. This test pins both fixes:
//
//   1. The auto-forwarder skips `value === false` for string/number options.
//   2. hive.mjs computes `issueQueue.getStats()` and calls `safeExit(1, …)`
//      after the monitor loop when any task failed.
//
// See: https://github.com/link-assistant/hive-mind/issues/1718

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HIVE_MJS = path.resolve(__dirname, '..', 'src', 'hive.mjs');

let passed = 0;
let failed = 0;
const fail = (name, msg) => {
  console.log(`❌ ${name}`);
  console.log(`   ${msg}`);
  failed++;
};
const pass = name => {
  console.log(`✅ ${name}`);
  passed++;
};

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (error) {
    fail(name, error.message);
  }
}

// ---------------------------------------------------------------------------
// 1. The shape that triggered #1718 still exists (so this test is meaningful).
// ---------------------------------------------------------------------------
test('issue #1718 shape: working-session-live-progress is type=string default=false', () => {
  const def = SOLVE_OPTION_DEFINITIONS['working-session-live-progress'];
  if (!def) throw new Error('Missing SOLVE_OPTION_DEFINITIONS["working-session-live-progress"]');
  if (def.type !== 'string') throw new Error(`Expected type "string", got "${def.type}"`);
  if (def.default !== false) throw new Error(`Expected default false, got ${def.default}`);
});

test('working-session-live-progress is on the hive auto-forward list', () => {
  const names = new Set(getSolvePassthroughOptionNames());
  if (!names.has('working-session-live-progress')) {
    throw new Error('working-session-live-progress is missing from getSolvePassthroughOptionNames()');
  }
});

// ---------------------------------------------------------------------------
// 2. The fix is present in hive.mjs source. We extract the auto-forward block
//    via a regex so we don't have to reimplement spawn() to test it.
// ---------------------------------------------------------------------------
const hiveSource = fs.readFileSync(HIVE_MJS, 'utf8');

test('hive.mjs guards against value === false for string/number options', () => {
  // The fixed branch must include `value !== false` next to `value !== undefined`.
  const re =
    /\(def\.type === 'string' \|\| def\.type === 'number'\)\s*&&\s*value !== undefined\s*&&\s*value !== false/;
  if (!re.test(hiveSource)) {
    throw new Error(
      'src/hive.mjs auto-forward branch must read `(def.type === \'string\' || def.type === \'number\') && value !== undefined && value !== false`'
    );
  }
});

test('hive.mjs cites issue #1718 next to the guard', () => {
  if (!hiveSource.includes('Issue #1718') && !hiveSource.includes('issue #1718')) {
    throw new Error('hive.mjs should mention issue #1718 next to the new guard');
  }
});

// ---------------------------------------------------------------------------
// 3. hive.mjs propagates worker failures to the process exit code.
// ---------------------------------------------------------------------------
test('hive.mjs calls safeExit(1, …) when finalStats.failed > 0', () => {
  // The fix must call safeExit with code 1 and reference issueQueue.getStats().failed.
  const blockRe =
    /issueQueue\.getStats\(\)[\s\S]{0,400}?finalStats\.failed > 0[\s\S]{0,400}?safeExit\(1,/;
  if (!blockRe.test(hiveSource)) {
    throw new Error(
      'src/hive.mjs must compute finalStats = issueQueue.getStats() and call safeExit(1, …) when finalStats.failed > 0'
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Replay of the exact auto-forwarder logic on a synthetic argv that
//    reproduces the #1718 scenario. This is the closest we can get to a unit
//    test without spawning a subprocess.
// ---------------------------------------------------------------------------
const SKIP_AUTO_FORWARD = new Set([
  'model',
  'worker-model',
  'base-branch',
  'skip-tool-connection-check',
  'tool-connection-check',
  'skip-tool-check',
  'skip-claude-check',
  'tool-check',
  'dry-run',
  'auto-cleanup',
]);
const kebabToCamel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function buildSolveArgs(argv) {
  const args = [];
  for (const optionName of getSolvePassthroughOptionNames()) {
    if (SKIP_AUTO_FORWARD.has(optionName)) continue;
    const camelName = kebabToCamel(optionName);
    const value = argv[camelName];
    const def = SOLVE_OPTION_DEFINITIONS[optionName];
    if (!def) continue;
    if (def.type === 'boolean') {
      if (value === undefined) continue;
      if (def.default === true || def.default === undefined) {
        args.push(value ? `--${optionName}` : `--no-${optionName}`);
      } else if (value) {
        args.push(`--${optionName}`);
      }
    } else if (def.type === 'array' && Array.isArray(value) && value.length > 0) {
      for (const entry of value) args.push(`--${optionName}`, String(entry));
    } else if (
      (def.type === 'string' || def.type === 'number') &&
      value !== undefined &&
      value !== false
    ) {
      args.push(`--${optionName}`, String(value));
    }
  }
  return args;
}

test('replayed forwarder does NOT push --working-session-live-progress when value=false (default from yargs)', () => {
  // Build an argv that mirrors what yargs hands hive when the user did not
  // pass --working-session-live-progress: the default `false` is preserved.
  const argv = { workingSessionLiveProgress: false };
  const args = buildSolveArgs(argv);
  const idx = args.indexOf('--working-session-live-progress');
  if (idx !== -1) {
    throw new Error(
      `forwarder pushed --working-session-live-progress ${args[idx + 1]}; expected nothing`
    );
  }
});

test('replayed forwarder DOES push --working-session-live-progress=comment when user opts in', () => {
  const argv = { workingSessionLiveProgress: 'comment' };
  const args = buildSolveArgs(argv);
  const idx = args.indexOf('--working-session-live-progress');
  if (idx === -1) throw new Error('forwarder dropped a real string value');
  if (args[idx + 1] !== 'comment') {
    throw new Error(`expected "comment", got "${args[idx + 1]}"`);
  }
});

test('replayed forwarder DOES push --working-session-live-progress=pr when user opts in', () => {
  const argv = { workingSessionLiveProgress: 'pr' };
  const args = buildSolveArgs(argv);
  const idx = args.indexOf('--working-session-live-progress');
  if (idx === -1) throw new Error('forwarder dropped a real string value');
  if (args[idx + 1] !== 'pr') throw new Error(`expected "pr", got "${args[idx + 1]}"`);
});

test('replayed forwarder still pushes other string/number options normally', () => {
  // Pick a couple of well-known string/number options as canaries.
  const argv = {
    minDiskSpace: 4096,
    subSessionSize: '150k',
    maxThinkingBudget: 31999,
  };
  const args = buildSolveArgs(argv);
  const expectations = [
    ['--min-disk-space', '4096'],
    ['--sub-session-size', '150k'],
    ['--max-thinking-budget', '31999'],
  ];
  for (const [flag, expected] of expectations) {
    const idx = args.indexOf(flag);
    if (idx === -1) throw new Error(`${flag} missing from forwarded args`);
    if (args[idx + 1] !== expected) {
      throw new Error(`${flag}: expected "${expected}", got "${args[idx + 1]}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Defense in depth: every type:'string' option whose default is `false`
//    must round-trip through the forwarder without producing `--<flag> false`.
// ---------------------------------------------------------------------------
test('NO type=string option with default=false is forwarded as `--<flag> false`', () => {
  for (const [optionName, def] of Object.entries(SOLVE_OPTION_DEFINITIONS)) {
    if (def.type !== 'string') continue;
    if (def.default !== false) continue;
    const argv = { [kebabToCamel(optionName)]: false };
    const args = buildSolveArgs(argv);
    const idx = args.indexOf(`--${optionName}`);
    if (idx !== -1) {
      throw new Error(
        `forwarder still pushes --${optionName} ${args[idx + 1]} when value=false (option has type='string', default=false)`
      );
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
