import { writeFile } from 'node:fs/promises';
import { initI18n, t } from '../../src/i18n.lib.mjs';
import { validateTelegramGitHubUrl } from '../../src/telegram-url-validation.lib.mjs';
import { detectMalformedFlags } from '../../src/option-suggestions.lib.mjs';

await initI18n();
const input = '/claude https://github.com/bpmbpm/mdld-test/issuese/1';
const url = input.split(' ')[1];
const result = validateTelegramGitHubUrl(url, { allowedTypes: ['issue', 'pull', 'repo'] });
const after = `❌ ${result.error}\n\n${t('telegram.did_you_mean', { suggestion: result.suggestion })}\n\n${t('telegram.solve_invalid_url_help')}`;
console.log(after);
console.log('\n' + detectMalformedFlags([url, '-think', 'high']).errors.join('\n'));

// Render the exact reply for offline visual review; no Telegram API calls.
const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const before = `❌ ${t('telegram.url_must_be_type', { allowedTypes: 'issue, pull request, repo', type: 'other' })}\n\n${t('telegram.solve_invalid_url_help')}`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Input diagnostics comparison</title><style>body{background:#16232d;color:#eee;font:18px/1.5 system-ui;margin:36px}h1{font-size:24px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{background:#203442;border-radius:12px;padding:24px}h2{font-size:20px;color:#ffab66}.input{color:#65cfee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.5 ui-monospace,monospace}footer{font-size:14px;color:#b5c2ca;margin-top:24px}</style><h1>GitHub URL typo: reply comparison</h1><p class="input">${escapeHtml(input)}</p><div class="comparison"><article><h2>Before</h2><pre>${escapeHtml(before)}</pre></article><article><h2>After</h2><pre>${escapeHtml(after)}</pre></article></div><footer>Offline render of validation replies. The “after” text comes from the production Telegram URL validator.</footer></html>`;
await writeFile(new URL('./comparison.html', import.meta.url), html);
