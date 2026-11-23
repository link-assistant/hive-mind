import { sanitizeCredentialText } from '../../src/credential-sanitization-core.lib.mjs';
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const input = '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_PRIVATE_KEY_MATERIAL_123456\n-----END PRIVATE KEY-----';
const s = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' }, transformations: { PRIVATE_KEY: { mode: 'redact' } } });
console.log(JSON.stringify({ findings: s.inspect(input), native: s.sanitize(input).text, adapter: sanitizeCredentialText(input, { includeEnvironmentCredentials: false }) }));
