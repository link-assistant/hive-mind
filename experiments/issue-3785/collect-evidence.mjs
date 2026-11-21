// Preserve incident evidence without publishing download credentials or identity.
// Run with --max-old-space-size=192; logs are processed in 64 KiB blocks.
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';
import { sanitizeLogFileToFile, findResidualCredentialBlock } from '../../src/log-sanitize-stream.lib.mjs';

const dest = 'docs/case-studies/issue-3785/evidence';
await mkdir(dest, { recursive: true });
function redactIdentity(text) {
  return text
    .replace(/([?&](?:token|auth|key|signature)=)[^\s<>"'\\)]+/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[IDENTIFIER]')
    .replace(/("(?:email|full_name|display_name|first_name|last_name|account_id|chatgpt_account_id)"\s*:\s*)"[^"\n]*"/gi, '$1"[IDENTITY]"')
    .replace(/("(?:authorization|cookie|set-cookie)"\s*:\s*)"[^"\n]*"/gi, '$1"[REDACTED]"');
}
const sanitize = text => sanitizeForPublication(redactIdentity(text));
// These local API captures include the issue's authenticated download URL.
for (const name of ['issue.json', 'issue-comments.json', 'pr-comments.json', 'pr-inline-comments.json', 'pr-reviews.json']) {
  const path = `experiments/issue-3785/${name}`;
  const rawPath = `/tmp/issue-3785-context-${name}`;
  const captured = await readFile(rawPath, 'utf8').catch(() => readFile(path, 'utf8'));
  // Remove authenticated query strings before scanning the JSON serialization.
  // Public attachment UUIDs are useful provenance, not account identities.
  const scrubbed = captured.replace(/\?token=[^\s<>"'\\)]+/gi, '');
  const parsed = JSON.parse(await sanitizeForPublication(scrubbed));
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
}
const manifest = [];
for (const [sourcePath, name] of [
  ['/tmp/issue-3785-failure.log', 'failed-task.log'],
  ['/tmp/issue-3785-private-bot.log', 'bot.log'],
]) {
  const destPath = `/tmp/issue-3785-sanitized-${name}`;
  await rm(destPath, { force: true });
  const stats = await sanitizeLogFileToFile({ sourcePath, destPath, sanitize, chunkBytes: 65536 });
  const residual = await findResidualCredentialBlock(destPath, { sanitize, chunkBytes: 65536 });
  if (residual) throw new Error(`Publication verification failed for ${name} at block ${residual.blockIndex}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(destPath)) digest.update(chunk);
  await pipeline(createReadStream(destPath), createGzip({ level: 9 }), createWriteStream(`${dest}/${name}.gz`));
  manifest.push({ file: `${name}.gz`, contentSha256: digest.digest('hex'), sourceBytes: stats.sourceSize, sanitizedBytes: (await stat(destPath)).size, redacted: ['credentials', 'download query tokens', 'emails', 'UUIDs', 'account identity fields'], residualCredentialBlock: residual });
}
for (const name of [
  'auth-copy',
  'file-mount',
  'codex-storage',
  'limits-before',
  'cache-before',
  'catalog-before',
  'privacy-before',
  'router-before',
  'router-mapping-before',
  'malformed-before',
  'router-admission-before',
  'router-admission-final',
  'router-dialect-before',
  'route-lease-before',
  'route-lease-final',
  'router-regressions',
  'router-isolation-final',
  'router-routes-final',
  'router-hardening-final',
  'limits-final',
  'audit-before',
  'audit-after',
  'profile-log-before',
  'route-diagnostics-before',
  'security-tests',
  'admission-before',
  'admission-yield-before',
  'audit-toml-before',
  'audit-growth-before',
  'admission-after',
  'concurrent-refresh',
  'queue-before',
  'queue-after',
  'admission-focused',
  'audit-semantic-before',
  'audit-semantic-after',
  'semantic-focused',
  'global-baseline-before',
  'global-baseline-focused',
  'cache-reset-before',
  'cache-reset-after',
  'queue-isolated-after',
  'stock-before',
  'stock-after',
  'stock-verified',
  'appserver-auth',
  'auth-hooks',
  'packaged-before',
  'packaged-after',
  'coolify-baseline-before',
  'image-package',
  'package-focused-final',
  'mcp-before',
  'mcp-relocated-before',
  'mcp-focused',
  'mcp-native',
  'pinned-updates-before',
  'pinned-updates-after',
  'runtime-env-before',
  'runtime-env-after',
  'runtime-env-package',
  'native-catalog-before',
  'native-catalog-unit-before',
  'native-catalog-after',
  'native-catalog-focused',
  'native-catalog-existing',
  'native-catalog-package',
  'mount-namespace-before',
  'mount-namespace-after',
  'mount-namespace-unit',
  'mount-namespace-focused',
  'packaged-mount-unit',
  'image-selection-before',
  'image-selection-after',
  'effective-audit-before',
  'effective-audit-after',
  'effective-audit-focused',
  'managed-audit-before',
  'managed-audit-after',
  'managed-audit-focused',
  'managed-audit-native',
  'managed-dynamic-before',
  'host-client-before',
  'host-client-after',
  'host-client-native',
  'cloud-before',
  'cloud-synced-before',
  'cloud-managed-before',
  'cloud-final',
  'cloud-all-focused',
  'deploy-admission-before',
  'deploy-admission-final',
]) {
  const output = await readFile(`/tmp/issue-3785-${name}.log`, 'utf8');
  await writeFile(`${dest}/${name}.log`, output.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu, '<synthetic-test-module>').replace(/[ \t]+$/gm, ''));
}
await writeFile(`${dest}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Sanitized context and incident logs; compressed artifacts and probes retained.');
