// Issue #2094 — feed the scoped config that `setTomlTableBoolean` produces to a
// real Codex CLI.
//
// `toml-editor-cases.mjs` proves the output is valid TOML. This proves the
// stricter claim that matters in production: Codex itself accepts the rewritten
// document. Before the rewrite, the shapes below produced a duplicate `features`
// key and Codex answered `failed to load configuration`, which would have broken
// every Codex invocation for the repository rather than only the plugin.
//
// Requirements: a Codex CLI on PATH (or CODEX_BIN). No account, no network.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

import { setTomlTableBoolean } from '../../src/codex-capability-preflight.lib.mjs';

const OPERATOR_CONFIGS = [
  ['dotted key (the spelling Codex’s own CLI documents)', 'features.remote_plugin = true\nmodel = "gpt-5"\n'],
  ['inline table', 'features = { remote_plugin = true }\n'],
  ['inline table without the key', 'features = { web_search = true }\n'],
  ['header with a tight comment', '[features]# toggles\nremote_plugin = true\n'],
  ['non-boolean existing value', '[features]\nremote_plugin = 1\n'],
  ['value with an attached comment', '[features]\nremote_plugin = true # note\n'],
  ['the shape Hive writes beside a plugin block', '[features]\nmulti_agent = true\n\n[plugins."superpowers@openai-curated"]\nenabled = true\n'],
];

const codexBin = process.env.CODEX_BIN || 'codex';
const probeHome = mkdtempSync(path.join(os.tmpdir(), 'issue-2094-toml-cli-'));
let rejected = 0;

for (const [label, config] of OPERATOR_CONFIGS) {
  const output = setTomlTableBoolean({ config, table: 'features', key: 'remote_plugin', value: false });
  writeFileSync(path.join(probeHome, 'config.toml'), output);
  try {
    execFileSync(codexBin, ['debug', 'prompt-input', 'issue-2094 toml editor probe'], {
      env: { ...process.env, CODEX_HOME: probeHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`ok     ${label}\n       ${JSON.stringify(output)}`);
  } catch (error) {
    rejected++;
    console.log(`REJECT ${label}\n       ${JSON.stringify(output)}\n       ${String(error.stderr).trim().split('\n')[0]}`);
  }
}

console.log(`\n${rejected} of ${OPERATOR_CONFIGS.length} rewritten configs rejected by ${codexBin}`);
process.exitCode = rejected === 0 ? 0 : 1;
