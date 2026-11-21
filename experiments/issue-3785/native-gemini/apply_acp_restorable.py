#!/usr/bin/env python3
"""Await canonical checkpoints in the actual native ACP tool execution path."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'gemini-GLQ4MVLB.js': 'c2fbe9a3dd514a3fc7c200fb5a9cf10629903e15f3a5bb3d1b7d2a3d47e0d22e',
    'chunk-DKZARV6U.js': 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
    'hive-gemini-restorable-admission.mjs': '49ebf3f3d44104430c8f854083bfd73966292646fa52b4c3f822c17db97440d8',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini ACP checkpoint prerequisites.')
target = bundle / 'gemini-GLQ4MVLB.js'
source = target.read_text()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native ACP checkpoint context; no files changed.')
    source = source.replace(before, after)


replace('''    this.settings = settings;
    coreEvents.on(''', '''    this.settings = settings;
    registerNativeGeminiRestorableWriter(this.context.config, async (request) => {
      const git = await this.context.config.getGitService();
      if (!git) throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
      const result = await processRestorableToolCalls([request], git, this.context.geminiClient, []);
      if (result.errors.length || result.checkpointsToWrite.size !== 1) {
        throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
      }
    });
    coreEvents.on(''')
replace('''      const confirmationDetails = await invocation.shouldConfirmExecute(abortSignal);
      if (confirmationDetails) {''', '''      await prepareNativeGeminiRestorableEdit(this.context.config, {
        callId, name: fc.name, args, isClientInitiated: false, prompt_id: promptId
      });
      const confirmationDetails = await invocation.shouldConfirmExecute(abortSignal);
      if (confirmationDetails) {''')
replace('''      const toolResult = await invocation.execute({
        abortSignal
      });''', '''      assertNativeGeminiRestorableAdmission(this.context.config);
      const toolResult = await invocation.execute({
        abortSignal
      });''')
source = '''import { processRestorableToolCalls } from "./chunk-DKZARV6U.js";
import { registerNativeGeminiRestorableWriter, prepareNativeGeminiRestorableEdit, assertNativeGeminiRestorableAdmission } from "./hive-gemini-restorable-admission.mjs";
''' + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini ACP checkpoint writer applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini ACP checkpoints; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
