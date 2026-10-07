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
// Minimal Telegram legacy-Markdown rendering: code blocks, inline code, bold, escapes.
const renderMarkdown = text =>
  escapeHtml(text)
    .split(/```\n?([\s\S]*?)```/)
    .map((chunk, index) =>
      index % 2
        ? `<pre class="block">${chunk.replace(/\n$/, '')}</pre>`
        : chunk
            .replace(/^\n/, '')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
            .replace(/\\([_*`[])/g, '$1')
    )
    .join('');
const before = `❌ ${t('telegram.url_must_be_type', { allowedTypes: 'issue, pull request, repo', type: 'other' })}\n\n${t('telegram.solve_invalid_url_help')}`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Input diagnostics comparison</title><style>body{background:#16232d;color:#eee;font:18px/1.5 system-ui;margin:36px}h1{font-size:24px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{background:#203442;border-radius:12px;padding:24px}h2{font-size:20px;color:#ffab66}.input{color:#65cfee}.msg{white-space:pre-wrap;overflow-wrap:anywhere}b{font-weight:700;color:#ffd479}code,.block{font:15px/1.4 ui-monospace,monospace;color:#9fe0ff}.block{background:#152530;border-radius:6px;padding:8px 10px;margin:6px 0 0;white-space:pre;overflow-x:auto}footer{font-size:14px;color:#b5c2ca;margin-top:24px}</style><h1>GitHub URL typo: reply comparison</h1><p class="input">${escapeHtml(input)}</p><div class="comparison"><article><h2>Before</h2><div class="msg">${renderMarkdown(before)}</div></article><article><h2>After</h2><div class="msg">${renderMarkdown(after)}</div></article></div><footer>Offline render of validation replies. The “after” text comes from the production Telegram URL validator, with its Markdown (bold, code block) rendered as Telegram displays it.</footer></html>`;
await writeFile(new URL('./comparison.html', import.meta.url), html);
