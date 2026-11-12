import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const s = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } });
for (const text of ['token: Z2hv4oCmOTk5', '"token":"Z2hv4oCmOTk5"', String.raw`{\"token\":\"Z2hv4oCmOTk5\"}`]) {
  console.log(JSON.stringify({ text, output: s.sanitize(text).text, findings: s.inspect(text) }));
}
