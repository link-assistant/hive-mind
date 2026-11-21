#!/usr/bin/env node
/**
 * Tests for the import-closure helper that decides which modules the
 * bot-process lint rules apply to.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { computeImportClosure, findRelativeSpecifiers } from '../eslint-rules/bot-import-closure.mjs';

const ROOT = '/repo';

function closureOf(files, entry = 'src/bot.mjs') {
  const readSource = path => (path.startsWith(`${ROOT}/`) ? (files[path.slice(ROOT.length + 1)] ?? null) : null);
  return computeImportClosure(`${ROOT}/${entry}`, { rootDir: ROOT, readSource });
}

test('finds static, side-effect, re-export and literal dynamic imports', () => {
  const source = ["import a from './a.mjs';", "import { b, c } from '../lib/b.mjs';", "import './side-effect.mjs';", "export { d } from './d.mjs';", "export * from './e.mjs';", "const f = await import('./f.mjs');", "import pkg from 'telegraf';", 'const g = await import(`./${name}.mjs`);'].join('\n');
  assert.deepEqual(findRelativeSpecifiers(source).sort(), ['../lib/b.mjs', './a.mjs', './d.mjs', './e.mjs', './f.mjs', './side-effect.mjs']);
});

test('multi-line import lists are followed', () => {
  assert.deepEqual(findRelativeSpecifiers("import {\n  one,\n  two,\n} from './many.mjs';"), ['./many.mjs']);
});

test('commented-out imports are not followed', () => {
  const source = ["// import a from './a.mjs';", "/* import b from './b.mjs'; */", "const url = 'https://example.com/x';", "import c from './c.mjs';"].join('\n');
  assert.deepEqual(findRelativeSpecifiers(source), ['./c.mjs']);
});

test('the closure follows imports transitively and handles cycles', () => {
  const files = {
    'src/bot.mjs': "import './a.lib.mjs';\nconst lazy = () => import('./lazy.lib.mjs');",
    'src/a.lib.mjs': "import { b } from './b.lib.mjs';\nimport 'telegraf';",
    'src/b.lib.mjs': "import { a } from './a.lib.mjs';",
    'src/lazy.lib.mjs': "export { x } from '../shared/x.mjs';",
    'shared/x.mjs': 'export const x = 1;',
    'src/unused.lib.mjs': "import './a.lib.mjs';",
  };
  assert.deepEqual(closureOf(files), ['shared/x.mjs', 'src/a.lib.mjs', 'src/b.lib.mjs', 'src/bot.mjs', 'src/lazy.lib.mjs']);
});

test('a specifier that resolves to no file is skipped', () => {
  assert.deepEqual(closureOf({ 'src/bot.mjs': "import './missing.mjs';" }), ['src/bot.mjs']);
});

test('the real bot entry pulls in the modules it loads', () => {
  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  const closure = computeImportClosure(fileURLToPath(new URL('../src/telegram-bot.mjs', import.meta.url)), { rootDir });
  for (const file of ['src/telegram-bot.mjs', 'src/bot-logger.lib.mjs', 'src/session-store.lib.mjs', 'src/telegram-background-task.lib.mjs']) {
    assert.ok(closure.includes(file), `${file} should be in the bot import closure`);
  }
  assert.ok(!closure.some(file => file.startsWith('tests/')), 'tests are not loaded by the bot');
});
