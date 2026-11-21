// Bound directory discovery and validate data-only native loose-object graphs.
import fs from 'node:fs';
import { TextDecoder } from 'node:util';

const decode = new TextDecoder('utf-8', { fatal: true });

export function nativeGitObjectNames(directory, limit, refuse) {
  const names = [];
  const handle = fs.opendirSync(directory, { bufferSize: 16 });
  try {
    for (let entry; (entry = handle.readSync()) !== null;) {
      if (names.length >= limit) throw refuse();
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return names;
}

export function nativeGitObjectMetadata(bytes, refuse) {
  const boundary = bytes.indexOf(0);
  if (boundary < 0 || boundary > 64) throw refuse();
  const match = /^(blob|tree|commit) (0|[1-9][0-9]*)$/u.exec(decode.decode(bytes.subarray(0, boundary)));
  const content = bytes.subarray(boundary + 1);
  if (!match || Number(match[2]) !== content.length) throw refuse();
  const type = match[1];
  const edges = [];
  if (type === 'commit') {
    const end = content.indexOf('\n\n');
    if (end < 0 || end > 65536) throw refuse();
    const lines = decode.decode(content.subarray(0, end)).split('\n');
    if (!/^tree [a-f0-9]{40}$/u.test(lines[0])) throw refuse();
    edges.push([lines[0].slice(5), 'tree']);
    for (const line of lines.slice(1)) {
      if (line.startsWith('parent ')) {
        if (!/^parent [a-f0-9]{40}$/u.test(line)) throw refuse();
        edges.push([line.slice(7), 'commit']);
      }
    }
  } else if (type === 'tree') {
    const seen = new Set();
    for (let offset = 0; offset < content.length;) {
      const space = content.indexOf(32, offset);
      const nul = content.indexOf(0, space + 1);
      if (space < offset || space - offset > 6 || nul <= space + 1 || nul + 21 > content.length) throw refuse();
      const mode = content.subarray(offset, space).toString('ascii');
      if (!['40000', '100644', '100755', '120000', '160000'].includes(mode)) throw refuse();
      const name = content.subarray(space + 1, nul);
      const key = name.toString('hex');
      if (name.includes(47) || key === '2e' || key === '2e2e' || seen.has(key)) throw refuse();
      seen.add(key);
      // Gitlinks name commits in other repositories; they are never followed.
      if (mode !== '160000') edges.push([content.subarray(nul + 1, nul + 21).toString('hex'), mode === '40000' ? 'tree' : 'blob']);
      if (edges.length > 10000) throw refuse();
      offset = nul + 21;
    }
  }
  return { type, edges };
}

export function assertNativeGitObjectGraph(objects, required, refuse) {
  const visited = new Set();
  const queue = required.map(name => [name, 'commit']);
  for (let offset = 0; offset < queue.length; offset++) {
    const [name, type] = queue[offset];
    const object = objects.get(name);
    if (!object || object.type !== type) throw refuse();
    if (visited.has(name)) continue;
    visited.add(name);
    if (visited.size > 10000 || queue.length + object.edges.length > 200000) throw refuse();
    queue.push(...object.edges);
  }
}
