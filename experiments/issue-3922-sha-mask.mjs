#!/usr/bin/env node
// Issue #3922: does log sanitization mask a commit SHA printed on its own line?
// Usage: node experiments/issue-3922-sha-mask.mjs
import { sanitizeLogContent } from '../src/token-sanitization.lib.mjs';
const sha = '7819203e20e6098845848bfe15724ead6ac6f75a';
const samples = {
  bareStdoutLine: `[2026-10-31T17:52:31.110Z] [STDOUT] ${sha}\n`,
  commitUrl: `/merge: PR #414 HEAD https://github.com/G-Ivan-A/mango_ba_prompts/commit/${sha} has no check-runs\n`,
  both: `[2026-10-31T17:52:31.110Z] [STDOUT] ${sha}\n/merge: PR #414 HEAD https://github.com/G-Ivan-A/mango_ba_prompts/commit/${sha} has no check-runs\n`,
  revParseInToolResult: `"content": "origin\\thttps://github.com/x/y.git (fetch)\\n${sha}\\n## issue-413...origin/issue-413"\n`,
  headRefOidJson: `{"headRefOid":"${sha}","mergeStateStatus":"CLEAN","mergeable":"MERGEABLE"}\n`,
};
for (const [name, text] of Object.entries(samples)) {
  const out = await sanitizeLogContent(text);
  console.log(name.padEnd(22), out.includes(sha) ? 'kept  ' : 'MASKED', JSON.stringify(out).slice(0, 220));
}
