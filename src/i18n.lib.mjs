// i18n module for hive-mind.
// - Translation files live in src/locales/<locale>.lino and are stored
//   in Links Notation, parsed via lino-objects-codec.
// - Supported locales: en (default fallback), ru, zh, hi.
// - Public API: initI18n, t, getCurrentLocale, setLocale, getSupportedLocales,
//   normalizeLocale, getUserLocale, setUserLocale, clearUserLocale,
//   resolveLocaleFromTelegramCtx.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseIndented } from 'lino-objects-codec';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['en', 'ru', 'zh', 'hi'];

const localeCache = new Map(); // locale -> { key: string }
const userLocales = new Map(); // userId/chatId -> locale (in-memory)

let currentLocale = DEFAULT_LOCALE;
let fallbackLoaded = false;

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
  const localesDir = path.join(__dirname, 'locales');
  const linoFile = path.join(localesDir, `${locale}.lino`);
  const data = await fs.readFile(linoFile, 'utf-8');
  return parseIndentedToFlatMap(data);
}

// parseIndented returns { id, obj } where obj is the key->value map.
// Some keys contain dots (e.g., error.invalid_github_url). The parser
// supports them when the key is a plain reference (no spaces/quotes).
function unescapeString(s) {
  // Convert literal escape sequences (e.g., "\n" inside a quoted string in
  // Links Notation) into the corresponding JS characters. This keeps the
  // .lino files single-line and human-friendly.
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
}

function parseIndentedToFlatMap(text) {
  const parsed = parseIndented({ text });
  // parsed: { id: <localeName>, obj: { key: value, ... } }
  if (!parsed || !parsed.obj) return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed.obj)) {
    out[k] = typeof v === 'string' ? unescapeString(v) : String(v);
  }
  return out;
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

  // Always have the fallback (English) ready
  if (!fallbackLoaded && locale !== DEFAULT_LOCALE) {
    try {
      const fb = await readLocaleFile(DEFAULT_LOCALE);
      localeCache.set(DEFAULT_LOCALE, fb);
    } catch {
      localeCache.set(DEFAULT_LOCALE, {});
    }
    fallbackLoaded = true;
  } else if (locale === DEFAULT_LOCALE) {
    fallbackLoaded = true;
  }

  return translations;
}

export async function initI18n(localeInput = null) {
  const requested = localeInput ? normalizeLocale(localeInput) : null;
  const detectedLocale = requested || detectLocale();
  currentLocale = detectedLocale;
  await loadTranslations(detectedLocale);
  if (detectedLocale !== DEFAULT_LOCALE) {
    await loadTranslations(DEFAULT_LOCALE);
  }
  return detectedLocale;
}

function applyParams(text, params) {
  if (!params) return text;
  let out = text;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
  }
  return out;
}

export function t(key, params = {}, options = {}) {
  const locale = options.locale ? normalizeLocale(options.locale) || currentLocale : currentLocale;
  const main = localeCache.get(locale) || {};
  const fallback = localeCache.get(DEFAULT_LOCALE) || {};
  const value = main[key] ?? fallback[key] ?? key;
  return applyParams(value, params);
}

export function getCurrentLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  const normalized = normalizeLocale(locale);
  if (normalized) currentLocale = normalized;
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
  return currentLocale;
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
