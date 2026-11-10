// Probe how @link-foundation/sensitive-data-sanitizer handles the issue #3739 inputs.
import { createSyncSanitizer, createSanitizer } from '@link-foundation/sensitive-data-sanitizer';
const inputs = [
  'Authorization: token 0123456789abcdef0123456789abcdef01234567',
  'authorization: Token a1b2c3d4e5f6a7b8c9d0e1f2',
  'Authorization: Bearer 0123456789abcdef0123456789abcdef01234567',
  'curl -L -H "Authorization: token $(gh auth token)"',
  'Proxy-Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng==',
  'Authorization: Digest username="x", response="6629fae49393a05397450978507c4ef1"',
  'Authorization: ApiKey a1b2c3d4e5f6a7b8c9d0e1f2a1b2',
  '{"headers":{"Authorization":"token 0123456789abcdef0123456789abcdef01234567"}}',
];
const configs = {
  'credentialsOnly+hive-mask': { credentialsOnly: true, transformation: { mode: 'hive-mask' } },
  'credentialsOnly (redact)': { credentialsOnly: true },
};
for (const [name, cfg] of Object.entries(configs)) {
  console.log(`== sync ${name}`);
  const s = createSyncSanitizer(cfg);
  for (const i of inputs) { try { console.log(JSON.stringify(s.sanitize(i).text)); } catch (e) { console.log('ERR', e.code, e.message); } }
  console.log(`== async ${name}`);
  const a = createSanitizer(cfg);
  for (const i of inputs) { try { console.log(JSON.stringify((await a.sanitize(i)).text)); } catch (e) { console.log('ERR', e.code, e.message); } }
}
