"""Inspect the preserved incident in bounded 1500-line chunks; retain source lines."""
import collections
import gzip
import hashlib
import itertools
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
data = root / 'docs/case-studies/issue-2745/data'
source = data / 'incident.log.gz'
counts = collections.Counter()
chunks = []
evidence = []
digest = hashlib.sha256()
with gzip.open(source, 'rb') as stream:
    start = 1
    while lines := list(itertools.islice(stream, 1500)):
        selected = []
        for offset, raw_line in enumerate(lines):
            number = start + offset
            digest.update(raw_line)
            line = raw_line.decode('utf-8')
            if '[STDOUT] {' in line:
                payload = line.split('[STDOUT] ', 1)[1]
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                kind = event.get('type')
                if kind:
                    counts[kind] += 1
                if kind in ('thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'error'):
                    selected.append({'line': number, 'text': line.strip()})
                item = event.get('item') or {}
                command = item.get('command', '')
                output = item.get('aggregated_output', '')
                if item.get('type') == 'command_execution' and any(marker in command + output for marker in ('CARGO_BUILD_JOBS', 'memory.events', '3130822656', 'signal: 9')):
                    header = line.split('[STDOUT]', 1)[0].strip()
                    summary = f"{header} {kind}: {command[:800]} (exit={item.get('exit_code')})"
                    signals = re.findall(r'signal: 9[^\n]*|3130822656|oom_kill\s+\d+', output)
                    selected.append({'line': number, 'text': summary, 'signals': signals})
            if '[STDERR]' not in line and '[STDOUT]' not in line and len(line) < 1800:
                if any(marker in line for marker in ('[RESOURCES]', '❌ Codex', '[ERROR]', '[WARNING]', 'Session ID', 'Starting', 'Resuming', 'Reasoning effort', 'CODEX execution failed')):
                    selected.append({'line': number, 'text': line.strip()})
        chunks.append({'start': start, 'end': start + len(lines) - 1, 'selected': selected})
        evidence.extend(selected)
        start += len(lines)

result = {'lines': start - 1, 'sha256': digest.hexdigest(), 'protocolCounts': dict(counts), 'chunks': chunks}
(data / 'incident-analysis.json').write_text(json.dumps(result, indent=2) + '\n')
for entry in evidence:
    print(f"{entry['line']}: {entry['text']}" + (f" Signals: {entry['signals']}" if entry.get('signals') else ''))
