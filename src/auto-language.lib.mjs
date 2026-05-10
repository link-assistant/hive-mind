import { detect as detectLanguage } from 'tinyld';

const WORD_PATTERN = /\p{L}[\p{L}\p{M}'-]*/gu;
const TARGET_LANGUAGES = new Set(['en', 'ru']);
const DEFAULT_THRESHOLD = 0.51;

export function extractLanguageWords(text) {
  if (!text || typeof text !== 'string') return [];
  return text.match(WORD_PATTERN) || [];
}

function detectByScript(word) {
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(word);
  const hasLatin = /\p{Script=Latin}/u.test(word);
  if (hasCyrillic && !hasLatin) return 'ru';
  if (hasLatin && !hasCyrillic) return 'en';
  return null;
}

export function detectWordLanguage(word, detector = detectLanguage) {
  if (!word || typeof word !== 'string') return null;
  let detected = null;
  try {
    detected = detector(word);
  } catch {
    detected = null;
  }
  if (TARGET_LANGUAGES.has(detected)) return detected;
  return detectByScript(word);
}

export function detectIssueLanguageFromText(text, { detector = detectLanguage, threshold = DEFAULT_THRESHOLD, fallbackLanguage = 'en' } = {}) {
  const words = extractLanguageWords(text);
  const counts = { en: 0, ru: 0, detected: 0, ignored: 0, total: words.length };

  for (const word of words) {
    const language = detectWordLanguage(word, detector);
    if (language === 'en' || language === 'ru') {
      counts[language] += 1;
      counts.detected += 1;
    } else {
      counts.ignored += 1;
    }
  }

  const ratios = {
    en: counts.total > 0 ? counts.en / counts.total : 0,
    ru: counts.total > 0 ? counts.ru / counts.total : 0,
  };

  let language = fallbackLanguage;
  if (ratios.ru > threshold) {
    language = 'ru';
  } else if (ratios.en > threshold) {
    language = 'en';
  }

  return { language, counts, ratios, threshold };
}

export async function fetchTargetTextForAutoLanguage({ githubLib, owner, repo, number, isIssueUrl, isPrUrl }) {
  const jsonFields = 'number,title,body';
  let result = null;
  if (isIssueUrl) {
    result = await githubLib.ghIssueView({ issueNumber: number, owner, repo, jsonFields });
  } else if (isPrUrl) {
    result = await githubLib.ghPrView({ prNumber: number, owner, repo, jsonFields });
  }

  if (!result || result.code !== 0 || !result.data) return null;
  return [result.data.title, result.data.body].filter(Boolean).join('\n\n');
}

export async function applyAutoLanguageToArgv({ argv, githubLib, owner, repo, number, isIssueUrl, isPrUrl, log = async () => {} }) {
  if (!argv?.autoLanguage || argv._workLanguageExplicit) return null;

  try {
    const text = await fetchTargetTextForAutoLanguage({ githubLib, owner, repo, number, isIssueUrl, isPrUrl });
    if (!text) {
      argv.workLanguage = argv.workLanguage || 'en';
      await log('Auto language detection could not fetch target text; using English work language.', { verbose: true });
      return null;
    }

    const result = detectIssueLanguageFromText(text);
    argv.workLanguage = result.language;
    await log(`Auto language detection selected work language: ${result.language} (en=${result.counts.en}, ru=${result.counts.ru}, detected=${result.counts.detected})`, { verbose: true });
    return result;
  } catch (error) {
    argv.workLanguage = argv.workLanguage || 'en';
    await log(`Auto language detection failed: ${error?.message || error}; using English work language.`, { verbose: true });
    return null;
  }
}
