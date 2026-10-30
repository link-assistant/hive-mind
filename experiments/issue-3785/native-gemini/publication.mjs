// Durable first-publication recovery for the disposable Linux history adapter.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';

const LIMIT = 32 * 1024 * 1024;
const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const journalName = new RegExp(`^\\.publish-(${uuid})\\.json$`, 'u');
const version = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}:${info.nlink}`;
const owned = info => info.isFile() && info.uid === BigInt(process.getuid()) && (info.mode & 0o777n) === 0o600n;
const digest = value => createHash('sha256').update(value).digest('hex');

function permitted(parent, name) {
  const parts = parent.components;
  if (typeof name !== 'string' || name.length > 255) return false;
  if (parts.length === 0) return name === 'projects.json';
  if (parts[0] !== 'projects' || !/^[a-f0-9]{64}$/u.test(parts[1] ?? '')) return false;
  if (parts.length === 3 && parts[2] === 'message-history') return ['prompt-history.json', 'checkpoint-history.json'].includes(name);
  if (parts.length === 3 && parts[2] === 'chats') return name.length <= 200 && new RegExp(`^session-[a-zA-Z0-9_.-]+\\.jsonl?(?:\\.preserved-${uuid})?$`, 'u').test(name);
  if (parts.length !== 4 || !/^session-[a-f0-9]{64}$/u.test(parts[3])) return false;
  if (parts[2] === 'tool-outputs') return new RegExp(`^artifact-[a-f0-9]{64}-${uuid}\\.txt$`, 'u').test(name);
  if (parts[2] === 'degraded-blobs') return new RegExp(`^blob-[a-f0-9]{64}-${uuid}\\.[A-Za-z0-9_-]{3,128}$`, 'u').test(name);
  return false;
}

function information(file, missing = false) {
  try {
    return fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (missing && error.code === 'ENOENT') return null;
    throw error;
  }
}

function readJournal(file, refuse) {
  const before = information(file);
  if (!owned(before) || before.nlink !== 1n || before.size > 4096n) throw refuse();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (version(opened) !== version(before)) throw refuse();
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (BigInt(length) !== opened.size || version(fs.fstatSync(fd, { bigint: true })) !== version(before) || version(information(file)) !== version(before) || !isUtf8(bytes.subarray(0, length))) throw refuse();
    return { record: JSON.parse(bytes.subarray(0, length).toString('utf8')), generation: version(before) };
  } finally {
    fs.closeSync(fd);
  }
}

function dataFile(file, record, refuse, missing = false) {
  const before = information(file, missing);
  if (before === null) return null;
  if (!owned(before) || ![1n, 2n].includes(before.nlink) || before.dev.toString() !== record.device || before.ino.toString() !== record.inode || before.size !== BigInt(record.size)) throw refuse();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (version(fs.fstatSync(fd, { bigint: true })) !== version(before)) throw refuse();
    const hash = createHash('sha256');
    const bytes = Buffer.alloc(65536);
    let length = 0;
    for (;;) {
      const count = fs.readSync(fd, bytes, 0, bytes.length, length);
      if (count === 0) break;
      length += count;
      if (length > LIMIT || length > record.size) throw refuse();
      hash.update(bytes.subarray(0, count));
    }
    if (length !== record.size || hash.digest('hex') !== record.digest || version(fs.fstatSync(fd, { bigint: true })) !== version(before) || version(information(file)) !== version(before)) throw refuse();
    return before;
  } finally {
    fs.closeSync(fd);
  }
}

export function recoverNativeGeminiPublications(parent, current, refuse) {
  const names = [];
  const directory = fs.opendirSync(parent.anchor, { bufferSize: 32 });
  try {
    let count = 0;
    for (let entry; (entry = directory.readSync()) !== null;) {
      if (++count > 16384) throw refuse();
      if (!entry.name.startsWith('.publish-')) continue;
      if (!journalName.test(entry.name) || names.length >= 128) throw refuse();
      names.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
  for (const name of names.sort()) {
    current();
    const journal = `${parent.anchor}/${name}`;
    const { record, generation } = readJournal(journal, refuse);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 6 || record.version !== 1 || !permitted(parent, record.name) || typeof record.device !== 'string' || !/^[0-9]{1,30}$/u.test(record.device) || typeof record.inode !== 'string' || !/^[0-9]{1,30}$/u.test(record.inode) || !Number.isSafeInteger(record.size) || record.size < 0 || record.size > LIMIT || typeof record.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(record.digest)) throw refuse();
    const temporary = `${parent.anchor}/.history-${journalName.exec(name)[1]}.tmp`;
    const target = `${parent.anchor}/${record.name}`;
    const check = () => {
      current();
      if (version(information(journal)) !== generation) throw refuse();
    };
    let staged = dataFile(temporary, record, refuse, true);
    let published = dataFile(target, record, refuse, true);
    if (staged !== null) {
      if (published === null) {
        if (staged.nlink !== 1n) throw refuse();
        check();
        if (version(information(temporary)) !== version(staged)) throw refuse();
        fs.linkSync(temporary, target);
        fs.fsyncSync(parent.fd);
        staged = dataFile(temporary, record, refuse);
        published = dataFile(target, record, refuse);
      }
      if (staged.nlink !== 2n || published.nlink !== 2n || version(staged) !== version(published)) throw refuse();
      check();
      if (version(information(temporary)) !== version(staged) || version(information(target)) !== version(published)) throw refuse();
      fs.unlinkSync(temporary);
      fs.fsyncSync(parent.fd);
      published = dataFile(target, record, refuse);
    }
    if (published === null || published.nlink !== 1n) throw refuse();
    check();
    if (version(information(target)) !== version(published)) throw refuse();
    fs.unlinkSync(journal);
    fs.fsyncSync(parent.fd);
    current();
  }
}

export function publishNativeGeminiExclusive(parent, name, temporary, content, current, refuse) {
  const match = new RegExp(`^\\.history-(${uuid})\\.tmp$`, 'u').exec(path.basename(temporary));
  if (!match || path.dirname(temporary) !== parent.anchor || !permitted(parent, name)) throw refuse();
  const info = information(temporary);
  if (!owned(info) || info.nlink !== 1n || info.size > BigInt(LIMIT)) throw refuse();
  const record = { version: 1, name, device: info.dev.toString(), inode: info.ino.toString(), size: Number(info.size), digest: digest(content) };
  dataFile(temporary, record, refuse);
  const journal = `${parent.anchor}/.publish-${match[1]}.json`;
  let fd;
  try {
    current();
    fd = fs.openSync(journal, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, JSON.stringify(record));
    const generation = version(fs.fstatSync(fd, { bigint: true }));
    const checked = () => {
      current();
      const opened = fs.fstatSync(fd, { bigint: true });
      const named = information(journal);
      if (!owned(opened) || opened.nlink !== 1n || version(opened) !== generation || version(named) !== generation) throw refuse();
    };
    fs.fsyncSync(fd);
    fs.fsyncSync(parent.fd);
    checked();
    if (version(dataFile(temporary, record, refuse)) !== version(info)) throw refuse();
    fs.linkSync(temporary, `${parent.anchor}/${name}`);
    fs.fsyncSync(parent.fd);
    checked();
    const staged = dataFile(temporary, record, refuse);
    const published = dataFile(`${parent.anchor}/${name}`, record, refuse);
    if (staged.nlink !== 2n || published.nlink !== 2n || version(staged) !== version(published)) throw refuse();
    fs.unlinkSync(temporary);
    fs.fsyncSync(parent.fd);
    checked();
    fs.unlinkSync(journal);
    fs.fsyncSync(parent.fd);
    current();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
