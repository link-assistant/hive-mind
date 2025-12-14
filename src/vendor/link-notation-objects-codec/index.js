/**
 * Link Notation Objects Codec - Universal serializer/deserializer for JavaScript objects.
 *
 * This is a vendored copy from: https://github.com/link-foundation/link-notation-objects-codec
 *
 * Once the package is published to npm, this vendored copy should be removed
 * and replaced with a proper npm dependency.
 *
 * @module link-notation-objects-codec
 */

// Typed object codec (preserves types with markers like (int 42), (str base64))
export { ObjectCodec, encode, decode } from './codec.js';

// Formatting utilities for JSON/Lino conversion
export {
  escapeReference,
  unescapeReference,
  jsonToLino,
  linoToJson,
  formatAsLino,
} from './format.js';

// Fuzzy matching utilities
export {
  levenshteinDistance,
  stringSimilarity,
  normalizeQuestion,
  extractKeywords,
  keywordSimilarity,
  findBestMatch,
  findAllMatches,
} from './fuzzy-match.js';
