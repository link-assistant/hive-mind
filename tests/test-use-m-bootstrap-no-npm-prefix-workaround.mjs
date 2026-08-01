#!/usr/bin/env node

/**
 * Regression test for issue #1910.
 *
 * use-m owns the non-writable npm global root fallback as of use-m@8.13.8, so
 * Hive Mind should not keep a project-local npm prefix preflight around its
 * use-m bootstrap.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import { fetchUseMCodeFromCdn, USE_M_BOOTSTRAP_FALLBACK_URL, USE_M_BOOTSTRAP_URL } from '../src/use-m-bootstrap.lib.mjs';

const bootstrapPath = new URL('../src/use-m-bootstrap.lib.mjs', import.meta.url);
const removedHelperPath = new URL('../src/npm-global-prefix.lib.mjs', import.meta.url);

const exists = async url => {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
};

const bootstrapSource = await readFile(bootstrapPath, 'utf8');

assert.equal(await exists(removedHelperPath), false, 'src/npm-global-prefix.lib.mjs should stay removed');
assert.doesNotMatch(bootstrapSource, /npm-global-prefix/, 'ensureUseM should not import the removed npm prefix helper');
assert.doesNotMatch(bootstrapSource, /ensureWritableNpmGlobalPrefix/, 'ensureUseM should not run a local npm prefix preflight');
assert.doesNotMatch(bootstrapSource, /npm_config_prefix|NPM_CONFIG_PREFIX|npm root -g|\.npm-global/, 'ensureUseM should not contain local npm prefix policy');
assert.match(bootstrapSource, /https:\/\/unpkg\.com\/use-m\/use\.js/, 'ensureUseM should still try the upstream use-m bootstrap first');
assert.match(bootstrapSource, /https:\/\/unpkg\.com\/use-m@\d+\.\d+\.\d+\/use\.js/, 'ensureUseM should keep a known working pinned bootstrap fallback');

// Issue #2113: the fallback must not silently downgrade dependency loading to a
// use-m without corrupt-alias recovery. 8.14.3 added alias self-healing,
// 8.14.4 gave its recursive removal a retry budget, and 8.15.0 (use-m #70,
// filed from this issue) added the cross-process install lock that prevents the
// concurrent-install corruption in the first place, so the pin may move forward
// but never back below that floor.
const SELF_HEALING_USE_M_FLOOR = [8, 15, 0];
const fallbackVersion = USE_M_BOOTSTRAP_FALLBACK_URL.match(/use-m@(\d+)\.(\d+)\.(\d+)\//);
assert.ok(fallbackVersion, 'the bootstrap fallback should pin an exact use-m version');
const fallbackParts = fallbackVersion.slice(1, 4).map(Number);
const comparedToFloor = fallbackParts.findIndex((part, index) => part !== SELF_HEALING_USE_M_FLOOR[index]);
assert.ok(comparedToFloor === -1 || fallbackParts[comparedToFloor] > SELF_HEALING_USE_M_FLOOR[comparedToFloor], `the bootstrap fallback should pin use-m >= ${SELF_HEALING_USE_M_FLOOR.join('.')} so the degraded path keeps corrupt-alias recovery, got ${fallbackParts.join('.')}`);

const calls = [];
const code = await fetchUseMCodeFromCdn({
  fetcher: async url => {
    calls.push(url);
    if (url === USE_M_BOOTSTRAP_URL) {
      return {
        ok: false,
        text: async () => 'Not found: /use-m@8.14.0/use.js',
      };
    }
    return {
      ok: true,
      text: async () => 'makeUse',
    };
  },
});

assert.equal(code, 'makeUse', 'ensureUseM should use fallback bootstrap code when latest use.js is missing');
assert.deepEqual(calls, [USE_M_BOOTSTRAP_URL, USE_M_BOOTSTRAP_FALLBACK_URL], 'ensureUseM should try latest first, then fallback');
