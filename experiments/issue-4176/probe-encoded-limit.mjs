import assert from 'node:assert/strict';
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';

const encoded = '%20'.repeat(3000);
const engine = createSyncSanitizer({ transformation: { mode: 'hive-mask' } });
console.log(
  'Finding and default replacement:',
  engine.inspect(encoded).map(({ type }) => type),
  engine.sanitize(encoded).text
);

const opaqueRedaction = createSyncSanitizer({ transformation: { mode: 'hive-mask' }, transformations: { ENCODED_LIMIT: { mode: 'redact' } } });
assert.equal(opaqueRedaction.sanitize(encoded).text, '[REDACTED]');
console.log('Built-in per-finding policy replaces the entire opaque span.');

assert.throws(() => createSyncSanitizer({ transformation: () => '[Sensitive content omitted]' }).sanitize(encoded), { code: 'ERR_SANITIZATION' });
console.log('Custom callback on the same over-budget span reproduces ERR_SANITIZATION.');

const collision = createSyncSanitizer({ preserveEncoding: true, transformation: { mode: 'hive-mask' }, knownSecrets: ['REDACTED'] });
assert.throws(() => collision.sanitize('ordinary REDACTED diagnostic\n'), { code: 'ERR_RESIDUAL' });
console.log('A synthetic known secret inside the built-in replacement also reproduces ERR_RESIDUAL.');
