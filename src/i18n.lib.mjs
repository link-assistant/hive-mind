// i18n module for hive-mind.
// - Translation files live in src/locales/<locale>.lino and are stored
//   in Links Notation, parsed and resolved via lino-i18n.
// - Supported locales: en (default fallback), ru, zh, hi.
// - Two locale tracks: ui (user-facing strings) and work (AI prompts /
//   tool preferred language). Both default to the value of --language.
// - Public API: initI18n, t, getCurrentLocale, getUiLocale, getWorkLocale,
//   setLocale, setUiLocale, setWorkLocale, getSupportedLocales,
//   normalizeLocale, getUserLocale, setUserLocale, clearUserLocale,
//   resolveLocaleFromTelegramCtx.

import path from 'path';
import { fileURLToPath } from 'url';
import { createI18n } from 'lino-i18n';
import { loadLocalesFromFile } from 'lino-i18n/loaders';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['en', 'ru', 'zh', 'hi'];
const LINO_COMPATIBILITY_ALIASES = ['collapseTail', 'parentLabel'];

const localeCache = new Map(); // locale -> { key: string }
const userLocales = new Map(); // userId/chatId -> locale (in-memory)
const localesDir = path.join(__dirname, 'locales');

let currentUiLocale = DEFAULT_LOCALE;
let currentWorkLocale = DEFAULT_LOCALE;
let fallbackLoaded = false;
let i18n = createI18n({
  locales: {},
  defaultLocale: DEFAULT_LOCALE,
  fallback: [DEFAULT_LOCALE],
  compatibilityAliases: LINO_COMPATIBILITY_ALIASES,
});

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

export function normalizeLocale(input) {
  if (!input || typeof input !== 'string') return null;
  const lower = input.toLowerCase();
  // Take only the language part (before "_" or "-")
  const lang = lower.split(/[_\-.]/)[0];
  if (SUPPORTED_LOCALES.includes(lang)) return lang;
  return null;
}

export function detectLocale() {
  const envLocale = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || '';
  return normalizeLocale(envLocale) || DEFAULT_LOCALE;
}

async function readLocaleFile(locale) {
  const linoFile = path.join(localesDir, `${locale}.lino`);
  const loaded = await loadLocalesFromFile(linoFile, {
    compatibilityAliases: LINO_COMPATIBILITY_ALIASES,
  });
  const match = loaded.find(catalogue => catalogue.locale === locale) || loaded[0];
  return match?.translations || {};
}

function refreshI18nRuntime() {
  i18n = createI18n({
    locales: Object.fromEntries(localeCache.entries()),
    defaultLocale: currentUiLocale,
    fallback: [DEFAULT_LOCALE],
    compatibilityAliases: LINO_COMPATIBILITY_ALIASES,
  });
  i18n.setLocale(currentUiLocale);
}

export async function loadTranslations(locale) {
  if (localeCache.has(locale)) return localeCache.get(locale);

  let translations = {};
  try {
    translations = await readLocaleFile(locale);
  } catch {
    translations = {};
  }
  localeCache.set(locale, translations);
  refreshI18nRuntime();

  // Always have the fallback (English) ready
  if (!fallbackLoaded && locale !== DEFAULT_LOCALE) {
    try {
      const fb = await readLocaleFile(DEFAULT_LOCALE);
      localeCache.set(DEFAULT_LOCALE, fb);
    } catch {
      localeCache.set(DEFAULT_LOCALE, {});
    }
    fallbackLoaded = true;
    refreshI18nRuntime();
  } else if (locale === DEFAULT_LOCALE) {
    fallbackLoaded = true;
  }

  return translations;
}

