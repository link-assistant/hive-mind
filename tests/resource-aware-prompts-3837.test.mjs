/**
 * Regression coverage for conflicting local-validation instructions (issue #3837).
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadTranslations } from '../src/i18n.lib.mjs';
import '../experiments/issue-3837-installed-dependencies.mjs';

const backends = ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen'];
const params = { owner: 'example', repo: 'project', issueNumber: 1, prNumber: 2, branchName: 'issue-1', argv: {} };
const guide = 'https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md';
const baseline = JSON.parse(await readFile(new URL('../docs/case-studies/issue-3837/data/prompt-size-before.json', import.meta.url), 'utf8'));

for (const backend of backends) {
  test(`${backend}: resource-aware defaults survive workspace and optional prompt sections`, { timeout: 10000 }, async () => {
    const { buildSystemPrompt } = await import(`../src/${backend}.prompts.lib.mjs`);
    for (const options of [{}, { workspaceTmpDir: '/tmp/work', modelSupportsVision: true, argv: { promptPlaywrightMcp: true, promptEnsureAllRequirementsAreMet: true } }]) {
      const prompt = buildSystemPrompt({ ...params, ...options });
      assert.equal(/run all tests locally|run local CI checks first|npm test 2>&1/.test(prompt), false, 'local validation must consider existing CI coverage and build cost');
      assert.match(prompt.split('\n')[0], /Prefer minimal local CPU, memory, and disk use/);
      assert.match(prompt, /prefer a single relevant test or small focused checks/);
      assert.match(prompt, /check whether the command triggers a full source build before running it/);
      assert.match(prompt, /CI\/CD already covers full test suites or CPU-intensive builds/);
      assert.match(prompt, /checking results for the current commit/);
      assert.match(prompt, /unless user requirements or uncovered failures call for it/);
      assert.match(prompt, /let the repository owner decide whether to add it/);
      assert.match(prompt, /adding it was not requested/);
      assert.match(prompt, /meanwhile complete required validation with available resources/);
      assert.equal(prompt.split(guide).length - 1, 1, 'one CI/CD suggestion per system prompt');
      assert.match(prompt, /test.*fails before the fix and passes afterward/);
      assert.match(prompt, /all CI checks are passing/);
      assert.match(prompt, /every requirement of the issue and all required sub-issues/);
      assert.doesNotMatch(prompt, /When issue is solvable|When encountering logic bugs/);
      const bullets = prompt
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- When '));
      assert.equal(new Set(bullets).size, bullets.length, 'no verbatim duplicate conditional instructions');
      const profile = options.workspaceTmpDir ? 'workspace-visual' : 'default';
      const previous = baseline.find(entry => entry.backend === backend && entry.profile === profile);
      assert.ok(Buffer.byteLength(prompt) < previous.bytes, 'rendered prompt is smaller than the issue baseline');
    }
  });
}

const localExpectations = {
  en: { identity: /minimal local CPU/, focused: /single relevant test/, build: /full source build/, owner: /repository owner decide/, stale: /run all tests locally|run local CI checks first/ },
  ru: { identity: /минимальн.*локальн/, focused: /один.*тест/, build: /полную сборку/, owner: /владелец репозитория/, stale: /прогоняй все тесты локально|сначала запускай локальные CI-проверки/ },
  zh: { identity: /本地 CPU/, focused: /单个相关测试/, build: /完整.*构建/, owner: /仓库所有者决定/, stale: /在本地运行所有测试|先在本地运行 CI 检查/ },
  hi: { identity: /स्थानीय CPU/, focused: /एक प्रासंगिक परीक्षण/, build: /पूरा स्रोत.*बिल्ड/, owner: /निर्णय रिपॉज़िटरी के स्वामी/, stale: /सभी tests स्थानीय रूप से चलाएँ|स्थानीय CI जाँचें.*पहले चलाएँ/ },
};

for (const [locale, expected] of Object.entries(localExpectations)) {
  test(`${locale}: translated prompt catalogue follows the same validation policy`, { timeout: 10000 }, async () => {
    const catalogue = await loadTranslations(locale);
    const systemEntries = Object.entries(catalogue).filter(([key]) => key.startsWith('prompt.system.'));
    assert.ok(systemEntries.length > 10, 'catalogue must load, without silently using a fallback');
    // lino-i18n supplies compatibility aliases for some keys, with identical values.
    const system = [...new Set(systemEntries.map(([, value]) => value))].join('\n');
    assert.equal(expected.stale.test(system), false, 'translated guidance must not require an unconditional full local suite');
    assert.match(catalogue['prompt.system.intro'], expected.identity);
    const validation = catalogue['prompt.system.solution.development'];
    assert.match(validation, expected.focused);
    assert.match(validation, expected.build);
    assert.match(validation, expected.owner);
    assert.equal(validation.split(guide).length - 1, 1);
  });
}
