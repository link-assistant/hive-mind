#!/usr/bin/env python3
"""Keep terminal context and user turns separate in native restore checkpoints."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'interactiveCli-AVD3AKNJ.js': '5aac5d78adb500c820779bac8deec422a5c30d2436d746e946848c71b95c2c64',
    'chunk-DKZARV6U.js': 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
    'hive-gemini-restorable-history.mjs': 'b9fda6d67fb6d52dab8dfc09dceeb26285e38808b8a31b9945e1e65dab076b24',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini terminal durable-history prerequisites.')
target = bundle / 'interactiveCli-AVD3AKNJ.js'
source = target.read_text()
before = 'const result = await processRestorableToolCalls([request], gitService, geminiClient, history);'
after = '''// Preserve the actual context/user boundaries before native serialization.
    // The native loader filters a whole turn beginning with session context.
    const client = { getHistory: () => geminiClient.getChat().agentHistory.get().map((turn) => turn.content) };
    const result = await processRestorableToolCalls([request], gitService, client, history);'''
if source.count(before) != 1:
    raise SystemExit('Ambiguous native terminal turn-boundary context; no files changed.')
source = source.replace(before, after)
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini terminal durable-history checkpoint applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini terminal turn preservation; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
