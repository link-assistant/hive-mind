import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const s = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } });
const gho = `gho_${'A'.repeat(12)}SyntheticNotReal${'9'.repeat(8)}`;
const encoded = Buffer.from(gho).toString('base64');
const record = `[INFO] "content": "token len ${gho.length}\\n{\\"token\\":\\"${encoded}\\"}\\n"`;
for (const text of ['Authorization: SharedAccessSignature sr=namespace&sig=abcdefghijklmnopqrstuvwxyz123456&se=123456', record]) {
  console.log(JSON.stringify({ input: text, output: s.sanitize(text).text, findings: s.inspect(text) }));
}
