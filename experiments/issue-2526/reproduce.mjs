#!/usr/bin/env node
// Token-free reproduction using the retained CLI catalogue and pure resolver.
import fs from 'node:fs';
import { normalizeCataloguePayload } from '../../src/model-catalogue-fetch.lib.mjs';
import { resolveCodexReasoningEffort } from '../../src/codex.options.lib.mjs';

const payload = JSON.parse(fs.readFileSync(new URL('../../docs/case-studies/issue-2526/data/codex-models.json', import.meta.url), 'utf8'));
const catalogue = { sources: [{ id: 'codex-cli', status: 'ok', models: normalizeCataloguePayload({ shape: 'codex-cli', payload }) }] };
for (const model of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.5', 'future-without-metadata']) {
  for (const think of ['off', 'minimal', 'max', 'ultra']) {
    const result = resolveCodexReasoningEffort({ model, think }, { catalogue });
    console.log(JSON.stringify({ model, think, ...result }));
  }
}
