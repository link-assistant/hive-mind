// Issue #3505: a "Did you mean" suggestion is placed in a code span; a backtick
// typed by the user would close the span early and break the whole reply.
import { initI18n, t } from '../src/i18n.lib.mjs';
import { validateTelegramGitHubUrl } from '../src/telegram-url-validation.lib.mjs';
import { validateTelegramText } from '../src/telegram-markdown-validator.lib.mjs';

await initI18n?.();
const raw = process.argv[2] || 'https://github.com\\owner\\repo\\issues\\1?q=a`b';
const validation = validateTelegramGitHubUrl(raw, { allowedTypes: ['issue', 'pull', 'repo'] });
let message = `❌ ${validation.error}`;
if (validation.suggestion) message += `\n\n${t('telegram.did_you_mean', { suggestion: validation.suggestion }, { locale: 'en' })}`;
console.log(message);
console.log(JSON.stringify(validateTelegramText(message, 'Markdown')));
