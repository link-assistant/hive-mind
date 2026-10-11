// End to end: render the access GIF for a login into a temporary guides folder
// and "send" it through a fake Telegraf ctx, timing first and cached requests.
// Usage: node experiments/issue-2998/telegram-animation-e2e.mjs [login] [locale]
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [login = 'hive-e2e-bot', locale = 'ru'] = process.argv.slice(2);
process.env.HIVE_MIND_GUIDES_DIR = await mkdtemp(join(tmpdir(), 'hive-guides-e2e-'));
const { replyWithAccessAnimation } = await import('../../src/github-access-animation.lib.mjs');
const sent = [];
const ctx = { chat: { id: 1 }, replyWithAnimation: async (animation, options) => sent.push({ animation, options }) };
for (const label of ['first (renders)', 'second (cached)']) {
  const started = Date.now();
  const ok = await replyWithAccessAnimation({ ctx, login, ownerType: 'User', locale, replyToMessageId: 7, verbose: true });
  const { source } = sent.at(-1).animation;
  console.log(`${label}: ok=${ok} ${Date.now() - started}ms ${source} ${(await stat(source)).size} bytes caption=${JSON.stringify(sent.at(-1).options.caption)}`);
}
