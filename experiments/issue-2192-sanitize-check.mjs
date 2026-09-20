// Issue #2192: verify the preemptive Authorization header never survives the
// log sanitizer, in both its header form and its raw base64 form.
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { buildAuthorizationHeader, buildGitAuthConfigEnv } from '../src/git-auth-transport.lib.mjs';

const token = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
const header = buildAuthorizationHeader(token);
const patch = buildGitAuthConfigEnv({ token });

for (const [label, text] of [
  ['header', header],
  [
    'env dump',
    Object.entries(patch)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  ],
  ['base64 only', header.split(' ').pop()],
]) {
  const sanitized = sanitizeCredentialText(text, { includeEnvironmentCredentials: false });
  console.log(`--- ${label} ---`);
  console.log(sanitized);
  console.log(`leaks token: ${sanitized.includes(token)} | leaks base64: ${sanitized.includes(header.split(' ').pop())}`);
}
