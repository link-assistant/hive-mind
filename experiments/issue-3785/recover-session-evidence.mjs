// Re-sanitize the interrupted public execution trace before retaining it locally.
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';
import { sanitizeLogFileToFile, findResidualCredentialBlock } from '../../src/log-sanitize-stream.lib.mjs';

const [sourcePath, destPath] = process.argv.slice(2);
if (!sourcePath || !destPath) throw new Error('Provide source log and temporary sanitized destination.');
const redactIdentity = text =>
  text
    .replace(/([?&](?:token|auth|key|signature)=)[^\s<>"'\\)]+/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[IDENTIFIER]')
    .replace(/("(?:email|full_name|display_name|first_name|last_name|account_id|chatgpt_account_id)"\s*:\s*)"[^"\n]*"/gi, '$1"[IDENTITY]"')
    .replace(/("(?:authorization|cookie|set-cookie)"\s*:\s*)"[^"\n]*"/gi, '$1"[REDACTED]"');
const sanitize = async text => {
  let current = text;
  for (let pass = 0; pass < 4; pass++) {
    const sanitized = await sanitizeForPublication(redactIdentity(current));
    if (sanitized === current) return sanitized;
    current = sanitized;
  }
  throw new Error('Evidence sanitizer did not converge; publication refused.');
};
const stats = await sanitizeLogFileToFile({ sourcePath, destPath, sanitize, chunkBytes: 65536 });
const residual = await findResidualCredentialBlock(destPath, { sanitize, chunkBytes: 65536 });
if (residual) throw new Error('Residual credential content prevents evidence publication.');
const digest = createHash('sha256');
for await (const chunk of createReadStream(destPath)) digest.update(chunk);
const evidence = 'docs/case-studies/issue-3785/evidence';
await pipeline(createReadStream(destPath), createGzip({ level: 9 }), createWriteStream(`${evidence}/interrupted-session.log.gz`));
const manifest = JSON.parse(await readFile(`${evidence}/manifest.json`, 'utf8'));
const record = { file: 'interrupted-session.log.gz', contentSha256: digest.digest('hex'), sourceBytes: stats.sourceSize, sanitizedBytes: (await stat(destPath)).size, redacted: ['credentials', 'download query tokens', 'emails', 'UUIDs', 'account identity fields'], residualCredentialBlock: residual };
await writeFile(`${evidence}/manifest.json`, `${JSON.stringify([...manifest.filter(item => item.file !== record.file), record], null, 2)}\n`);
console.log('Retained sanitized interrupted-session evidence and content digest.');
