// Fuzz: x -> sanitizeOutput(x) (as sanitizeForPublication does) -> residual
// scanners. Reports inputs where the residual scan fires on already-sanitized
// output, i.e. sanitizeForPublication would throw CredentialSanitizationError.
// Usage: node issue-2397-fuzz-idempotency.mjs [iterations] [seed] [coreOnly]
import tsl from '../src/token-sanitization.lib.mjs';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
const { sanitizeOutput, detectSecretsWithSecretlint } = tsl;

const N = Number(process.argv[2] || 3000);
let seed = Number(process.argv[3] || 1);
const coreOnly = process.argv[4] === 'core';
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
const rs = (n, alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => Array.from({ length: n }, () => pick(alpha)).join('');
const hex = n => rs(n, '0123456789abcdef');

const values = [() => 'ghp_' + rs(36), () => 'github_pat_' + rs(60, 'ABCDEFabcdef0123456789_'), () => 'sk-proj-' + rs(48), () => 'sk-ant-api03-' + rs(80), () => 'AKIA' + rs(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0234567'), () => 'AIza' + rs(35), () => 'xoxb-' + rs(10, '0123456789') + '-' + rs(24), () => rs(10, '0123456789') + ':AA' + rs(33), () => 'eyJhbGciOiJIUzI1NiJ9.eyJ' + rs(30) + '.' + rs(43), () => hex(40), () => hex(64), () => hex(32), () => rs(8), () => rs(20), () => rs(40), () => 'npm_' + rs(36), () => 'hf_' + rs(34), () => 'sk_live_' + rs(24), () => 'abc…xyz', () => '[REDACTED]', () => 'ghp…' + rs(3), () => rs(3) + '…' + rs(3) + rs(1, ')]}>.,:;/"\'\\'), () => 'TEST_API_TOKEN_' + rs(6, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), () => 'postgres://user:' + rs(16) + '@db:5432/x', () => rs(12) + rs(1, '/+=._-') + rs(12), () => 'Bearer ' + rs(30), () => '$' + '{TOKEN}', () => 'process.env.TELEGRAM_BOT_TOKEN', () => rs(20) + '\\n' + rs(20), () => 'true', () => '', () => '…'];
const keys = ['token', 'TOKEN', 'api_key', 'apiKey', 'password', 'secret', 'client_secret', 'auth', 'Authorization', 'access_token', 'botToken', 'TELEGRAM_BOT_TOKEN', 'session', 'cookie', 'x', 'url', 'hash'];
const seps = process.env.NO_ARROW ? ['=', ': ', ':', ' = ', ' '] : ['=', ': ', ':', ' = ', '=>', ' '];
const quotes = ['', '"', '\\"', '\\\\\\"', "'"];
const frag = () => {
  const r = rnd();
  const v = pick(values)();
  if (r < 0.45) {
    const q = pick(quotes);
    return `${q}${pick(keys)}${q}${pick(seps)}${q}${v}${q}`;
  }
  if (r < 0.55) return `--${pick(keys)} ${v}`;
  if (r < 0.62) return `https://h.example/p?${pick(keys)}=${v}&x=1`;
  if (r < 0.7) return `Authorization: Bearer ${v}`;
  if (r < 0.8) return v;
  if (r < 0.88) return Buffer.from(`${pick(keys)}=${v}`).toString(pick(['base64', 'base64url', 'hex']));
  return encodeURIComponent(`${pick(keys)}=${v}`);
};
const wrap = s => {
  const r = rnd();
  if (r < 0.25) return JSON.stringify({ type: 'item.completed', item: { aggregated_output: s } });
  if (r < 0.35) return JSON.stringify(JSON.stringify({ text: s }));
  return s;
};
const gen = () => {
  const n = 1 + Math.floor(rnd() * 5);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(frag());
  return wrap(parts.join(pick([' ', '\n', ', ', '', '\\n', ' | ', '/', '.'])));
};

const opts = { warnOnMismatch: false, skipOutputSanitization: false, skipActiveTokensOutputSanitization: false, excludeTokens: [] };
const residual = async s => {
  const core = sanitizeCredentialText(s) !== s;
  const sl = coreOnly ? [] : await detectSecretsWithSecretlint(s, { required: true });
  return { core, secretlint: sl.map(x => x.ruleId) };
};
const fails = new Map();
for (let i = 0; i < N; i++) {
  const x = gen();
  const s1 = coreOnly ? sanitizeCredentialText(x) : await sanitizeOutput(x, opts);
  const r = await residual(s1);
  if (r.core || r.secretlint.length) {
    const key = (r.core ? 'core' : '') + '|' + r.secretlint.join(',');
    if (!fails.has(key)) fails.set(key, []);
    const arr = fails.get(key);
    if (arr.length < 4) arr.push({ input: x, sanitized: s1, again: r.core ? sanitizeCredentialText(s1) : undefined });
  }
}
for (const [k, v] of fails) {
  console.log('=== class', k, 'examples', v.length);
  for (const e of v) console.log(JSON.stringify(e));
}
console.log('classes', fails.size);
process.exit(0);
