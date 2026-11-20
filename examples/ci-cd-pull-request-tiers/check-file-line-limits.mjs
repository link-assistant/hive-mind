#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createReadStream, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const limit = 1500;
const baselinePath = '.file-line-limits.json';

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function readBaseline(json, source) {
  const records = JSON.parse(json);
  if (records === null || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error(`${source} must be a JSON object mapping paths to line counts.`);
  }
  for (const [file, count] of Object.entries(records)) {
    if (!file || !Number.isSafeInteger(count) || count <= limit) {
      throw new Error(`${source} has an invalid baseline entry for ${JSON.stringify(file)}.`);
    }
  }
  return new Map(Object.entries(records));
}

async function countLines(filename) {
  let lines = 0;
  let lastByte = 10;
  for await (const chunk of createReadStream(filename)) {
    for (let index = chunk.indexOf(10); index !== -1; index = chunk.indexOf(10, index + 1)) {
      lines++;
    }
    lastByte = chunk[chunk.length - 1];
  }
  return lines + Number(lastByte !== 10);
}

function updateBaseline(filename, json) {
  const directory = mkdtempSync(`${filename}.`);
  try {
    const temporaryFile = join(directory, 'baseline.json');
    writeFileSync(temporaryFile, json);
    renameSync(temporaryFile, filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { initialize: { type: 'boolean' }, update: { type: 'boolean' }, base: { type: 'string' } },
    allowPositionals: true,
  });
  if (positionals.length === 0 || Number(Boolean(values.initialize)) + Number(Boolean(values.update)) + Number(values.base !== undefined) > 1) {
    throw new Error('Usage: check-file-line-limits.mjs [--initialize | --update | --base <ref>] -- <Git pathspec>...');
  }

  const root = git(['rev-parse', '--show-toplevel']).replace(/\r?\n$/, '');
  const filename = join(root, baselinePath);
  const baseline = values.initialize ? new Map() : readBaseline(readFileSync(filename, 'utf8'), baselinePath);
  if (values.base !== undefined) {
    const baseCommit = git(['rev-parse', '--verify', '--end-of-options', `${values.base}^{commit}`], root).trim();
    const previous = readBaseline(git(['show', `${baseCommit}:${baselinePath}`], root), `base ${baselinePath}`);
    for (const [file, count] of baseline) {
      if (count > (previous.get(file) ?? limit)) {
        throw new Error(`${baselinePath} raises the ceiling for ${JSON.stringify(file)} above the base revision.`);
      }
    }
  }

  const tracked = git(['ls-files', '--cached', '--deduplicate', '-z', '--', ...positionals], root)
    .split('\0')
    .filter(Boolean)
    .sort();
  const oversized = new Map();
  const violations = [];
  for (const file of tracked) {
    const path = join(root, file);
    if (file === baselinePath || !lstatSync(path).isFile()) continue;
    const count = await countLines(path);
    const ceiling = baseline.get(file) ?? limit;
    if (count > limit) oversized.set(file, count);
    if (!values.initialize && count > ceiling) {
      violations.push(`${JSON.stringify(file)} has ${count} lines (ceiling ${ceiling}).`);
    }
  }
  if (violations.length > 0) throw new Error(violations.join('\n'));

  const json = `${JSON.stringify(Object.fromEntries(oversized), null, 2)}\n`;
  if (values.initialize) {
    writeFileSync(filename, json, { flag: 'wx' });
  } else if (values.update) {
    updateBaseline(filename, json);
  } else if (baseline.size !== oversized.size || [...baseline].some(([file, count]) => oversized.get(file) !== count)) {
    throw new Error(`${baselinePath} is stale. Run with --update and commit the lowered or removed ceilings.`);
  }

  console.log(`Checked ${tracked.length} tracked paths against the ${limit}-line limit and ${oversized.size} baseline entries.`);
}

try {
  await main();
} catch (error) {
  console.error(error.stderr?.trim() || error.message);
  process.exitCode = 1;
}
