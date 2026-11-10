// Finite library-only reproducer; only metadata is printed.
import { createRequire } from 'node:module';
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const require = createRequire(import.meta.url);
const options = { credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } };
const engines = { esm: createSyncSanitizer(options), cjs: require('@link-foundation/sensitive-data-sanitizer/credentials').createSyncSanitizer(options) };
for (const digits of [10, 11]) {
  for (const suffix of ['\ntrailing line\n', '\n# trailing line\n', '\n']) {
    const secret = ['gho_', 'SYNTHETIC0000NotARealToken', '1'.repeat(digits)].join('');
    const document = { token: secret, note: 'keep me' };
    const raw = Buffer.from(JSON.stringify(document)).toString('base64');
    const body = raw.match(/.{1,20}/g).join('\n');
    const prefix = 'start of output\nresponse body=\n';
    for (const [entry, engine] of Object.entries(engines)) {
      const input = prefix + body + suffix;
      const output = engine.sanitize(input).text;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.from(output.slice(prefix.length, -suffix.length), 'base64').toString());
      } catch {}
      console.log(JSON.stringify({ entry, secretLength: secret.length, padded: raw.endsWith('='), suffix: suffix.includes('#') ? 'hash' : suffix.length === 1 ? 'newline' : 'word', inputLength: input.length, outputLength: output.length, completeJsonPreserved: parsed?.note === document.note && parsed?.token === 'gho…111' }));
    }
  }
}
