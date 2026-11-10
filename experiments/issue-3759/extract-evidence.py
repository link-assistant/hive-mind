"""Create a bounded replay fixture and timeline index from the preserved log."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
data = root / 'docs/case-studies/issue-3759/data'
rows = []
fixture = []
record = False
with (data / 'failure.log').open(newline='\n') as source:
    for number, raw in enumerate(source, 1):
        match = re.match(r'^\[([^]]+)\] \[(\w+)\] (.*)', raw.rstrip('\n'))
        if not match:
            continue
        timestamp, level, payload = match.groups()
        if re.match(r'^(?:[A-Za-z0-9+/=]{120,})?\[log_51b53c(?:,|\])', payload) or (record and level == 'STDOUT'):
            # Preserve the SDK summary attached to the dump, but bound its opaque prefix.
            if re.match(r'^[A-Za-z0-9+/=]{120,}', payload):
                marker = payload.find('[log_')
                payload = payload[:160] + (payload[marker:] if marker >= 0 else '')
            fixture.append(payload)
            record = payload.endswith('{') or (record and payload != '}')
            rows.append({'line': number, 'timestamp': timestamp, 'text': payload})
        elif any(needle in payload for needle in ('Starting work session', 'Session ID:', 'Uncommitted changes preserved as', 'Preserved work pushed', 'command failed with exit code', 'Usage-limit cross-check')):
            rows.append({'line': number, 'timestamp': timestamp, 'text': payload[:400]})
(data / 'replay.json').write_text(json.dumps(fixture, indent=2) + '\n')
(data / 'timeline-index.json').write_text(json.dumps(rows, indent=2) + '\n')
print(f'Extracted {len(fixture)} replay lines and {len(rows)} timeline entries')
