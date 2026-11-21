import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readBoundedFile } from '../../lib/files.mjs';

export const archiveRedactionReceipt = '.redaction-policy';

export async function loadArchiveRedactions(path) {
  if (path === undefined) return null;
  const file = await readBoundedFile(path, 64 * 1024, 'known secrets file', { noFollow: true });
  if (!isUtf8(file) || file.includes(0)) throw new Error('The known secrets file must contain UTF-8 text.');
  const literals = [
    ...new Set(
      file
        .toString('utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
    ),
  ].sort();
  if (!literals.length) throw new Error('The known secrets file must contain at least one literal.');
  const variants = [...new Set(literals.flatMap(literal => [literal, JSON.stringify(literal).slice(1, -1)]))].sort((a, b) => b.length - a.length);
  const expression = variants.map(literal => RegExp.escape(literal)).join('|');
  const find = new RegExp(expression);
  const replace = new RegExp(expression, 'g');
  const overlap = variants[0].length - 1;
  const digest = createHash('sha256').update(JSON.stringify(literals)).digest('hex');

  const contains = text => find.test(text);
  function assertClean(text) {
    if (contains(text)) throw new Error('An archive file still contains a configured literal. Redact it before publishing.');
  }

  async function assertCleanFile(filePath) {
    let tail = '';
    for await (const chunk of createReadStream(filePath, { encoding: 'utf8' })) {
      const text = tail + chunk;
      assertClean(text);
      tail = overlap ? text.slice(-overlap) : '';
    }
  }

  return { digest, redact: text => text.replace(replace, '[REDACTED]'), contains, assertClean, assertCleanFile };
}
