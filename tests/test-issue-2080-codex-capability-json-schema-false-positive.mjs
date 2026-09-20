/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2080. JSON Schema and other structured-data
 * tokens must not be inferred as Codex skills merely because the surrounding
 * prose contains a requirement word.
 */

import assert from 'node:assert/strict';

import { detectRequiredCodexCapabilities } from '../src/codex-capability-preflight.lib.mjs';

const originalIssueExcerpt = `
The server must emit only the key(s) the advertised tool declares.
advertise Read (required ["file_path"], additionalProperties:false) -> {"filePath":"1.txt"}
The required response schema is {"type":"object","properties":{},"additionalProperties":false}.
`;

const structuredData = detectRequiredCodexCapabilities(originalIssueExcerpt);
assert.deepEqual(structuredData.plugins, [], 'JSON Schema examples do not request plugins');
assert.deepEqual(structuredData.skills, [], 'additionalProperties:false and type:object are not Agent Skills');
assert(
  structuredData.rejected.some(entry => entry.capability === 'additionalproperties:false'),
  'verbose diagnostics preserve the rejected false positive and its source line'
);

for (const line of ['The required YAML is enabled:true and mode:strict.', 'Use JSON with success:false, value:null, and type:string.', 'Use success:false for the required fixture.', 'Install react@latest before running the required frontend tests.', 'The mandatory header is content-type:application/json.']) {
  const result = detectRequiredCodexCapabilities(line);
  assert.deepEqual({ plugins: result.plugins, skills: result.skills }, { plugins: [], skills: [] }, `structured data and package selectors are not capabilities: ${line}`);
}

const genuine = detectRequiredCodexCapabilities(`
This task requires superpowers:using-superpowers before implementation.
The superpowers:test-driven-development Agent Skill is mandatory.
Install the plugin superpowers@openai-curated-remote if it is absent.
Use browser@openai-bundled when the bundled browser plugin is required.
Use $imagegen for the requested bitmap.
`);

assert.deepEqual(genuine.plugins, ['browser@openai-bundled', 'superpowers@openai-curated'], 'curated and bundled catalog plugin selectors remain detectable');
assert.deepEqual(genuine.skills, ['imagegen', 'superpowers:test-driven-development', 'superpowers:using-superpowers'], 'explicit Agent Skill references remain detectable');

console.log('✅ issue #2080: structured data is not mistaken for a Codex capability');
