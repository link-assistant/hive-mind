"""Extract Claude Code's bundled model catalogue (context + pricing + fast_mode) from `strings` output.

Usage: python3 -I extract-claude-code-catalog.py <strings-dump.txt>
The dump is produced with: strings -n 8 $(readlink -f $(which claude)) > all.txt
"""
import re
import sys

text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
seen = set()
for m in re.finditer(r'\{id:"(claude-[a-z0-9-]+)"', text):
    model_id = m.group(1)
    chunk = text[m.start():m.start() + 3000]
    ctx = re.search(r'context:\{([^}]*)\}', chunk)
    pricing = re.search(r'pricing:"([^"]+)"', chunk)
    caps = re.search(r'capabilities:\[([^\]]*)\]', chunk)
    if not ctx or model_id in seen:
        continue
    seen.add(model_id)
    cap_list = caps.group(1) if caps else ''
    print(f"{model_id}\t{ctx.group(1)}\tpricing={pricing.group(1) if pricing else '?'}\tfast_mode={'fast_mode' in cap_list}")
