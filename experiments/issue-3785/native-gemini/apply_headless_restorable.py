#!/usr/bin/env python3
"""Register the native checkpoint writer for actual noninteractive CLI edits."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'gemini-GLQ4MVLB.js': 'ca5c9f85fa66d0a71acba63e3bac8faaae42167cacc719e99d590cda2d684654',
    'chunk-DKZARV6U.js': 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
    'hive-gemini-restorable-admission.mjs': '49ebf3f3d44104430c8f854083bfd73966292646fa52b4c3f822c17db97440d8',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini headless checkpoint prerequisites.')
target = bundle / 'gemini-GLQ4MVLB.js'
source = target.read_text()
before = '''      const geminiClient = config.getGeminiClient();
      scheduler = new Scheduler({'''
after = '''      const geminiClient = config.getGeminiClient();
      registerNativeGeminiRestorableWriter(config, async (request) => {
        const git = await config.getGitService();
        if (!git) throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
        const client = { getHistory: () => geminiClient.getChat().agentHistory.get().map((turn) => turn.content) };
        const result = await processRestorableToolCalls([request], git, client, []);
        if (result.errors.length || result.checkpointsToWrite.size !== 1) {
          throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
        }
      });
      scheduler = new Scheduler({'''
# The pinned CLI contains the agent-session and legacy noninteractive schedulers.
# Both require a writer; a changed count refuses before touching either path.
if source.count(before) != 2:
    raise SystemExit('Ambiguous native headless checkpoint context; no files changed.')
source = source.replace(before, after)
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini headless checkpoint writer applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini headless checkpoints; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
