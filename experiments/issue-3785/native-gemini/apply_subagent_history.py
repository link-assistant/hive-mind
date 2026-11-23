#!/usr/bin/env python3
"""Allocate actual native child conversation directories through checked storage."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'chunk-DKZARV6U.js': 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
    'hive-gemini-history.mjs': '586d39370a4344a1aaa46c81894f2c6239253a91cb84e3871288c2093c328e99',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini child-history prerequisites.')
manager = 'chunk-DKZARV6U.js'
helper = 'hive-gemini-history.mjs'
sources = {name: (bundle / name).read_text() for name in (manager, helper)}
before = '          chatsDir = path29.join(chatsDir, safeParentId);'
after = '          chatsDir = nativeGeminiSubagentChatsDirectory(chatsDir, safeParentId) ?? path29.join(chatsDir, safeParentId);'
if sources[manager].count(before) != 1:
    raise SystemExit('Ambiguous native child directory context; no files changed.')
sources[manager] = 'import { nativeGeminiSubagentChatsDirectory } from "./hive-gemini-history.mjs";\n' + sources[manager].replace(before, after)
sources[helper] += '''

export function nativeGeminiSubagentChatsDirectory(chats, parentId) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    assertNativeGeminiHistoryCurrent();
    if (typeof parentId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/u.test(parentId)) throw refuse();
    const matches = [...conversations.values()].filter(item => item.components.length === 3 && item.components[0] === 'projects' && item.components[2] === 'chats' && (chats === item.anchor || chats === path.join(authority.selected, ...item.components)));
    if (matches.length !== 1 || conversations.size >= 1024) throw refuse();
    const parent = directory([...matches[0].components, parentId]);
    conversations.set(parent.anchor, parent);
    return parent.anchor;
  } catch {
    throw refuse();
  }
}
'''
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini child-history directory repair applies; no files changed.')
else:
    for name, source in sources.items():
        target = bundle / name
        if target.is_symlink():
            target.unlink()
        target.write_text(source)
    print('Applied disposable native Gemini checked child-history directories; production is unchanged.')
for name, source in sources.items():
    print(hashlib.sha256(source.encode()).hexdigest(), name)
