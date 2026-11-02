#!/usr/bin/env python3
"""List native ACP checkpoints using their validated canonical name and tool."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'gemini-GLQ4MVLB.js': 'cfcdeef45cd442e4b082749596577aad251b8c3d4d73b2c06b92407f4d2a1d05',
    'chunk-DKZARV6U.js': 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
    'hive-gemini-restorable-history.mjs': 'b9fda6d67fb6d52dab8dfc09dceeb26285e38808b8a31b9945e1e65dab076b24',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini ACP listing prerequisites.')
target = bundle / 'gemini-GLQ4MVLB.js'
source = target.read_text()
before = '''      const formatted = checkpointInfoList.map((info) => {
        const i = info;'''
after = '''      const formatted = checkpointInfoList.map((info) => {
        if (canonical !== undefined) {
          const checkpoint = canonical.get(`${info.checkpoint}.json`);
          return `- **${info.checkpoint}**: ${checkpoint.data.toolCall.name}`;
        }
        const i = info;'''
if source.count(before) != 1:
    raise SystemExit('Ambiguous native ACP checkpoint listing context; no files changed.')
source = source.replace(before, after)
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini ACP checkpoint listing applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini ACP checkpoint listing; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
