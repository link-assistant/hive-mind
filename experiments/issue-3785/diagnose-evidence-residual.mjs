// Print only structural information about a non-idempotent evidence sanitizer.
import { forEachLogBlock } from '../../src/log-sanitize-stream.lib.mjs';
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';
const rules = [
  [/([?&](?:token|auth|key|signature)=)[^\s<>"'\\)]+/gi, '$1[REDACTED]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[IDENTIFIER]'],
  [/("(?:email|full_name|display_name|first_name|last_name|account_id|chatgpt_account_id)"\s*:\s*)"[^"\n]*"/gi, '$1"[IDENTITY]"'],
  [/("(?:authorization|cookie|set-cookie)"\s*:\s*)"[^"\n]*"/gi, '$1"[REDACTED]"'],
];
let block = 0;
await forEachLogBlock(
  process.argv[2],
  async text => {
    block++;
    let output = text;
    const changes = [];
    for (const [index, [pattern, replacement]] of rules.entries()) {
      const next = output.replace(pattern, replacement);
      if (next !== output) {
        const matches = [...output.matchAll(pattern)].filter(match => match[0].replace(pattern, replacement) !== match[0]);
        changes.push({ index, before: output.length, after: next.length, matches: matches.map(match => ({ line: output.slice(0, match.index).split('\n').length, length: match[0].length, replacementLength: match[0].replace(pattern, replacement).length, valueIsRedaction: match[0].endsWith('[REDACTED]'), knownPlaceholder: ['[TOKEN]', '[EMAIL]', '[IDENTITY]', '[IDENTIFIER]', '[MASKED]', '[REDACTED]'].find(value => match[0].endsWith(value)), suffixIsPartialRedaction: '[REDACTED]'.startsWith(match[0].slice(match[0].lastIndexOf('=') + 1)) })) });
      }
      output = next;
    }
    const next = await sanitizeForPublication(output);
    if (next !== output) changes.push({ index: 'publication', before: output.length, after: next.length });
    if (changes.length) {
      console.log(JSON.stringify({ block, changes }));
      return false;
    }
  },
  { chunkBytes: 65536 }
);
