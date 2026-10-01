// Run a log file through sanitizeLogFileToFile (default publication sanitizer)
// and print the error.cause chain if it is blocked.
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';
const src = process.argv[2];
const t0 = Date.now();
let blockNo = 0;
const { sanitizeForPublication } = (await import('../src/token-sanitization.lib.mjs')).default;
try {
  const r = await sanitizeLogFileToFile({
    sourcePath: src,
    destPath: '/tmp/issue-2397/out-' + Date.now() + '.log',
    sanitize: async text => {
      blockNo++;
      try {
        return await sanitizeForPublication(text);
      } catch (e) {
        e.blockNo = blockNo;
        e.blockLen = text.length;
        throw e;
      }
    },
  });
  console.log('OK', r, Date.now() - t0 + 'ms');
} catch (e) {
  let c = e,
    chain = [];
  while (c) {
    chain.push(`${c.name}: ${c.message}`);
    c = c.cause;
  }
  console.log('BLOCKED at block', e.blockNo, 'len', e.blockLen, chain.join(' <- '), Date.now() - t0 + 'ms');
}
process.exit(0);
