"""Preserve completed local validation logs with deterministic gzip/checksums."""
import gzip
import hashlib
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[2]
data = root / 'docs/case-studies/issue-2745/data'
destination = data / 'validation'
destination.mkdir(exist_ok=True)
logs = sorted((root / 'ci-logs').glob('2745-*.log'))
logs += [root / 'ci-logs/npm-ci.log', root / 'ci-logs/security-37735943710.log']
for source in logs:
    if not source.exists():
        continue
    with source.open('rb') as original, (destination / (source.name + '.gz')).open('wb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', mtime=0) as archive:
            shutil.copyfileobj(original, archive)
manifest = []
for source in sorted(data.rglob('*')):
    if not source.is_file() or source.name == 'SHA256SUMS':
        continue
    digest = hashlib.sha256()
    with source.open('rb') as stream:
        while block := stream.read(65536):
            digest.update(block)
    manifest.append(f'{digest.hexdigest()}  {source.relative_to(data)}')
(data / 'SHA256SUMS').write_text('\n'.join(manifest) + '\n')
print(f'Archived {len(logs)} log paths; checksummed {len(manifest)} evidence files.')
