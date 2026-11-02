#!/usr/bin/env python3
"""Keep native ACP context and user turns separate in restorable checkpoints."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'gemini-GLQ4MVLB.js': '923feb573a468e178c4902079055fed721e5cd48eef1937c06169de3b8997886',
    'chunk-DKZARV6U.js': 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini ACP durable-history prerequisites.')
target = bundle / 'gemini-GLQ4MVLB.js'
source = target.read_text()
before = 'const result = await processRestorableToolCalls([request], git, this.context.geminiClient, []);'
after = '''// getHistory() coalesces the session context with the first user turn.
      // The native session loader excludes a turn beginning with that context.
      // Preserve the actual turn boundaries before native checkpoint encoding.
      const client = { getHistory: () => this.chat.agentHistory.get().map((turn) => turn.content) };
      const result = await processRestorableToolCalls([request], git, client, []);'''
if source.count(before) != 1:
    raise SystemExit('Ambiguous native ACP turn-boundary context; no files changed.')
source = source.replace(before, after)
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini ACP durable-history checkpoint applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini ACP turn preservation; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
