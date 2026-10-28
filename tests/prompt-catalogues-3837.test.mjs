/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { initI18n, loadTranslations, tWork } from '../src/i18n.lib.mjs';
import '../experiments/issue-3837-installed-dependencies.mjs';

test('UI, user prompts, and system prompts merge from the requested locale tree', { timeout: 10000 }, async () => {
  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    for (const folder of ['', 'prompts/', 'prompts/system/']) {
      await access(new URL(`../locales/${folder}${locale}.lino`, import.meta.url));
    }
    await initI18n({ uiLanguage: 'en', workLanguage: locale });
    const catalogue = await loadTranslations(locale);
    assert.ok(catalogue.error);
    assert.ok(catalogue['prompt.user.prepared.branch']);
    assert.ok(catalogue['prompt.system.intro']);
    assert.equal(
      tWork('prompt.user.prepared.branch', { branchName: 'feature/$&' }),
      catalogue['prompt.user.prepared.branch'].replace('{{branchName}}', () => 'feature/$&')
    );
  }
  await initI18n('en');
});

test('all backend prompts prefer bulk drafting before verification', { timeout: 10000 }, async () => {
  await initI18n('en');
  for (const backend of ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen']) {
    const { buildSystemPrompt } = await import(`../src/${backend}.prompts.lib.mjs`);
    const prompt = buildSystemPrompt({ owner: 'example', repo: 'project', issueNumber: 1, prNumber: 2, branchName: 'issue-1', argv: {} });
    assert.ok(/prefer drafting code for all requirements before starting verification/.test(prompt), `${backend}: missing bulk-drafting preference`);
    const source = await readFile(new URL(`../src/${backend}.prompts.lib.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /You are an AI issue solver|Issue to solve:|When you execute commands/);
  }
});

test('nested catalogs merge with aliases and reject conflicting definitions', { timeout: 10000 }, async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { loadLocaleTree } = await import('../src/locale-catalogs.lib.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'hive-prompt-catalogues-'));
  try {
    await mkdir(path.join(directory, 'prompts/system'), { recursive: true });
    await writeFile(path.join(directory, 'en.lino'), 'en\n  error\n    label "Error"\n');
    await writeFile(path.join(directory, 'prompts/user.lino'), 'en\n  prompt\n    user\n      branch "Branch: {{branchName}}"\n');
    await writeFile(path.join(directory, 'prompts/system/system.lino'), 'en\n  prompt\n    system\n      instruction "Focused checks"\nru\n  prompt\n    system\n      instruction "Точечные проверки"\n');
    const catalogues = await loadLocaleTree(directory, { compatibilityAliases: ['parentLabel'] });
    assert.equal(catalogues.en.error, 'Error');
    assert.equal(catalogues.en['prompt.user.branch'], 'Branch: {{branchName}}');
    assert.equal(catalogues.en['prompt.system.instruction'], 'Focused checks');
    assert.equal(catalogues.ru['prompt.system.instruction'], 'Точечные проверки');
    await writeFile(path.join(directory, 'prompts/system/conflict.lino'), 'en\n  error\n    label "Conflicting error"\n');
    await assert.rejects(loadLocaleTree(directory, { compatibilityAliases: ['parentLabel'] }), /Conflicting locale key en:error/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('catalog files separate UI, user messages, and system instructions', { timeout: 10000 }, async () => {
  const { readdir } = await import('node:fs/promises');
  const { loadLocalesFromFile } = await import('lino-i18n');
  async function scan(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = new URL(entry.name, folder);
      if (entry.isDirectory()) await scan(new URL(`${entry.name}/`, folder));
      else if (entry.name.endsWith('.lino')) {
        for (const { translations } of await loadLocalesFromFile(file)) {
          for (const key of Object.keys(translations)) {
            if (file.pathname.includes('/prompts/system/')) assert.ok(key.startsWith('prompt.system.'), `${file}: ${key}`);
            else if (file.pathname.includes('/prompts/')) assert.ok(key.startsWith('prompt.') && !key.startsWith('prompt.system.'), `${file}: ${key}`);
            else assert.ok(!key.startsWith('prompt.'), `${file}: ${key}`);
          }
        }
      }
    }
  }
  await scan(new URL('../locales/', import.meta.url));
});

test('work locale changes rendered prompts independently of the UI, with English fallback', { timeout: 10000 }, async () => {
  const { promptText } = await import('../src/prompt-text.lib.mjs');
  const { t, getUiLocale } = await import('../src/i18n.lib.mjs');
  const english = await loadTranslations('en');
  for (const locale of ['ru', 'zh', 'hi']) {
    await initI18n({ uiLanguage: 'en', workLanguage: locale });
    assert.equal(getUiLocale(), 'en');
    assert.equal(t('error'), 'Error');
    for (const backend of ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen']) {
      const { buildSystemPrompt, buildUserPrompt } = await import(`../src/${backend}.prompts.lib.mjs`);
      const params = { owner: 'example', repo: 'project', issueUrl: 'https://github.com/example/project/issues/1', issueNumber: 1, prNumber: 2, branchName: 'feature/$& {{branchName}}', argv: {} };
      assert.ok(buildUserPrompt(params).includes(tWork('prompt.user.prepared.branch', { branchName: params.branchName })));
      const identityKey = 'prompt.system.templates.resource-aware-testing-prompts.RESOURCE_AWARE_SOLVER_IDENTITY.text1';
      assert.notEqual(promptText(identityKey), english[identityKey]);
      assert.ok(buildSystemPrompt(params).includes(promptText(identityKey)));
    }
    const fallbackKey = 'prompt.templates.connection.qwen';
    assert.equal(promptText(fallbackKey), english[fallbackKey]);
    assert.throws(() => promptText('prompt.missing.key'), /Missing prompt template/);
  }
  await initI18n('en');
});

test('catalog extraction preserves the complete English backend corpus', { timeout: 10000 }, async () => {
  const { execFileSync } = await import('node:child_process');
  const expected = JSON.parse(await readFile(new URL('../docs/case-studies/issue-3837/data/prompt-corpus-before.json', import.meta.url), 'utf8'));
  const actual = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=96', new URL('../experiments/issue-3837-prompt-corpus.mjs', import.meta.url).pathname], { encoding: 'utf8' }));
  assert.deepEqual(actual, expected);
});

test('every literal prompt reference resolves from the merged English catalog', { timeout: 10000 }, async () => {
  const { readdir } = await import('node:fs/promises');
  const catalog = await loadTranslations('en');
  let references = 0;
  for (const file of await readdir(new URL('../src/', import.meta.url))) {
    if (!file.endsWith('.mjs')) continue;
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const [, key] of source.matchAll(/promptText\(['"]([^'"]+)['"]/g)) {
      assert.equal(typeof catalog[key], 'string', `${file}: missing ${key}`);
      references++;
    }
  }
  assert.ok(references > 200, 'cover core and auxiliary prompt paths');
});

test('live feedback, finalization and intervention templates are catalogued without changing English output', { timeout: 10000 }, async () => {
  const { execFileSync } = await import('node:child_process');
  const catalog = await loadTranslations('en');
  for (const module of ['bidirectional-interactive', 'solve-auto-ensure', 'solve-results', 'solve-pr-base-guard', 'restart-evidence']) {
    assert.ok(
      Object.keys(catalog).some(key => key.startsWith(`prompt.templates.${module}.`)),
      `${module}: missing live prompt templates`
    );
  }
  const expected = JSON.parse(await readFile(new URL('../docs/case-studies/issue-3837/data/live-prompt-corpus-before.json', import.meta.url), 'utf8'));
  const actual = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=192', new URL('../experiments/issue-3837-live-prompt-corpus.mjs', import.meta.url).pathname], { encoding: 'utf8' }));
  assert.deepEqual(actual, expected);
});

test('the version-only CLI exit remains independent of prompt catalogs', { timeout: 10000 }, async () => {
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--max-old-space-size=96', '--import', new URL('../experiments/issue-3837-reject-catalog-imports.mjs', import.meta.url).pathname, new URL('../src/solve.mjs', import.meta.url).pathname, '--version'], { encoding: 'utf8' });
  assert.match(output.trim(), /^\d+\.\d+\.\d+/);
});
