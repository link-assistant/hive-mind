// Library-only, finite probes. Print only case names, lengths and booleans.
// `passes: false` documents an upstream gap; adapter regressions must pass.
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const engine = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' }, transformations: { PRIVATE_KEY: { mode: 'redact' } } });
const secret = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');
const wrapped =
  Buffer.alloc(150000, 147)
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\n') + '\n';
const key = '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_PRIVATE_KEY_MATERIAL_123456\n-----END PRIVATE KEY-----';
const cases = [
  ['maskedProse (#148)', engine.sanitize(`User token: ${secret}. Next sentence`).text, 'User token: ghp…b4N. Next sentence'],
  ['wrappedPayload (#149)', wrapped, wrapped],
  ['constructorKeyword (#150)', 'const sessionToken = new SessionToken();', 'const sessionToken = new SessionToken();'],
  ['markdownValues (#151)', 'set `password=<secret>` in the config', 'set `password=<secret>` in the config'],
  ['overlappingScheme (#152)', 'Authorization: SharedAccessSignature sr=namespace&sig=abcdefghijklmnopqrstuvwxyz123456&se=123456', 'Authorization: SharedAccessSignature sr=…456'],
  ['encodedMask (#153)', '"token":"Z2hv4oCmOTk5"', '"token":"Z2hv4oCmOTk5"'],
  ['privateKeyType (#154)', key, '-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----'],
];
for (const [name, input, expected] of cases) {
  const output = engine.sanitize(input).text;
  console.log(JSON.stringify({ name, inputLength: input.length, outputLength: output.length, passes: output === expected }));
}
