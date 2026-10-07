// Print the Telegram Markdown (legacy) URL validation replies for a few inputs; no Telegram API calls.
import { initI18n } from '../../src/i18n.lib.mjs';
import { validateTelegramGitHubUrl } from '../../src/telegram-url-validation.lib.mjs';

await initI18n();
const inputs = process.argv.slice(2);
for (const url of inputs.length ? inputs : ['https://github.com/bpmbpm/mdld-test/issuese/1', 'https://github.com/o/r/pull', 'https://example.com/o/r/issues/1', 'https://github.com/my_org/a`b/issuese/1', 'https://github.com/some-long-organization-name/some-long-repository/issuese/1']) {
  console.log(`${validateTelegramGitHubUrl(url, { allowedTypes: ['issue', 'pull', 'repo'] }).error}\n---`);
}
