// Issue #3282: reproduce src/claude.lib.mjs:399/401 — the system prompt is
// pre-escaped with \" and interpolated inside "..." into command-stream's $,
// which shell-quotes it again. A fake `claude` prints the argv it receives.
import { $ } from 'command-stream';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
const fake = join(dir, 'claude');
writeFileSync(fake, `#!/usr/bin/env node\nconst a = process.argv.slice(2); const i = a.indexOf('--append-system-prompt'); process.stdout.write(JSON.stringify(a[i + 1]));\n`);
chmodSync(fake, 0o755);
const systemPrompt = process.argv[2] ?? `Use the 'file' command. Retry: curl -H "Authorization: token $(echo LEAKED-TOKEN)" "<url>". Saved as \`.png\`. Path C:\\tmp.\nSecond line.`;
const simpleEscapedSystem = systemPrompt.replace(/"/g, '\\"');
const r = await $({ mirror: false, stdin: 'x' })`${fake} --output-format stream-json --append-system-prompt "${simpleEscapedSystem}"`;
const got = JSON.parse(r.stdout || 'null');
console.log('sent    :', JSON.stringify(systemPrompt));
console.log('received:', JSON.stringify(got));
console.log('identical:', got === systemPrompt, '| stderr:', JSON.stringify(r.stderr));
