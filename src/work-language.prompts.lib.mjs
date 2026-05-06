// Issue #378: shared helper that emits a "working language" directive to be
// appended to every tool's system prompt. The directive is empty for English
// (default), and tells the model to communicate with the user in the chosen
// work language for free-form text (PR/issue comments, commit messages, chat),
// while keeping code, identifiers, and CLI strings as-is.

import { getWorkLocale } from './i18n.lib.mjs';

const LOCALE_DISPLAY_NAMES = Object.freeze({
  en: 'English',
  ru: 'Russian',
  zh: 'Chinese (Simplified)',
  hi: 'Hindi',
});

export function buildWorkLanguageDirective(locale = getWorkLocale()) {
  if (!locale || locale === 'en') return '';
  const name = LOCALE_DISPLAY_NAMES[locale] || locale;
  return `\n\nWorking language: ${name}. When you communicate with the user via comments, commit messages, pull request titles/descriptions, and chat replies, use ${name}. Code, identifiers, and command-line strings stay in their original form.`;
}

export default { buildWorkLanguageDirective };
