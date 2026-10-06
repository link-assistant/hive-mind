import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { formatUrlRepairs, hasNotableRepair, namesGitHubHost } from './github-url-recovery.lib.mjs';
import { formatInputLocation } from './input-diagnostics.lib.mjs';
import { t } from './i18n.lib.mjs';
import { cleanNonPrintableChars, escapeMarkdown, makeSpecialCharsVisible } from './telegram-markdown.lib.mjs';

/** Validate the selected URL, retaining precise input diagnostics on rejection. */
export function validateTelegramGitHubUrl(rawUrl, { allowedTypes = ['issue', 'pull'], commandName = 'solve', locale = null } = {}) {
  if (!rawUrl) return { valid: false, error: t('telegram.missing_github_url', { commandName }, { locale }) };
  const url = cleanNonPrintableChars(rawUrl);
  const parsed = parseGitHubUrl(url);
  const reject = error => ({
    valid: false,
    error: `${error}\n\n${escapeMarkdown(parsed.inputHint || formatInputLocation(rawUrl, { label: 'URL' }))}`,
    suggestion: parsed.suggestion,
  });
  if (!namesGitHubHost(url)) return reject(t('telegram.first_arg_must_be_github_url', {}, { locale }));
  if (!parsed.valid) return reject(escapeMarkdown(parsed.error || 'Invalid GitHub URL'));
  const recoveryNotice = hasNotableRepair(parsed.repairs) ? t('telegram.url_recovered', { original: escapeMarkdown(makeSpecialCharsVisible(rawUrl)), used: escapeMarkdown(parsed.canonical), repairs: escapeMarkdown(formatUrlRepairs(parsed.repairs, { notableOnly: true })) }, { locale }) : null;
  if (!allowedTypes.includes(parsed.type)) {
    const allowedTypesStr = allowedTypes.map(type => (type === 'pull' ? 'pull request' : type)).join(', ');
    const baseUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    const escapedUrl = escapeMarkdown(url);
    const escapedBaseUrl = escapeMarkdown(baseUrl);
    let error;
    if (parsed.type === 'issues_list') error = t('telegram.url_issues_list_error', { url: escapedBaseUrl, example: `${escapedBaseUrl}/issues/1` }, { locale });
    else if (parsed.type === 'pulls_list') error = t('telegram.url_pulls_list_error', { url: escapedBaseUrl, example: `${escapedBaseUrl}/pull/1` }, { locale });
    else if (parsed.type === 'repo') error = t('telegram.url_repo_error', { allowedTypes: allowedTypesStr, url: escapedUrl, example: `${escapedBaseUrl}/issues/1` }, { locale });
    else error = t('telegram.url_must_be_type', { allowedTypes: allowedTypesStr, type: parsed.type.replace('_', ' ') }, { locale });
    return reject(error);
  }
  return { valid: true, parsed, normalizedUrl: url, recoveryNotice };
}