// initI18n accepts either a single locale string (legacy) that sets both
// ui and work locales, or an object { language, uiLanguage, workLanguage }.
// Resolution rules:
//   - If uiLanguage given, use it for UI; else use language; else detect.
//   - If workLanguage given, use it for work; else use language; else detect.
export async function initI18n(input = null) {
  let language = null;
  let uiLanguage = null;
  let workLanguage = null;

  if (input && typeof input === 'object') {
    language = input.language ?? null;
    uiLanguage = input.uiLanguage ?? null;
    workLanguage = input.workLanguage ?? null;
  } else if (typeof input === 'string') {
    language = input;
  }

  const baseLocale = (language ? normalizeLocale(language) : null) || detectLocale();
  const uiLocale = (uiLanguage ? normalizeLocale(uiLanguage) : null) || baseLocale;
  const workLocale = (workLanguage ? normalizeLocale(workLanguage) : null) || baseLocale;

  currentUiLocale = uiLocale;
  currentWorkLocale = workLocale;

  await loadTranslations(uiLocale);
  if (workLocale !== uiLocale) {
    await loadTranslations(workLocale);
  }
  if (uiLocale !== DEFAULT_LOCALE && workLocale !== DEFAULT_LOCALE) {
    await loadTranslations(DEFAULT_LOCALE);
  }

  return { uiLocale, workLocale };
}

function applyParams(text, params) {
  if (!params) return text;
  let out = text;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
  }
  return out;
}

// t() returns a translated string. By default uses the UI locale.
// Pass options.locale to override; pass options.track = 'work' to use the
// work locale (for AI prompts).
export function t(key, params = {}, options = {}) {
  let locale;
  if (options.locale) {
    locale = normalizeLocale(options.locale) || currentUiLocale;
  } else if (options.track === 'work') {
    locale = currentWorkLocale;
  } else {
    locale = currentUiLocale;
  }
  const value = i18n.t(key, params, { ...options, locale });
  return typeof value === 'string' ? value : applyParams(String(value), params);
}

// Convenience helper for work-language strings (AI prompts).
export function tWork(key, params = {}) {
  return t(key, params, { track: 'work' });
}

export function getCurrentLocale() {
  return currentUiLocale;
}

export function getUiLocale() {
  return currentUiLocale;
}

export function getWorkLocale() {
  return currentWorkLocale;
}

export function setLocale(locale) {
  const normalized = normalizeLocale(locale);
  if (normalized) {
    currentUiLocale = normalized;
    currentWorkLocale = normalized;
    i18n.setLocale(normalized);
  }
}

export function setUiLocale(locale) {
  const normalized = normalizeLocale(locale);
  if (normalized) {
    currentUiLocale = normalized;
    i18n.setLocale(normalized);
  }
}

export function setWorkLocale(locale) {
  const normalized = normalizeLocale(locale);
  if (normalized) currentWorkLocale = normalized;
}

// In-memory per-user locale store (used by the Telegram bot).
export function getUserLocale(userId) {
  if (userId === undefined || userId === null) return null;
  return userLocales.get(String(userId)) || null;
}

export function setUserLocale(userId, locale) {
  const normalized = normalizeLocale(locale);
  if (!normalized || userId === undefined || userId === null) return false;
  userLocales.set(String(userId), normalized);
  return true;
}

export function clearUserLocale(userId) {
  if (userId === undefined || userId === null) return false;
  return userLocales.delete(String(userId));
}

// Resolve the best locale for a Telegram update context.
// Priority: per-user override -> ctx.from.language_code -> current default.
export function resolveLocaleFromTelegramCtx(ctx) {
  const userId = ctx?.from?.id;
  const userOverride = getUserLocale(userId);
  if (userOverride) return userOverride;
  const fromTelegram = normalizeLocale(ctx?.from?.language_code);
  if (fromTelegram) return fromTelegram;
  return currentUiLocale;
}

// Pre-load every supported locale (handy for the Telegram bot at startup).
export async function preloadAllLocales() {
  for (const loc of SUPPORTED_LOCALES) {
    try {
      await loadTranslations(loc);
    } catch {
      // ignore - missing files fall back to English
    }
  }
}
