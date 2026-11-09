#!/usr/bin/env python3
"""Apply restored canonical history to the actual native ACP chat and recorder."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'gemini-GLQ4MVLB.js': '276e808f2238147acf325619d6f67ab1496a8a06f254b1c3b2a024960eb3324c',
    'chunk-DKZARV6U.js': 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
    'hive-gemini-restorable-history.mjs': 'b9fda6d67fb6d52dab8dfc09dceeb26285e38808b8a31b9945e1e65dab076b24',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini ACP restore prerequisites.')
target = bundle / 'gemini-GLQ4MVLB.js'
source = target.read_text()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native ACP history context; no files changed.')
    source = source.replace(before, after)


replace('''      for await (const result of restoreResultGenerator) {
        restoreResult.push(result);
      }''', '''      for await (const result of restoreResultGenerator) {
        if (nativeGeminiHistorySelected() && result.type === "load_history") {
          if (typeof context.restoreHistory !== "function") {
            throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
          }
          context.restoreHistory(result.clientHistory);
        }
        restoreResult.push(result);
      }''')
replace('''      settings: this.settings,
      git: gitService,
      sendMessage: async (text) => {''', '''      settings: this.settings,
      git: gitService,
      restoreHistory: (history) => this.chat.setHistory(history),
      sendMessage: async (text) => {''')
source = 'import { nativeGeminiHistorySelected } from "./hive-gemini-history.mjs";\n' + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini ACP model-history restore applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini ACP history restore; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
