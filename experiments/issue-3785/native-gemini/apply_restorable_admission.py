#!/usr/bin/env python3
"""Order actual terminal checkpoints before approval, edits and dispatch."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'chunk-DKZARV6U.js': '901d8eb78bafdb235420b6aa931afdadab3efc5574d53a49224739730fa0ecc4',
    'interactiveCli-AVD3AKNJ.js': '2608741b046c305148c90bfc318d0730940110da050f53ef844a122a74fa94e7',
    'hive-gemini-restorable-history.mjs': 'b9fda6d67fb6d52dab8dfc09dceeb26285e38808b8a31b9945e1e65dab076b24',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini restorable admission prerequisites.')
helper = bundle / 'hive-gemini-restorable-admission.mjs'
if helper.exists() or helper.is_symlink():
    raise SystemExit('Refusing an existing native Gemini restorable admission helper.')
manager = 'chunk-DKZARV6U.js'
tui = 'interactiveCli-AVD3AKNJ.js'
sources = {name: (bundle / name).read_text() for name in (manager, tui)}


def replace(name, before, after):
    if sources[name].count(before) != 1:
        raise SystemExit('Ambiguous native restorable admission context; no files changed: ' + name)
    sources[name] = sources[name].replace(before, after)


replace(manager, '''      readNativeGeminiRestorableHistory(this.storage, getToolCallDataSchema());''', '''      registerNativeGeminiRestorableAdmission(this.storage, getToolCallDataSchema());''')
replace(manager, '''    state.updateStatus(callId, CoreToolCallStatus.AwaitingApproval, {''', '''    await prepareNativeGeminiRestorableEdit(deps.config, currentCall.request);
    state.updateStatus(callId, CoreToolCallStatus.AwaitingApproval, {''')
replace(manager, '''      try {
        const setExecutionIdCallback = (executionId) => {''', '''      try {
        await prepareNativeGeminiRestorableEdit(this.config, request);
        const setExecutionIdCallback = (executionId) => {''')
replace(manager, '''    assertNativeGeminiAuthority({ authType: "oauth-personal", customHeaders: this.httpOptions?.headers }, this.config);
    const endpoint''', '''    assertNativeGeminiRestorableAdmission(this.config);
    assertNativeGeminiAuthority({ authType: "oauth-personal", customHeaders: this.httpOptions?.headers }, this.config);
    const endpoint''')
# The selected writer must never substitute an older Git head for a failed
# pre-edit snapshot. Preserve the native fallback when no selector is active.
replace(manager, '''        errors.push(`Failed to create new snapshot for ${toolCall.name}: ${getErrorMessage(error40)}. Attempting to use current commit.`);''', '''        if (nativeGeminiHistorySelected()) throw error40;
        errors.push(`Failed to create new snapshot for ${toolCall.name}: ${getErrorMessage(error40)}. Attempting to use current commit.`);''')
replace(tui, '''  }, [config]);
  (0, import_react99.useEffect)(() => {
    const handleRetryAttempt''', '''  }, [config]);
  registerNativeGeminiRestorableWriter(config, async (request) => {
    if (!gitService) throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
    const result = await processRestorableToolCalls([request], gitService, geminiClient, history);
    if (result.errors.length || result.checkpointsToWrite.size !== 1) {
      throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
    }
  });
  (0, import_react99.useEffect)(() => {
    const handleRetryAttempt''')
replace(tui, '''    const saveRestorableToolCalls = async () => {
      if (!config.getCheckpointingEnabled()) {''', '''    const saveRestorableToolCalls = async () => {
      if (nativeGeminiHistorySelected() || !config.getCheckpointingEnabled()) {''')
sources[manager] = 'import { registerNativeGeminiRestorableAdmission, assertNativeGeminiRestorableAdmission, prepareNativeGeminiRestorableEdit } from "./hive-gemini-restorable-admission.mjs";\n' + sources[manager]
sources[tui] = 'import { registerNativeGeminiRestorableWriter } from "./hive-gemini-restorable-admission.mjs";\n' + sources[tui]
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini restorable admission applies; no files changed.')
else:
    for name, source in sources.items():
        target = bundle / name
        if target.is_symlink():
            target.unlink()
        target.write_text(source)
    helper.write_bytes((here / 'restorable_admission.mjs').read_bytes())
    print('Applied disposable native Gemini restorable admission; production is unchanged.')
for name, source in sources.items():
    print(hashlib.sha256(source.encode()).hexdigest(), name)
print(hashlib.sha256((here / 'restorable_admission.mjs').read_bytes()).hexdigest(), helper.name)
