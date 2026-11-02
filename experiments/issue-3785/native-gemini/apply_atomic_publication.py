#!/usr/bin/env python3
"""Publish complete recovery proofs atomically in the disposable Gemini adapter."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
bundle = package / 'bundle'
pins = {'chunk-DKZARV6U.js': '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733',
        'hive-gemini-history.mjs': 'd522f9e84bffe3d7c9323596f3aa8914bd2ce74e73ff2be3233e6aff6b8729da',
        'hive-gemini-publication.mjs': 'a237a583835cb529ff101387a6ddb9b52116089e52eb4568ca7c91d353865dc3'}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native atomic-publication prerequisites.')
target = bundle / 'hive-gemini-publication.mjs'
source = target.read_text()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native atomic-publication context; no files changed.')
    source = source.replace(before, after)


replace('''function readJournal(file, refuse) {
  const before = information(file);
  if (!owned(before) || before.nlink !== 1n || before.size > 4096n) throw refuse();''', '''function readJournal(file, refuse, proofStage) {
  const before = information(file);
  const staged = information(proofStage, true);
  if (!owned(before) || before.size > 4096n || (before.nlink === 2n ? staged === null || version(staged) !== version(before) : before.nlink !== 1n || staged !== null)) throw refuse();''')
replace("return { record: JSON.parse(bytes.subarray(0, length).toString('utf8')), generation: version(before) };", "return { record: JSON.parse(bytes.subarray(0, length).toString('utf8')), generation: version(before), bytes: bytes.subarray(0, length), proofPending: staged !== null };")
replace('''    const { record, generation } = readJournal(journal, refuse);''', '''    const proofStage = `${parent.anchor}/.history-${journalName.exec(name)[1]}.journal.tmp`;
    let { record, generation, bytes, proofPending } = readJournal(journal, refuse, proofStage);''')
replace('''    let published = dataFile(target, record, refuse, true);
    if (staged !== null) {''', '''    let published = dataFile(target, record, refuse, true);
    if (staged === null ? published === null || published.nlink !== 1n : published === null ? staged.nlink !== 1n : staged.nlink !== 2n || published.nlink !== 2n || version(staged) !== version(published)) throw refuse();
    if (proofPending) {
      check();
      if (version(information(proofStage)) !== generation) throw refuse();
      fs.unlinkSync(proofStage);
      fs.fsyncSync(parent.fd);
      const completed = readJournal(journal, refuse, proofStage);
      if (!completed.bytes.equals(bytes) || completed.proofPending || completed.generation.split(':', 2).join(':') !== generation.split(':', 2).join(':')) throw refuse();
      generation = completed.generation;
    }
    if (staged !== null) {''')
replace('''  const journal = `${parent.anchor}/.publish-${match[1]}.json`;
  let fd;''', '''  const journal = `${parent.anchor}/.publish-${match[1]}.json`;
  const proofStage = `${parent.anchor}/.history-${match[1]}.journal.tmp`;
  let fd;''')
replace('''    fd = fs.openSync(journal, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, JSON.stringify(record));
    const generation''', '''    fd = fs.openSync(proofStage, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, JSON.stringify(record));
    const prepared = fs.fstatSync(fd, { bigint: true });
    fs.fsyncSync(fd);
    current();
    if (!owned(prepared) || prepared.nlink !== 1n || version(fs.fstatSync(fd, { bigint: true })) !== version(prepared) || version(information(proofStage)) !== version(prepared)) throw refuse();
    fs.linkSync(proofStage, journal);
    fs.fsyncSync(parent.fd);
    const linked = fs.fstatSync(fd, { bigint: true });
    current();
    if (!owned(linked) || linked.nlink !== 2n || version(information(journal)) !== version(linked) || version(information(proofStage)) !== version(linked)) throw refuse();
    if (!readJournal(journal, refuse, proofStage).bytes.equals(Buffer.from(JSON.stringify(record)))) throw refuse();
    fs.unlinkSync(proofStage);
    fs.fsyncSync(parent.fd);
    const generation''')
replace('''    const generation = version(fs.fstatSync(fd, { bigint: true }));''', '''    const completed = readJournal(journal, refuse, proofStage);
    if (!completed.bytes.equals(Buffer.from(JSON.stringify(record))) || completed.proofPending || completed.generation.split(':', 2).join(':') !== `${prepared.dev}:${prepared.ino}`) throw refuse();
    const generation = completed.generation;''')
if '--check' in sys.argv[2:]:
    print('Pinned atomic native publication proof stage applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable atomic native publication proofs; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
