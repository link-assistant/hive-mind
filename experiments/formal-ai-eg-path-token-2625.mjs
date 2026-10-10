#!/usr/bin/env node
/**
 * Issue #2625: why Formal AI drafts open with "Let me open e.g and read what
 * it says." and fail on `read /tmp/gh-issue-solver-…/e.g`.
 *
 * A line-for-line JS port of link-assistant/formal-ai (main, d209aac)
 * rust/src/agentic_coding/file_read.rs `local_file_paths` →
 * `clean_file_token` → `looks_like_local_file_path`, plus
 * file_path_shape.rs `peel_sentence_punctuation` / `trim_trailing_sentence_dot`.
 *
 * Run: node experiments/formal-ai-eg-path-token-2625.mjs
 */
const trimTrailingSentenceDot = token => {
  const trimmed = token.replace(/\.+$/, '');
  return trimmed === '' || trimmed.endsWith('/') ? token : trimmed;
};
const trimMatches = (token, chars) => {
  let start = 0;
  let end = token.length;
  while (start < end && chars.includes(token[start])) start++;
  while (end > start && chars.includes(token[end - 1])) end--;
  return token.slice(start, end);
};
const strip = token => trimMatches(trimMatches(trimMatches(trimMatches(token, '`'), '"'), "'"), ',;:!?)([]{}');
const peelSentencePunctuation = token => {
  let current = token;
  for (;;) {
    const next = trimTrailingSentenceDot(strip(current));
    if (next === current) return current;
    current = next;
  }
};
const isFilePathChar = c => /[A-Za-z0-9_\-./\\@]/.test(c);
const isDottedNumber = token => /^\d+(\.\d+)+$/.test(token);
const looksLikeLocalFilePath = token => {
  if (!token || token.includes('://') || token.startsWith('http:') || token.startsWith('https:') || isDottedNumber(token)) return false;
  if (token.includes('/')) return [...token].every(isFilePathChar);
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const [stem, extension] = [token.slice(0, dot), token.slice(dot + 1)];
  return stem !== '' && extension !== '' && extension.length <= 12 && [...token].every(isFilePathChar);
};
const localFilePaths = prompt => [...new Set(prompt.split(/\s+/).map(peelSentencePunctuation).filter(looksLikeLocalFilePath))];

// From Hive Mind's agent system prompt (src/agent.prompts.lib.mjs).
const prompt = 'When WebFetch tool fails to retrieve expected content (e.g., returns empty content), read the file README.md instead (i.e. the docs).';
console.log('tokens taken as local files:', localFilePaths(prompt));
for (const abbreviation of ['(e.g.,', 'e.g.', '(i.e.', 'etc.', 'vs.', 'a.k.a.']) {
  console.log(`  ${JSON.stringify(abbreviation).padEnd(10)} → ${JSON.stringify(peelSentencePunctuation(abbreviation)).padEnd(8)} file-like: ${looksLikeLocalFilePath(peelSentencePunctuation(abbreviation))}`);
}
