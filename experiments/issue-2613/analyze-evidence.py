"""Review downloaded logs in bounded 1500-line chunks and retain findings."""
import hashlib
import json
import re
from pathlib import Path

root = Path('docs/case-studies/issue-2613/evidence')
patterns = re.compile(r'File not found:|Let me open e\.g|Resource not accessible|Required input|No files were found|not found in repository labels|still running|exit code 137|OOMKilled|cgroup.*OOM|Out of memory|SIGKILL|npm test|test-version-info|gh api user|log not found', re.I)
manifest = []
findings = []
for file in sorted(root.glob('*.log')):
    count = 0
    chunks = 0
    hits = []
    digest = hashlib.sha256()
    with file.open('rb') as source:
        while True:
            block = []
            read = 0
            for _ in range(1500):
                line = source.readline()
                if not line:
                    break
                digest.update(line)
                count += 1
                read += 1
                text = line.decode('utf-8', errors='replace').rstrip()
                if patterns.search(text):
                    block.append({'line': count, 'text': text[:1500]})
            if read == 0:
                break
            chunks += 1
            hits.extend(block)
            if read < 1500:
                break
    manifest.append({'file': file.name, 'bytes': file.stat().st_size, 'lines': count, 'chunksReviewed': chunks, 'sha256': digest.hexdigest(), 'matchingLines': len(hits)})
    findings.append({'file': file.name, 'findings': hits})
(root / 'log-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(root / 'log-findings.json').write_text(json.dumps(findings, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
