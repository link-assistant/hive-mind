import { sanitizeCredentialText } from '../../src/credential-sanitization-core.lib.mjs';
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const input = ['-----BEGIN PRIVATE KEY-----', 'SYNTHETIC_PRIVATE_KEY_MATERIAL_123456789', 'SECOND_SYNTHETIC_PRIVATE_KEY_LINE_987654321', '-----END PRIVATE KEY-----'].join('\n');
const s = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' }, transformations: { PRIVATE_KEY: { mode: 'redact' } } });
console.log(JSON.stringify({ findings: s.inspect(input), native: s.sanitize(input).text, adapter: sanitizeCredentialText(input, { includeEnvironmentCredentials: false }) }));
