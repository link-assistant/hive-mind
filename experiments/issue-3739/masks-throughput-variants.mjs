// Library-only throughput per line shape, 20,000 lines each (bounded).
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const engine = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' }, transformations: { PRIVATE_KEY: { mode: 'redact' } } });
const shapes = {
  plain: i => `line ${i} ordinary progress text without anything special`,
  githubMask: i => `line ${i} token ghp…b4N`,
  bearerMask: i => `line ${i} Bearer 012…567`,
  both: i => `line ${i} token ghp…b4N and Bearer 012…567`,
  numbers: i => `line ${i} took ${i * 7} ms at offset ${i * 4096}`,
};
for (const [name, make] of Object.entries(shapes)) {
  const text = Array.from({ length: 20000 }, (_, i) => make(i)).join('\n') + '\n';
  const started = performance.now();
  for (let offset = 0; offset < text.length; offset += 256 * 1024) engine.sanitize(text.slice(offset, offset + 256 * 1024));
  const ms = performance.now() - started;
  console.log(JSON.stringify({ name, bytes: Buffer.byteLength(text), ms: Math.round(ms), kbPerSecond: Math.round(Buffer.byteLength(text) / 1024 / (ms / 1000)) }));
}
