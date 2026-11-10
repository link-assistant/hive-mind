// Synthetic display evidence; no account requests or credentials are used.
import { execFileSync } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as after from '../../src/limits.lib.mjs';

const baselinePath = resolve('experiments/issue-3785/baseline.tmp.mjs');
const source = execFileSync('git', ['show', '43ea0960:src/limits.lib.mjs'], { encoding: 'utf8' }).replaceAll("from './", "from '../../src/");
await writeFile(baselinePath, source);
try {
  const before = await import(pathToFileURL(baselinePath));
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const render = lib => {
    const codex = lib.formatCodexLimitsSection(null, 'Codex authentication expired. Please re-authenticate Codex with your ChatGPT account.', { subscription: { planType: 'pro', source: 'stored-token', endsAt: '2026-11-05T07:22:00Z' } });
    const message = lib.formatUsageMessage(null, null, null, { usagePercentage: 30, loadAvg5: 1.8, cpuCount: 6 }, null, 'Claude authentication expired. Please use `/solve` or `/hive` commands to trigger re-authentication of Claude.', [codex, 'Queues\nclaude (pending: 0, processing: 0)\ncodex (pending: 0, processing: 1)']);
    return message
      .split('```')
      .map((part, i) => (i % 2 ? `<pre>${escape(part.trim())}</pre>` : part.trim() ? `<p>${escape(part.trim())}</p>` : ''))
      .join('');
  };
  // Both renders use the current subscription helper; only the layout differs.
  await writeFile('docs/case-studies/issue-3785/evidence/display.html', `<!doctype html><html lang="en"><meta charset="utf-8"><title>Limits display regression</title><style>body{background:#17232e;color:#f2f4f6;font:18px system-ui;margin:32px}main{display:grid;grid-template-columns:1fr 1fr;gap:32px}pre{background:#101820;padding:18px;border-left:3px solid #56b7ff;border-radius:5px;white-space:pre-wrap;overflow-wrap:anywhere;font:17px/1.5 monospace}p{white-space:pre-wrap;line-height:1.6}small{color:#b4c6d8}</style><h1>/limits display</h1><small>Synthetic renderer fixture. Provider headings and code blocks match the generated Telegram Markdown.</small><main><section><h2>Before</h2>${render(before)}</section><section><h2>After</h2>${render(after)}</section></main></html>`);
} finally {
  await rm(baselinePath, { force: true });
}
