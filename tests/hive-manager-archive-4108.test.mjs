/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
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
  const command = (bin, args, override = {}) => spawnSync(bin, args, { cwd, env: { ...env, ...override }, encoding: 'utf8', timeout: 60000 });
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
  legacyArtifact(write, 'attached/tool-results/result', attachment, { 'part-001.log': 'attachment\n', 'part-002.log': 'payload\n' }, { tool: 'claude', kind: 'text' });
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

test('archive reports an oversized individual record beyond the session limit and honors minimum age', { timeout: 30000 }, t => {
  const { codex, stage, ok, manifest, cwd } = fixture(t);
  codex('current', 'recent', 2);
  const oversized = codex('oversized', 'metadata');
  truncateSync(oversized.path, oversized.text.length + 40 * 1024 * 1024 + 1);
  const old = new Date(Date.now() - 60 * 60_000);
  utimesSync(oversized.path, old, old);
  const defaultAge = ok([...stage, '--output', 'default-age']);
  assert.match(defaultAge.stderr, /Omitted 1 session.*individual JSONL record exceeds 40 MiB/);
  assert.deepEqual(manifest('default-age').sessions, []);
  const smallerAge = ok([...stage, '--output', 'custom-age', '--min-age', '1', '--limit', '1']);
  assert.match(smallerAge.stderr, /Omitted 1 session.*individual JSONL record exceeds 40 MiB/);
  assert.equal(manifest('custom-age').sessions.length, 1);
  assert.deepEqual(manifest('custom-age').omissions, { 'oversized-record': { claude: 0, codex: 1 } });
  const out = join(cwd, 'default-age', `codex-${sha256('2026/11/21/oversized.jsonl')}.part-001.jsonl`);
  assert.throws(() => statSync(out), { code: 'ENOENT' });
});

test('a 41 MiB Codex revision stages every record in order with one reviewed private marker', { timeout: 120000 }, async t => {
  const { cwd, write, commitSeed, head, stage, run, ok, codex, manifest } = fixture(t);
  const base = commitSeed();
  const { path, text } = codex('numbered', 'Starting records');
  const record = (sequence, message) => JSON.stringify({ type: 'event_msg', sequence, message });
  const line = (sequence, tail) => record(sequence, `A transcript fixture with short words and Unicode π. ${'plain text '.repeat(512)}${tail}`);
  const sourceBytes = 41 * 1024 * 1024;
  const expected = createHash('sha256').update(text);
  let remaining = sourceBytes - Buffer.byteLength(text);
  let sequence = 0;
  let block = '';
  while (remaining > 2 * Buffer.byteLength(line(sequence, literal))) {
    const tail = sequence % 101 === 0 ? literal : '';
    const raw = `${line(sequence++, tail)}\n`;
    remaining -= Buffer.byteLength(raw);
    block += raw;
    expected.update(tail ? raw.replace(JSON.stringify(literal).slice(1, -1), '[REDACTED]') : raw);
    if (block.length > 256 * 1024) {
      appendFileSync(path, block);
      block = '';
    }
  }
  const tailBytes = remaining - record(sequence, '').length;
  // An unterminated final record is preserved as well.
  const final = record(sequence++, 'x '.repeat(Math.floor(tailBytes / 2)) + 'x'.repeat(tailBytes % 2));
  expected.update(final);
  appendFileSync(path, block + final);
  assert.equal(statSync(path).size, sourceBytes);
  const age = new Date(Date.now() - 60 * 60_000);
  utimesSync(path, age, age);
  write('literals', `${literal}\n`);
  const extra = ['--known-secrets-file', 'literals'];
  const environment = { NODE_OPTIONS: '--max-old-space-size=384' };
  const automatic = ok([...stage, '--publish-private', destination, ...extra], environment);
  assert.match(automatic.stderr, /require staging with --output/);
  assert.equal(head(), base);
  ok([...stage, '--lino', '--output', 'numbered', ...extra], environment);
  const { sessions, omissions } = manifest('numbered');
  assert.equal(omissions, undefined);
  assert.equal(sessions.length, 1);
  const [entry] = sessions;
  assert.equal(entry.sourceBytes, sourceBytes);
  assert.equal(entry.parts.length, 2);
  assert.deepEqual(
    entry.parts.map(part => part.archive),
    ['001', '002'].map(number => entry.archive.replace('.jsonl', `.part-${number}.jsonl`))
  );
  const actual = createHash('sha256');
  let records = 0;
  for (const part of entry.parts) {
    const file = join(cwd, 'numbered', part.archive);
    assert.ok(statSync(file).size <= 40 * 1024 * 1024);
    assert.equal(statSync(join(cwd, 'numbered', part.linksNotation)).size, statSync(file).size);
    for await (const data of createReadStream(file)) actual.update(data);
    for await (const row of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
      if (records) {
        const event = JSON.parse(row);
        assert.equal(event.sequence, records - 1);
        assert.equal(event.message.includes(literal), false);
      }
      records++;
    }
  }
  assert.equal(records, sequence + 1);
  assert.equal(actual.digest('hex'), expected.digest('hex'));
  const args = ['archive-publish', 'numbered', '--destination', destination, ...extra];
  assert.match(run(args, { ...environment, ARCHIVE_VISIBILITY: 'public' }).stderr, /requires a private destination/);
  const review = JSON.parse(ok(args, environment).stdout);
  assert.deepEqual(review.indexEntries, [`${source}/.published/${entry.archive}.${entry.revision.slice(7)}`]);
  assert.deepEqual(review.files, ['manifest.json', ...entry.parts.flatMap(part => [part.archive, part.linksNotation])].sort());
  assert.equal(head(), base);
});

