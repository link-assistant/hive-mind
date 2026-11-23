// Finite synthetic check that a masked prefix cannot hide later opaque secrets.
import { sanitizeCredentialText } from '../../src/credential-sanitization-core.lib.mjs';
const opaque = ['f3a9', 'c2e1b7d4', '9a0e6f12', 'c4b8d3e5'].join('');
for (const suffix of [`; password=${opaque}`, `; token: ${opaque}`, `; Authorization: Bearer ${opaque}`]) {
  const input = `User token: ghp…b4N. Next sentence${suffix}`;
  const output = sanitizeCredentialText(input, { includeEnvironmentCredentials: false });
  console.log(JSON.stringify({ suffixKind: suffix.split(/[:=]/)[0], removed: !output.includes(opaque), outputLength: output.length }));
}
