/**
 * Fuzzy matching utilities for string comparison.
 *
 * These utilities are useful for finding similar questions in a Q&A database
 * when an exact match is not found.
 *
 * Based on the implementation from:
 * https://github.com/konard/hh-job-application-automation/blob/main/src/qa-database.mjs
 */

/**
 * Calculate Levenshtein distance between two strings.
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one string into another.
 *
 * @param {Object} options - Options
 * @param {string} options.a - First string
 * @param {string} options.b - Second string
 * @returns {number} Edit distance between the strings
 */
export function levenshteinDistance(options = {}) {
  const { a, b } = options;
  const matrix = [];

  // Initialize the matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1).
 * Uses Levenshtein distance normalized by the maximum string length.
 *
 * @param {Object} options - Options
 * @param {string} options.a - First string
 * @param {string} options.b - Second string
 * @returns {number} Similarity score (0 = completely different, 1 = identical)
 */
export function stringSimilarity(options = {}) {
  const { a, b } = options;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0;

  const distance = levenshteinDistance({ a, b });
  return 1 - distance / maxLength;
}

/**
 * Normalize a question string for comparison.
 * Converts to lowercase, removes punctuation, and standardizes spacing.
 *
 * @param {Object} options - Options
 * @param {string} options.question - Question to normalize
 * @returns {string} Normalized question
 */
export function normalizeQuestion(options = {}) {
  const { question } = options;
  return question
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract key words from a question, filtering out stopwords.
 *
 * @param {Object} options - Options
 * @param {string} options.question - Question string
 * @param {Set<string>} [options.stopwords=new Set()] - Custom stopwords set to filter out
 * @param {number} [options.minWordLength=2] - Minimum word length to include
 * @param {number} [options.stemLength=5] - Length to truncate words for stemming (0 to disable)
 * @returns {Set<string>} Set of key words
 */
export function extractKeywords(options = {}) {
  const { question } = options;
  const stopwords = options.stopwords ?? new Set();
  const minWordLength = options.minWordLength ?? 2;
  const stemLength = options.stemLength ?? 5;

  const normalized = normalizeQuestion({ question });
  const words = normalized.split(/\s+/);

  const keywords = new Set(
    words.filter(word => word.length > minWordLength && !stopwords.has(word))
  );

  // Add stems for longer words to improve matching
  if (stemLength > 0) {
    const stems = new Set();
    for (const word of keywords) {
      if (word.length > stemLength + 1) {
        stems.add(word.substring(0, stemLength));
      }
    }
    return new Set([...keywords, ...stems]);
  }

  return keywords;
}

/**
 * Calculate keyword overlap similarity (Jaccard index).
 *
 * @param {Object} options - Options
 * @param {string} options.a - First question
 * @param {string} options.b - Second question
 * @param {Set<string>} [options.stopwords] - Stopwords to filter from keyword extraction
 * @param {number} [options.minWordLength] - Minimum word length for keyword extraction
 * @param {number} [options.stemLength] - Stem length for keyword extraction
 * @returns {number} Similarity score (0-1)
 */
export function keywordSimilarity(options = {}) {
  const { a, b } = options;
  const keywordsA = extractKeywords({ question: a, ...options });
  const keywordsB = extractKeywords({ question: b, ...options });

  if (keywordsA.size === 0 && keywordsB.size === 0) return 1.0;
  if (keywordsA.size === 0 || keywordsB.size === 0) return 0.0;

  const intersection = new Set([...keywordsA].filter(x => keywordsB.has(x)));
  const union = new Set([...keywordsA, ...keywordsB]);

  return intersection.size / union.size;
}

/**
 * Find the best matching question from a database using fuzzy matching.
 * Combines edit distance similarity (40% weight) and keyword overlap (60% weight).
 *
 * @param {Object} options - Options
 * @param {string} options.question - Question to match
 * @param {Map<string, *>} options.qaDatabase - Q&A database (Map of questions to answers)
 * @param {number} [options.threshold=0.4] - Minimum similarity threshold (0-1)
 * @param {number} [options.editWeight=0.4] - Weight for edit distance similarity
 * @param {number} [options.keywordWeight=0.6] - Weight for keyword similarity
 * @param {Set<string>} [options.stopwords] - Stopwords to filter from keyword extraction
 * @param {number} [options.minWordLength] - Minimum word length for keyword extraction
 * @param {number} [options.stemLength] - Stem length for keyword extraction
 * @returns {{question: string, answer: *, score: number} | null} Best match or null
 */
export function findBestMatch(options = {}) {
  const { question, qaDatabase } = options;
  const threshold = options.threshold ?? 0.4;
  const editWeight = options.editWeight ?? 0.4;
  const keywordWeight = options.keywordWeight ?? 0.6;

  // Check for exact match first
  if (qaDatabase.has(question)) {
    return { question, answer: qaDatabase.get(question), score: 1.0 };
  }

  let bestMatch = null;
  let bestScore = threshold;

  for (const [dbQuestion, answer] of qaDatabase.entries()) {
    const editSimilarity = stringSimilarity({ a: normalizeQuestion({ question }), b: normalizeQuestion({ question: dbQuestion }) });
    const kwSimilarity = keywordSimilarity({ a: question, b: dbQuestion, ...options });

    const combinedScore = editSimilarity * editWeight + kwSimilarity * keywordWeight;

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestMatch = { question: dbQuestion, answer, score: combinedScore };
    }
  }

  return bestMatch;
}

/**
 * Find all matches above a threshold, sorted by score (descending).
 *
 * @param {Object} options - Options
 * @param {string} options.question - Question to match
 * @param {Map<string, *>} options.qaDatabase - Q&A database
 * @param {number} [options.threshold=0.4] - Minimum similarity threshold (0-1)
 * @param {number} [options.editWeight=0.4] - Weight for edit distance similarity
 * @param {number} [options.keywordWeight=0.6] - Weight for keyword similarity
 * @param {Set<string>} [options.stopwords] - Stopwords to filter from keyword extraction
 * @param {number} [options.minWordLength] - Minimum word length for keyword extraction
 * @param {number} [options.stemLength] - Stem length for keyword extraction
 * @returns {Array<{question: string, answer: *, score: number}>} Matches sorted by score
 */
export function findAllMatches(options = {}) {
  const { question, qaDatabase } = options;
  const threshold = options.threshold ?? 0.4;
  const editWeight = options.editWeight ?? 0.4;
  const keywordWeight = options.keywordWeight ?? 0.6;

  const matches = [];

  for (const [dbQuestion, answer] of qaDatabase.entries()) {
    let score;

    if (dbQuestion === question) {
      score = 1.0;
    } else {
      const editSimilarity = stringSimilarity({
        a: normalizeQuestion({ question }),
        b: normalizeQuestion({ question: dbQuestion })
      });
      const kwSimilarity = keywordSimilarity({ a: question, b: dbQuestion, ...options });
      score = editSimilarity * editWeight + kwSimilarity * keywordWeight;
    }

    if (score >= threshold) {
      matches.push({ question: dbQuestion, answer, score });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches;
}