test('legacy numbered revisions require a complete set of verified parts and import one marker', { timeout: 30000 }, t => {
  const { write, git, commitSeed, head, stage, ok, codex, manifest, remote } = fixture(t);
  const outcomes = { 'part-001.jsonl': '{"payload":"first"}\n', 'part-002.jsonl': '{"payload":"second"}\n' };
  const { text } = codex('matching', 'unchanged transcript');
  const matching = legacyArtifact(write, '2026/11/21/matching', text, outcomes);
  const { text: broken } = codex('corrupt-part', 'corrupt evidence');
  const corrupt = legacyArtifact(write, '2026/11/21/corrupt-part', broken, outcomes);
  write(`seed/${corrupt}.part-002.jsonl`, outcomes['part-002.jsonl'].replace('second', 'second'.toUpperCase()));
  const { text: missing } = codex('missing-part', 'nonconsecutive evidence');
  legacyArtifact(write, '2026/11/21/missing-part', missing, { 'part-001.jsonl': outcomes['part-001.jsonl'], 'part-003.jsonl': outcomes['part-002.jsonl'] });
  const { text: unsafe } = codex('unsafe-part', 'literal in archived second part');
  legacyArtifact(write, '2026/11/21/unsafe-part', unsafe, { ...outcomes, 'part-002.jsonl': `${JSON.stringify({ message: literal })}\n` });
  write('literals', `${literal}\n`);
  const base = commitSeed();
  const args = [...stage, '--import-legacy', destination, '--known-secrets-file', 'literals'];
  const review = JSON.parse(ok(args).stdout);
  assert.deepEqual(review.skipped, { 'unverified-artifact': 2, 'literal-residual': 1 });
  assert.deepEqual(review.unverifiedArtifacts, [`${corrupt}.part-002.jsonl`, 'Example/Project/codex/2026/11/21/missing-part.part-002.jsonl']);
  assert.equal(review.matches.length, 1);
  assert.equal(review.matches[0].metadata, `${matching}.meta.json`);
  assert.equal(head(), base);
  ok([...args, '--apply', review.digest]);
  assert.equal(git('-C', remote, 'rev-parse', `${head()}^`), base);
  assert.equal(git('-C', remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', head()), review.indexEntries[0]);
  const exportArgs = [...stage, '--published-in', destination, '--known-secrets-file', 'literals', '--output'];
  ok([...exportArgs, 'same']);
  const saved = review.indexEntries[0].split('/').pop();
  const matchingArchive = `codex-${sha256('2026/11/21/matching.jsonl')}.jsonl`;
  assert.ok(saved.startsWith(`${matchingArchive}.`));
  assert.equal(
    manifest('same').sessions.some(session => session.archive === matchingArchive),
    false
  );
  ok([...exportArgs, 'another-policy', '--lino']);
  assert.equal(
    manifest('another-policy').sessions.some(session => session.archive === matchingArchive),
    true
  );
});

test('numbered manifests enforce structure, size, private visibility and revision deduplication', { timeout: 30000 }, t => {
  const { write, commitSeed, head, run, ok } = fixture(t);
  const base = commitSeed();
  const stem = `codex-${sha256('fixture-session')}`;
  const revision = `sha256:${sha256('fixture-revision')}`;
  const part = number => ({ archive: `${stem}.part-${String(number).padStart(3, '0')}.jsonl` });
  const session = { archive: `${stem}.jsonl`, tool: 'codex', revision, sourceBytes: 41 * 1024 * 1024, parts: [part(1), part(2)] };
  const save = entry => write('parts/manifest.json', JSON.stringify({ repository: source, sessions: [entry] }));
  const args = ['archive-publish', 'parts', '--destination', destination];
  save({ ...session, parts: [part(1), part(3)] });
  assert.match(run(args).stderr, /invalid transcript parts/);
  save({ ...session, parts: Array.from({ length: 301 }, (_, index) => part(index + 1)) });
  assert.match(run(args).stderr, /invalid transcript parts/);
  save(session);
  assert.match(run(args, { ARCHIVE_VISIBILITY: 'public' }).stderr, /requires a private destination/);
  write(`parts/${part(1).archive}`, '{"first":true}');
  assert.match(run(args).stderr, /record boundary/);
  write(`parts/${part(1).archive}`, '{"first":true}\n');
  assert.match(run(args).stderr, /archive artifact/);
  const second = write(`parts/${part(2).archive}`, '{"second":true}\n');
  truncateSync(second, 40 * 1024 * 1024 + 1);
  assert.match(run(args).stderr, /at most 41943040 bytes/);
  writeFileSync(second, '{"second":true}\n');
  const review = JSON.parse(ok(args).stdout);
  assert.equal(review.indexEntries.length, 1);
  writeFileSync(second, '{"second":false}\n');
  assert.match(run([...args, '--apply', review.digest]).stderr, /changed since review/);
  assert.equal(head(), base);
  writeFileSync(second, '{"second":true}\n');
  ok([...args, '--apply', review.digest]);
  const published = head();
  assert.match(ok([...args, '--apply', review.digest]).stdout, /already published/);
  assert.equal(head(), published);
  save({ ...session, modifiedAt: '2026-11-21T00:00:00Z' });
  const duplicate = JSON.parse(ok(args).stdout);
  assert.match(run([...args, '--apply', duplicate.digest]).stderr, /revision has already been published/);
  assert.equal(head(), published);
});

test('archive overview folds new manifests into an immutable legacy README baseline', { timeout: 30000 }, t => {
  const { ok, run, write, cwd } = fixture(t);
  const readme = '# Archive\n\n| Repository | Claude Code sessions | Codex sessions | Source size |\n| --- | ---: | ---: | ---: |\n| [Example/Project](https://github.com/Example/Project) | [2](./Example/Project/claude) | [3](./Example/Project/codex) | 2.0 MiB |\n| [Other/Legacy](https://github.com/Other/Legacy) | [0](./Other/Legacy/claude) | [1](./Other/Legacy/codex) | 20 B |\n';
  write('legacy.md', readme);
  const entry = { tool: 'codex', archive: `codex-${'a'.repeat(64)}.jsonl`, revision: `sha256:${'b'.repeat(64)}`, sourceBytes: 41 * 1024 * 1024, parts: [{}, {}] };
  for (const tag of ['a', 'b']) write(`archive/${source}/${tag.repeat(64)}/manifest.json`, JSON.stringify({ repository: source, sessions: [entry] }));
  const other = { tool: 'claude', archive: `claude-${'b'.repeat(64)}.jsonl`, sourceBytes: 500, toolResults: [{ sourceBytes: 150 }] };
  write(`archive/another/project/${'c'.repeat(64)}/manifest.json`, JSON.stringify({ repository: 'another/project', sessions: [other] }));
  const args = ['archive-overview', 'archive', '--legacy-readme', 'legacy.md'];
  const result = ok(args).stdout;
  assert.ok(result.includes('| [Example/Project](https://github.com/Example/Project) | [2](./Example/Project/claude) | [4](./Example/Project/codex) ([batches](./example/project)) | 43.0 MiB |'));
  assert.ok(result.includes('| [Other/Legacy](https://github.com/Other/Legacy) | [0](./Other/Legacy/claude) | [1](./Other/Legacy/codex) | 20 B |'));
  assert.ok(result.includes('| [another/project](https://github.com/another/project) | [1](./another/project) | [0](./another/project) | 650 B |'));
  assert.equal(readFileSync(join(cwd, 'legacy.md'), 'utf8'), readme);
  assert.equal(ok(args).stdout, result);
  write(`archive/${source}/${'c'.repeat(64)}/manifest.json`, JSON.stringify({ repository: 'different/project', sessions: [entry] }));
  assert.match(run(args).stderr, /does not match its source directory/);
});
