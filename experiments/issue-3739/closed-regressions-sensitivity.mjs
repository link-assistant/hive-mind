/* global process, console */
// Checks that the closed-issue regression cases are sensitive: the opaque
// `gh auth token` value is masked only because it is known, and a JSON.parse
// message would quote the credential.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
process.env.GH_CONFIG_DIR = mkdtempSync(`${tmpdir()}/gh-empty-`);
process.env.PATH = '/nonexistent';
const { sanitizeForPublication } = await import('../../src/token-sanitization.lib.mjs');
const opaque = ['Kq7v', 'Rt2mWx9pLz4n', 'Bc8dFh3jYs6g', 'Tu1eQa5o'].join('');
console.log('unknown opaque masked:', (await sanitizeForPublication(`value seen in output: ${opaque}`)) !== `value seen in output: ${opaque}`);
const gho = ['gho_', 'Ab3Cd5Ef7Gh9Ij1Kl3Mn', '5Op7Qr9St1Uv3Wx5Yz'].join('');
try {
  JSON.parse(`{"claudeAiOauth":{"accessToken":"${gho}"`);
} catch (e) {
  console.log('JSON.parse message quotes token:', e.message.includes(gho), e.message.slice(0, 60));
}
