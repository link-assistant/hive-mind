#!/usr/bin/env node
/**
 * Derive replay fixtures from downloaded E2E evidence (issue #3630).
 *
 *   node scripts/e2e-derive-replay.mjs --run <dir> [--delivery-dir <dir>] --out tests/fixtures/e2e-replay
 *   node scripts/e2e-derive-replay.mjs --evidence <row dir> [--evidence <row dir>…] --out <dir>
 *
 * `--run` is a `gh run download` directory: every `e2e-hello-world-*` entry is
 * one row. `--delivery-dir` holds `<row dir name>.json` delivery records for
 * evidence recorded before delivery.json existed (see
 * experiments/issue-3630/backfill-delivery.mjs). Evidence is only read as
 * data; nothing in it is executed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { deriveReplay, replayName } from './e2e-replay.lib.mjs';

const args = process.argv.slice(2);
const values = flag => args.flatMap((arg, index) => (arg === flag && args[index + 1] ? [resolve(args[index + 1])] : []));
const [out] = values('--out');
const [deliveryDir] = values('--delivery-dir');
const rows = [...values('--evidence'), ...values('--run').flatMap(run => readdirSync(run, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() && entry.name.startsWith('e2e-hello-world-') ? [join(run, entry.name)] : [])))];
if (!out || !rows.length) {
  console.error('usage: e2e-derive-replay.mjs (--run <dir> | --evidence <row dir>…) [--delivery-dir <dir>] --out <dir>');
  process.exit(2);
}

const read = path => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const readJson = path => {
  const text = read(path);
  return text === null ? null : JSON.parse(text);
};

mkdirSync(out, { recursive: true });
for (const dir of rows) {
  const result = readJson(join(dir, 'result.json'));
  if (!result) {
    console.error(`${dir}: no result.json, skipped`);
    continue;
  }
  const present = readdirSync(dir);
  const delivery = readJson(join(dir, 'delivery.json')) ?? (deliveryDir ? readJson(join(deliveryDir, `${basename(dir)}.json`)) : null);
  const name = replayName(result, basename(dir));
  const fixture = deriveReplay({ name, result, delivery, solveLog: read(join(dir, 'solve.log')), actLog: read(join(dir, 'act.log')), commands: readJson(join(dir, 'commands.json')), manifest: readJson(join(dir, 'manifest.json')), present });
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${name}: ${fixture.recorded.evaluation.length} assertions, missing [${fixture.evidence.missing.join(', ')}], ${fixture.evidence.placeholders.length} placeholder files, ${fixture.evidence.redactions} redactions`);
}
