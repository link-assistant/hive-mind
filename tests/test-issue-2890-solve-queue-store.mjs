#!/usr/bin/env node
/**
 * Issue #2890: triple storage (link-cli store archive, `.lino` projection,
 * link-cli database) for durable solve-queue state.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { documentToStore, storeToDocument, encodeStoreArchive, decodeStoreArchive, documentToArchive, archiveToDocument, documentToLino, linoToDocument, documentRevision, createLinksTripleStore, findClink, writeFileAtomicSync } from '../src/solve-queue-store.lib.mjs';

const hex = bytes =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hm-2890-store-'));
const L = (id, ...values) => ({ id, values });
const P = (...values) => ({ id: null, values });

const tricky = ['plain', "it's", 'say "hi"', `mix ' and "`, 'a`b', 'with space', 'paren (x)', 'colon: y', 'line1\nline2', '', '((', 'é ünïcode 🚀', '#', '123', ' lead', 'trail ', '\\', '--model'];
const sampleDoc = (revision = 7) => [P('solve-queue', P('version', '1'), P('revision', String(revision)), P('lastStartTimeByTool', P('codex', '2026-10-09T10:00:00.000Z'))), L('solve-1791492539982-n8kgdbr', P('tool', 'codex'), P('status', 'queued'), P('url', 'https://github.com/link-foundation/browser-commander'), P('args', 'https://github.com/link-foundation/browser-commander', '--model', 'gpt-5.5')), L('solve-tricky', P('args', ...tricky)), L('solve-dup', P('tool', 'codex'), P('status', 'queued'))];

console.log('\n=== Store archive golden vector (binary links notation §10) ===');
{
  // (a: a a), hole at 2, (é: é é) at 3, (ab: a é) at 4.
  const golden = '12 02 20 01 24 01 02 01 01 03 03 01 03 13 02 21 02 30 01 ff ff 9f ff fd ff 17 ff fc 9f 9e';
  const store = {
    links: [
      [1, 1, 1],
      [3, 3, 3],
      [4, 1, 3],
    ],
    names: [
      [1, 'a'],
      [3, 'é'],
      [4, 'ab'],
    ],
  };
  assert(hex(await encodeStoreArchive(store)) === golden, 'encodes the golden store archive byte for byte');
  const decoded = await decodeStoreArchive(Uint8Array.from(golden.split(' ').map(b => parseInt(b, 16))));
  assert(JSON.stringify(decoded) === JSON.stringify(store), 'decodes the golden store archive');
  assert(hex(await encodeStoreArchive({ links: [], names: [] })) === '10 00 11 00', 'empty store is 10 00 11 00');
}

console.log('\n=== Tree <-> doublets <-> archive round trip ===');
{
  const doc = sampleDoc();
  const store = documentToStore(doc);
  assert(
    store.links.slice(0, 4).every(([a, s, t]) => a === s && s === t),
    'addresses 1..4 are reserved points'
  );
  assert(new Set(store.names.map(([, n]) => n)).size === store.names.length, 'each leaf string is stored once (content-addressed)');
  assert(JSON.stringify(storeToDocument(store)) === JSON.stringify(doc), 'doublets decode back to the same tree');
  const archive = await documentToArchive(doc);
  assert(JSON.stringify(await archiveToDocument(archive)) === JSON.stringify(doc), 'archive decodes back to the same tree');
  assert(hex(await documentToArchive(doc)) === hex(archive), 'encoding is deterministic');
  assert(documentRevision(doc) === 7, 'revision is read from the header link');
}

console.log('\n=== Tree <-> Links Notation round trip ===');
{
  const doc = sampleDoc();
  const text = await documentToLino(doc);
  assert(text.includes('(solve-1791492539982-n8kgdbr: (tool codex)'), '.lino is human-readable');
  assert(JSON.stringify(await linoToDocument(text)) === JSON.stringify(doc), '.lino parses back to the same tree (quotes, newlines, unicode, empty strings)');
  let threw = false;
  try {
    await documentToLino([P('x', P())]);
  } catch {
    threw = true;
  }
  assert(threw, 'empty links are rejected (no lossless Links Notation spelling)');
}

console.log('\n=== Corrupt archives are rejected ===');
{
  const archive = await documentToArchive(sampleDoc());
  for (const [name, bytes] of [
    ['truncated', archive.slice(0, archive.length - 3)],
    ['trailing bytes', Uint8Array.from([...archive, 0])],
    ['garbage', Uint8Array.from([0xde, 0xad, 0xbe, 0xef])],
  ]) {
    let threw = false;
    try {
      await archiveToDocument(bytes);
    } catch {
      threw = true;
    }
    assert(threw, `rejects a ${name} archive`);
  }
}

console.log('\n=== Atomic writes ===');
{
  const dir = tmpDir();
  const file = path.join(dir, 'x.lino');
  writeFileAtomicSync(file, 'one\n');
  writeFileAtomicSync(file, 'two\n');
  assert(fs.readFileSync(file, 'utf8') === 'two\n', 'atomic write replaces the content');
  assert(fs.readdirSync(dir).length === 1, 'no temp files are left behind');
  assert((fs.statSync(file).mode & 0o777) === 0o600, 'state files are private (0600)');
}

console.log('\n=== Triple store: save, load, fallback and repair (without clink) ===');
{
  const dir = tmpDir();
  const store = createLinksTripleStore({ dir, clinkPath: false });
  assert((await store.load()).doc === null, 'empty directory loads nothing');
  await store.save(sampleDoc(1));
  await store.save(sampleDoc(2));
  let loaded = await store.load();
  assert(loaded.revision === 2 && loaded.source === 'archive', 'loads the newest revision from the archive');

  fs.writeFileSync(store.paths.archive, 'corrupt');
  loaded = await createLinksTripleStore({ dir, clinkPath: false, log: () => {} }).load();
  assert(loaded.revision === 2 && loaded.source === 'lino', 'falls back to the .lino projection when the archive is corrupt');
  assert(JSON.stringify(await store.readArchive()) === JSON.stringify(sampleDoc(2)), 'repairs the archive from the .lino projection');

  fs.unlinkSync(store.paths.lino);
  loaded = await store.load();
  assert(loaded.source === 'archive' && fs.existsSync(store.paths.lino), 'rebuilds a missing .lino from the archive');

  // A crash between the archive and the .lino rename leaves the .lino stale.
  writeFileAtomicSync(store.paths.archive, await documentToArchive(sampleDoc(3)));
  loaded = await store.load();
  assert(loaded.revision === 3 && documentRevision(await store.readLino()) === 3, 'the newest revision wins and the stale store is refreshed');

  fs.writeFileSync(store.paths.archive, 'x');
  fs.writeFileSync(store.paths.lino, '(((');
  loaded = await createLinksTripleStore({ dir, clinkPath: false, log: () => {} }).load();
  assert(loaded.doc === null && loaded.sources.every(s => !s.ok), 'reports every store as unreadable when all are corrupt');
}

const clink = findClink();
console.log(`\n=== link-cli database (${clink || 'clink not installed: skipped'}) ===`);
if (clink) {
  const dir = tmpDir();
  const store = createLinksTripleStore({ dir, clinkPath: clink, clinkDebounceMs: 10 });
  await store.save(sampleDoc(5));
  await store.flush();
  assert(fs.existsSync(store.paths.clinkDb), 'clink database is created');
  assert(JSON.stringify(await store.readClink()) === JSON.stringify(sampleDoc(5)), 'clink database exports the same document');
  assert(
    fs.readdirSync(dir).every(name => !name.includes('.tmp-') && !name.includes('.old-')),
    'no temporary database directories are left behind'
  );

  // Both file stores lost: the link-cli database rebuilds them.
  fs.unlinkSync(store.paths.archive);
  fs.writeFileSync(store.paths.lino, 'corrupt (');
  const loaded = await createLinksTripleStore({ dir, clinkPath: clink, log: () => {} }).load();
  assert(loaded.source === 'clink' && loaded.revision === 5, 'falls back to the link-cli database');
  assert(JSON.stringify(await store.readArchive()) === JSON.stringify(sampleDoc(5)) && JSON.stringify(await store.readLino()) === JSON.stringify(sampleDoc(5)), 'rebuilds the archive and the .lino from the link-cli database');

  // The database can be queried by name with plain clink.
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(clink, ['--db', store.paths.clinkDb, '--out', path.join(dir, 'export.lino')], { encoding: 'utf8' });
  assert(typeof out === 'string' && fs.readFileSync(path.join(dir, 'export.lino'), 'utf8').includes('browser-commander'), 'clink exports names readable as Links Notation');

  // A stale database is refreshed from newer files.
  await store.save(sampleDoc(6));
  await store.flush();
  assert(documentRevision(await store.readClink()) === 6, 'clink database follows the newest revision');
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
