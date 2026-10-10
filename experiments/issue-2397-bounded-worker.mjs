// Run the exact upload-path sanitizer (sanitizeLogFileToFileBounded, worker
// for large logs) over a file and print the error/cause chain if blocked.
import { sanitizeLogFileToFileBounded } from '../src/log-sanitize-worker.lib.mjs';
const src = process.argv[2];
const t0 = Date.now();
try {
  const r = await sanitizeLogFileToFileBounded({ sourcePath: src, destPath: `/tmp/issue-2397/bounded-${Date.now()}.log`, onWorkerFallback: ({ error }) => console.log('worker fallback', error?.message) });
  console.log('OK', JSON.stringify(r), Date.now() - t0, 'ms');
} catch (e) {
  let c = e,
    chain = [];
  while (c) {
    chain.push(`${c.name}: ${c.message}`);
    c = c.cause;
  }
  console.log('BLOCKED', chain.join(' <- '), Date.now() - t0, 'ms');
}
process.exit(0);
