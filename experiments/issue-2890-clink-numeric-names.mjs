#!/usr/bin/env node
/**
 * Issue #2890 experiment: link-cli's text export (`clink --out`) cannot tell a
 * point named "1" from address 1, while the binary store archive keeps them
 * apart. Run with clink on PATH (dotnet tool install --global clink).
 *
 *   node experiments/issue-2890-clink-numeric-names.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeStoreArchive, decodeStoreArchive, findClink } from '../src/solve-queue-store.lib.mjs';

const clink = findClink();
if (!clink) {
  console.log('clink is not installed; skipping');
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clink-numeric-'));
// Address 1 is an unnamed point; address 2 is a point named "1"; address 3 links them.
const store = {
  links: [
    [1, 1, 1],
    [2, 2, 2],
    [3, 1, 2],
  ],
  names: [[2, '1']],
};
fs.writeFileSync(path.join(dir, 'in.links-archive'), await encodeStoreArchive(store));
const db = path.join(dir, 'db.links');
execFileSync(clink, ['--db', db, '--import-binary', path.join(dir, 'in.links-archive')]);
execFileSync(clink, ['--db', db, '--out', path.join(dir, 'out.lino')]);
execFileSync(clink, ['--db', db, '--export-binary', path.join(dir, 'out.links-archive')]);
console.log('clink --version:', execFileSync(clink, ['--version']).toString().trim());
console.log('--- clink --out (text) ---');
console.log(fs.readFileSync(path.join(dir, 'out.lino'), 'utf8').trim());
console.log('--- clink --export-binary, decoded ---');
console.log(JSON.stringify(await decodeStoreArchive(fs.readFileSync(path.join(dir, 'out.links-archive')))));
// Re-import the text export into a fresh database and look at what came back.
const db2 = path.join(dir, 'reimport.links');
try {
  execFileSync(clink, ['--db', db2, '--import', path.join(dir, 'out.lino')], { stdio: 'pipe' });
  execFileSync(clink, ['--db', db2, '--export-binary', path.join(dir, 'reimport.links-archive')]);
  console.log('--- text export re-imported, decoded ---');
  console.log(JSON.stringify(await decodeStoreArchive(fs.readFileSync(path.join(dir, 'reimport.links-archive')))));
} catch (error) {
  console.log('--- re-importing the text export failed ---');
  console.log(String(error.stderr || error.message).trim());
}
