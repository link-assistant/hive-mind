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
assert.match(bootstrapSource, /https:\/\/unpkg\.com\/use-m@8\.13\.8\/use\.js/, 'ensureUseM should keep a known working bootstrap fallback');
