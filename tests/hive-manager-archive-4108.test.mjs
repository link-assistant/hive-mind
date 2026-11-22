/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const source = 'example/project';
const destination = 'example/archive';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const literal = 'fixture + extra.literal? [4108] "quoted"';

function legacyArtifact(write, name, raw, outputs, { tool = 'codex', kind = 'jsonl' } = {}) {
  const stem = `Example/Project/${tool}/${name}`;
  const files = Object.entries(outputs).map(([extension, content]) => {
    const path = `${stem}.${extension}`;
    write(`seed/${path}`, content);
    return { path, bytes: Buffer.byteLength(content), sha256: sha256(content) };
  });
  write(`seed/${stem}.meta.json`, JSON.stringify({ repository: 'Example/Project', tool, kind, source: { sha256: sha256(raw), bytes: Buffer.byteLength(raw) }, files }));
  return stem;
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-4108-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(cwd, 'gitconfig'), GIT_ALLOW_PROTOCOL: 'file', PATH: `${cwd}:${process.env.PATH}` };
  const write = (name, text, mode = 0o600) => {
    const file = join(cwd, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { mode });
    return file;
  };
  const command = (bin, args, override = {}) => spawnSync(bin, args, { cwd, env: { ...env, ...override }, encoding: 'utf8', timeout: 15000 });
  const git = (...args) => {
    const result = command('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  // github-retry-ok: Local test executable, without GitHub requests.
  write(
    'gh',
    `#!/usr/bin/env bash
set -eu
case "$4" in
  repos/example/project)
    if [[ "$6" == .visibility ]]; then printf 'public\\n'
    else printf '{"full_name":"Example/Project","visibility":"public","default_branch":"main"}\\n'; fi ;;
  repos/example/archive)
    printf '{"full_name":"example/archive","visibility":"%s","default_branch":"main"}\\n' "${'\x24'}{ARCHIVE_VISIBILITY:-private}" ;;
  *) exit 1 ;;
esac
`,
    0o700
  );
  write('conversation', '#!/usr/bin/env bash\nif [[ -v CONVERSION_FIXTURE ]]; then printf "%s\\n" "$CONVERSION_FIXTURE" > "$4"; else cp -- "$3" "$4"; fi\n', 0o700);
  const remote = join(cwd, 'remote.git');
  git('config', '--global', 'user.name', 'Archive Test');
  git('config', '--global', 'user.email', 'archive-test@example.invalid');
  git('config', '--global', `url.file://${remote}.insteadOf`, `https://github.com/${destination}.git`);
  git('init', '--bare', '--initial-branch=main', remote);
  git('-C', remote, 'config', 'uploadpack.allowFilter', 'true');
  git('init', '--initial-branch=main', 'seed');
  write('seed/README.md', 'Historical inventory\n');
  const commitSeed = () => {
    git('-C', 'seed', 'add', '.');
    git('-C', 'seed', 'commit', '-qm', 'Legacy archive');
    git('-C', 'seed', 'push', remote, 'main');
    return head();
  };
  const head = () => git('-C', remote, 'rev-parse', 'main');
  const stage = ['archive-sessions', '--repo', source, '--claude-dir', 'claude', '--codex-dir', 'codex'];
  const run = (args, override) => command('bash', [script, ...args], override);
  const ok = (args, override) => {
    const result = run(args, override);
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const codex = (name, message, minutes = 60) => {
    const text = `${JSON.stringify({ type: 'session_meta', payload: { git: { repository_url: 'https://github.com/example/project.git' } }, message })}\n`;
    const path = write(`codex/2026/11/21/${name}.jsonl`, text);
    const age = new Date(Date.now() - minutes * 60_000);
    utimesSync(path, age, age);
    return { path, text };
  };
  const manifest = directory => JSON.parse(readFileSync(join(cwd, directory, 'manifest.json'), 'utf8'));
  return { cwd, write, git, commitSeed, head, stage, run, ok, codex, manifest, remote };
}

test('legacy archive import verifies output policy and keeps the first incremental commit on the existing private history', { timeout: 60000 }, t => {
  const { write, git, commitSeed, head, stage, run, ok, codex, manifest, remote } = fixture(t);
  const { text } = codex('old', 'Already archived');
  const historical = '{"message":"Already archived"}\n';
  const legacy = legacyArtifact(write, '2026/11/21/old', text, { jsonl: historical, lino: historical });
  const base = commitSeed();
  codex('new', 'New batch');
  write('literals', `${literal}\n`);
  const redactions = ['--known-secrets-file', 'literals'];
  const migrate = [...stage, '--import-legacy', destination, ...redactions];
  assert.match(run(migrate, { ARCHIVE_VISIBILITY: 'public' }).stderr, /requires a private destination/);
  assert.equal(JSON.parse(ok(migrate).stdout).indexEntries.length, 0);
  const selected = [...migrate, '--lino'];
  const { digest, indexEntries } = JSON.parse(ok(selected).stdout);
  assert.equal(indexEntries.length, 1);
  assert.equal(head(), base);
  assert.notEqual(run([...migrate, '--apply', digest]).status, 0);
  // The plan must be reviewed again when the destination advances.
  write('seed/unrelated.txt', 'another operator\n');
  const advanced = commitSeed();
  assert.match(run([...selected, '--apply', digest]).stderr, /changed since review/);
  assert.equal(head(), advanced);
  const fresh = JSON.parse(ok(selected).stdout);
  ok([...selected, '--apply', fresh.digest]);
  const imported = head();
  assert.equal(git('-C', remote, 'rev-parse', `${imported}^`), advanced);
  assert.equal(git('-C', remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', imported), indexEntries[0]);
  assert.equal(git('-C', remote, 'show', 'main:README.md'), 'Historical inventory');
  assert.equal(git('-C', remote, 'show', `main:${legacy}.jsonl`), historical.trim());
  assert.deepEqual(JSON.parse(ok(selected).stdout).indexEntries, []);
  ok([...stage, '--lino', ...redactions, '--published-in', destination, '--output', 'first', '--limit', '1']);
  const [entry] = manifest('first').sessions;
  assert.equal(entry.archive, `codex-${sha256('2026/11/21/new.jsonl')}.jsonl`);
  const scheduled = [...stage, '--publish-private', destination, '--lino', ...redactions];
  ok(scheduled);
  assert.equal(git('-C', remote, 'rev-parse', `${head()}^`), imported);
  const published = head();
  assert.match(ok(scheduled).stdout, /Staged 0 session/);
  assert.equal(head(), published);
});

test('legacy import requires verified Claude attachments and rejects changed or unsafe evidence', { timeout: 60000 }, t => {
  const { cwd, write, git, commitSeed, stage, ok, manifest } = fixture(t);
  git('init', 'checkout');
  git('-C', 'checkout', 'remote', 'add', 'origin', 'https://github.com/example/project.git');
  const age = new Date(Date.now() - 60 * 60_000);
  const writeOld = (name, text) => {
    const path = write(name, text);
    utimesSync(path, age, age);
  };
  const claude = name => {
    const raw = `${JSON.stringify({ cwd: join(cwd, 'checkout'), message: name })}\n`;
    writeOld(`claude/project/${name}.jsonl`, raw);
    return raw;
  };
  const safe = '{"message":"historical result"}\n';
  legacyArtifact(write, 'attached', claude('attached'), { jsonl: safe }, { tool: 'claude' });
  const attachment = 'attachment payload\n';
  writeOld('claude/project/attached/tool-results/result.log', attachment);
  legacyArtifact(write, 'attached/tool-results/result', attachment, { log: attachment }, { tool: 'claude', kind: 'text' });
  claude('changed');
  legacyArtifact(write, 'changed', 'other transcript', { jsonl: safe }, { tool: 'claude' });
  const corrupt = legacyArtifact(write, 'corrupt', claude('corrupt'), { jsonl: safe }, { tool: 'claude' });
  write(`seed/${corrupt}.jsonl`, 'different archive bytes that exceed the expected count\n');
  legacyArtifact(write, 'unsafe', claude('unsafe'), { jsonl: JSON.stringify({ message: literal }) }, { tool: 'claude' });
  write('literals', `${literal}\n`);
  commitSeed();
  const migrate = [...stage, '--import-legacy', destination, '--known-secrets-file', 'literals'];
  const without = JSON.parse(ok(migrate).stdout);
  assert.deepEqual(without.indexEntries, []);
  assert.deepEqual(without.skipped, { 'different-attachment-policy': 1, 'changed-source': 1, 'unverified-artifact': 1, 'literal-residual': 1 });
  const withAttachments = [...migrate, '--tool-results'];
  const imported = JSON.parse(ok(withAttachments).stdout);
  assert.equal(imported.matches.length, 1);
  assert.equal(imported.matches[0].metadata, 'Example/Project/claude/attached.meta.json');
  ok([...withAttachments, '--apply', imported.digest]);
  const incremental = [...stage, '--published-in', destination, '--tool-results', '--known-secrets-file', 'literals', '--output'];
  ok([...incremental, 'initial']);
  const marker = imported.indexEntries[0].split('/').pop();
  assert.equal(
    manifest('initial').sessions.some(entry => marker.startsWith(`${entry.archive}.`)),
    false
  );
  writeOld('claude/project/attached/tool-results/result.log', 'updated attachment payload\n');
  ok([...incremental, 'after-change']);
  assert.equal(
    manifest('after-change').sessions.some(entry => marker.startsWith(`${entry.archive}.`) && entry.toolResults.length === 1),
    true
  );
});

test('literal redactions protect staged, converted and reviewed files and require a private destination', { timeout: 60000 }, t => {
  const { cwd, write, commitSeed, head, stage, run, ok, codex, manifest, git, remote } = fixture(t);
  const base = commitSeed();
  codex('literal', `Keep this, redact ${literal}`);
  write('literals', `${literal}\n`);
  write('different', 'another synthetic literal\n');
  const extra = ['--known-secrets-file', 'literals'];
  assert.match(run([...stage, '--publish-private', destination, '--lino', ...extra], { CONVERSION_FIXTURE: literal }).stderr, /configured literal/);
  assert.equal(head(), base);
  ok([...stage, '--output', 'staged', ...extra]);
  const [{ archive }] = manifest('staged').sessions;
  const file = join(cwd, 'staged', archive);
  const sanitized = readFileSync(file, 'utf8');
  assert.equal(JSON.parse(sanitized).message, 'Keep this, redact [REDACTED]');
  const publish = ['archive-publish', 'staged', '--destination', destination];
  assert.match(run(publish).stderr, /same --known-secrets-file/);
  assert.match(run([...publish, '--known-secrets-file', 'different']).stderr, /same --known-secrets-file/);
  assert.match(run([...publish, ...extra], { ARCHIVE_VISIBILITY: 'public' }).stderr, /requires a private destination/);
  writeFileSync(file, JSON.stringify({ message: literal }));
  assert.match(run([...publish, ...extra]).stderr, /configured literal/);
  writeFileSync(file, sanitized);
  const review = JSON.parse(ok([...publish, ...extra]).stdout);
  assert.deepEqual(review.files, [archive, 'manifest.json']);
  writeFileSync(file, JSON.stringify({ message: literal }));
  assert.notEqual(run([...publish, ...extra, '--apply', review.digest]).status, 0);
  assert.equal(head(), base);
  writeFileSync(file, sanitized);
  ok([...publish, ...extra, '--apply', review.digest]);
  const tree = git('-C', remote, 'ls-tree', '-r', '--name-only', 'main');
  assert.doesNotMatch(tree, /redaction-policy|literals/);
  assert.equal(git('-C', remote, 'show', `main:${source}/${review.digest.slice(7)}/${archive}`), sanitized.trim());
});

test('archive reports oversized attributed sessions beyond the export limit and honors minimum age', { timeout: 30000 }, t => {
  const { codex, stage, ok, manifest } = fixture(t);
  codex('current', 'recent', 2);
  const oversized = codex('oversized', 'reported without sanitizing');
  truncateSync(oversized.path, 40 * 1024 * 1024 + 1);
  const old = new Date(Date.now() - 60 * 60_000);
  utimesSync(oversized.path, old, old);
  const defaultAge = ok([...stage, '--output', 'default-age']);
  assert.match(defaultAge.stderr, /Omitted 1 oversized.*40 MiB/);
  assert.deepEqual(manifest('default-age').sessions, []);
  const smallerAge = ok([...stage, '--output', 'custom-age', '--min-age', '1', '--limit', '1']);
  assert.match(smallerAge.stderr, /Omitted 1 oversized.*40 MiB/);
  assert.equal(manifest('custom-age').sessions.length, 1);
  assert.deepEqual(manifest('custom-age').omissions.oversized, { claude: 0, codex: 1, maxSourceBytes: 40 * 1024 * 1024 });
});
