// Finite synthetic Basic-header probe for native callback verification.
import { createSyncSanitizer, redact } from '@link-foundation/sensitive-data-sanitizer/credentials';
import { buildAuthorizationHeader, buildGitAuthConfigEnv } from '../../src/git-auth-transport.lib.mjs';
const token = ['ghp_', '0123456789abcdefghijklmnopqrstuvwxyzAB'].join('');
for (const [name, input] of Object.entries({
  header: buildAuthorizationHeader(token),
  env: Object.entries(buildGitAuthConfigEnv({ token }))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n'),
  base64: buildAuthorizationHeader(token).split(' ').pop(),
})) {
  for (const callback of [false, true]) {
    const transformation = callback
      ? finding => {
          const output = redact(finding.value, [{ ...finding, start: 0, end: finding.value.length }], { transformation: { mode: 'hive-mask' } });
          console.log(JSON.stringify({ name, rule: finding.rule, type: finding.type, inputLength: finding.value.length, outputLength: output.length }));
          return output;
        }
      : { mode: 'hive-mask' };
    try {
      const result = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation }).sanitize(input);
      console.log(JSON.stringify({ name, callback, success: true, length: result.text.length }));
    } catch (error) {
      console.log(JSON.stringify({ name, callback, code: error.code }));
    }
  }
}
