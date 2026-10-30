/** Prompt builders remain synchronous; i18n preloads the locale tree once. */
import { getWorkLocale, getSupportedLocales, loadTranslations } from './i18n.lib.mjs';

const catalogues = new Map();
for (const locale of getSupportedLocales()) catalogues.set(locale, await loadTranslations(locale));
const english = catalogues.get('en');
const constantKeys = new Map(
  Object.entries(english)
    .filter(([key]) => key.startsWith('prompt.'))
    .map(([key, value]) => [value, key])
);

/** Only double braces interpolate; shell/JSON single braces and inserted payloads stay literal. */
export function promptText(key, params = {}, { locale = getWorkLocale() } = {}) {
  const template = catalogues.get(locale)?.[key] ?? english[key];
  if (typeof template !== 'string') throw new Error(`Missing prompt template: ${key}`);
  return template.replace(/\{\{\s*([\w.$:-]+)\s*\}\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/** Preserve exported English string constants while resolving their runtime work locale. */
export function localizePromptConstant(value) {
  const key = constantKeys.get(value);
  return key ? promptText(key) : value;
}
