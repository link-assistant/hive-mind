import { lstat, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readBoundedFile } from '../lib/files.mjs';
import { archiveRepoPattern, archiveRevisionPattern } from './lib/git.mjs';
import { archiveManifestBytes } from './lib/limits.mjs';

const usage = 'Usage: hive-manager archive-overview ARCHIVE_DIRECTORY --legacy-readme FILE\nRead published batch manifests from a local archive checkout and write a Markdown source overview to stdout.\n';
const tableHeader = '| Repository | Claude Code sessions | Codex sessions | Source size |';
const units = ['B', 'KiB', 'MiB', 'GiB'];
const batchName = /^[a-f\d]{64}$/;
const toolNames = ['claude', 'codex'];

function sizeInBytes(value) {
  const match = /^(\d+(?:\.\d+)?) (B|KiB|MiB|GiB)$/.exec(value);
  return match ? Math.round(Number(match[1]) * 1024 ** units.indexOf(match[2])) : NaN;
}

function displaySize(bytes) {
  const unit = bytes >= 1 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  return `${(bytes / 1024 ** unit).toFixed([0, 1, 1, 2][unit])} ${units[unit]}`;
}

function inventoryRow() {
  return { claude: 0, codex: 0, bytes: 0, batches: new Set() };
}

function parseLegacyInventory(markdown) {
  const lines = markdown.split(/\r?\n/);
  const header = lines.findIndex(line => line.trim() === tableHeader);
  if (header < 0) throw new Error('The legacy README needs a source inventory table.');
  const rows = new Map();
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const [column, claude, codex, size, extra] = lines[i]
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim());
    const name = /^\[([^\]]+)\]\(https:\/\/github\.com\/[^)]+\)$/.exec(column)?.[1];
    const count = cell => Number(/^\[(\d+)\]\(\.\/[^)]+\)$/.exec(cell)?.[1]);
    const bytes = sizeInBytes(size);
    const counts = [count(claude), count(codex), bytes];
    const repo = name?.toLowerCase();
    if (!archiveRepoPattern.test(name ?? '') || extra !== undefined || !counts.every(Number.isSafeInteger) || rows.has(repo)) throw new Error('The legacy README contains an invalid source inventory row.');
    rows.set(repo, { ...inventoryRow(), legacy: name, claude: counts[0], codex: counts[1], bytes });
  }
  return rows;
}

export async function renderArchiveOverview(legacyReadme, manifests) {
  const rows = parseLegacyInventory(legacyReadme);
  const seen = new Set();
  for await (const { repository, sessions } of manifests) {
    if (!archiveRepoPattern.test(repository ?? '') || repository !== repository.toLowerCase() || !Array.isArray(sessions) || sessions.length > 100) throw new Error('Invalid archive batch manifest.');
    const row = rows.get(repository) ?? inventoryRow();
    for (const session of sessions) {
      const { tool, archive, revision, sourceBytes, toolResults = [] } = session ?? {};
      if (!toolNames.includes(tool) || !new RegExp(`^${tool}-[a-f0-9]{64}\\.jsonl$`).test(archive ?? '') || (revision !== undefined && !archiveRevisionPattern.test(revision)) || !Array.isArray(toolResults) || toolResults.length > 100) throw new Error('Invalid archive batch session.');
      row.batches.add(tool);
      const key = `${repository}/${archive}.${revision}`;
      if (revision && seen.has(key)) continue;
      if (revision) seen.add(key);
      for (const bytes of [sourceBytes, ...toolResults.map(result => result?.sourceBytes)]) {
        if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(row.bytes + bytes)) throw new Error('Invalid source size in archive batch.');
        row.bytes += bytes;
      }
      row[tool]++;
    }
    if (sessions.length) rows.set(repository, row);
  }
  const table = [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, row]) => {
      const name = row.legacy ?? repo;
      const cells = toolNames.map(tool => {
        if (!row.legacy) return `[${row[tool]}](./${repo})`;
        const legacy = `[${row[tool]}](./${row.legacy}/${tool})`;
        return row.batches.has(tool) ? `${legacy} ([batches](./${repo}))` : legacy;
      });
      return `| [${name}](https://github.com/${name}) | ${cells.join(' | ')} | ${displaySize(row.bytes)} |`;
    });
  return ['# Session archive source overview', '', tableHeader, '| --- | ---: | ---: | ---: |', ...table, ''].join('\n');
}

async function* readManifests(root) {
  for await (const owner of await opendir(root)) {
    if (!owner.isDirectory() || !archiveRepoPattern.test(`${owner.name}/repo`)) continue;
    for await (const repo of await opendir(join(root, owner.name))) {
      const repository = `${owner.name}/${repo.name}`;
      if (!repo.isDirectory() || !archiveRepoPattern.test(repository) || repository !== repository.toLowerCase()) continue;
      const directory = join(root, repository);
      for await (const batch of await opendir(directory)) {
        if (!batch.isDirectory() || !batchName.test(batch.name)) continue;
        const bytes = await readBoundedFile(join(directory, batch.name, 'manifest.json'), archiveManifestBytes, 'archive batch manifest', { noFollow: true });
        const manifest = JSON.parse(bytes);
        if (manifest?.repository !== repository) throw new Error('Archive batch manifest does not match its source directory.');
        yield manifest;
      }
    }
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, 'legacy-readme': { type: 'string' } } });
  if (values.help || process.argv.length === 2) return process.stdout.write(usage);
  if (!values['legacy-readme'] || positionals.length !== 1) throw new Error(usage.trim());
  const root = resolve(positionals[0]);
  if (!(await lstat(root)).isDirectory()) throw new Error('The archive checkout must be a real directory.');
  const legacy = await readBoundedFile(values['legacy-readme'], archiveManifestBytes, 'legacy README', { noFollow: true });
  process.stdout.write(await renderArchiveOverview(legacy.toString('utf8'), readManifests(root)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
