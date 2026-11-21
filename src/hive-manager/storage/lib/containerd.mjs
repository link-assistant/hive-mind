import { connect } from 'node:http2';
import { createConnection } from 'node:net';

const mountsMethod = '/containerd.services.snapshots.v1.Snapshots/Mounts';
const maxResponseBytes = 64 * 1024;

function readVarint(buffer, offset) {
  let value = 0;
  for (let shift = 0; shift < 35 && offset < buffer.length; shift += 7) {
    const byte = buffer[offset++];
    value += (byte & 127) * 2 ** shift;
    if (byte < 128) return [value, offset];
  }
  throw new Error('Invalid containerd snapshot metadata.');
}

// Both MountsResponse and its nested Mount messages contain only length-delimited fields.
function* fields(buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, lengthOffset] = readVarint(buffer, offset);
    const [length, start] = readVarint(buffer, lengthOffset);
    offset = start + length;
    if (tag % 8 !== 2 || tag < 8 || offset > buffer.length) throw new Error('Invalid containerd snapshot metadata.');
    yield [tag >> 3, buffer.subarray(start, offset)];
  }
}

function upperOption(body) {
  if (body.length < 5 || body[0] !== 0 || body.readUInt32BE(1) !== body.length - 5) throw new Error('Invalid containerd snapshot response.');
  for (const [field, mount] of fields(body.subarray(5))) {
    if (field !== 1) continue;
    let type;
    let upper;
    for (const [number, data] of fields(mount)) {
      const value = data.toString('utf8');
      if (number === 1) type = value;
      if (number === 4 && value.startsWith('upperdir=')) upper = value.slice(9);
    }
    if (['overlay', 'fuse.overlayfs'].includes(type) && upper) return upper;
  }
  return null;
}

// Query only the mount specification. Newer ctr versions also activate mounts.
export async function snapshotUpper(socket, id, { ms = 5000, check } = {}) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid Docker snapshot key.');
  check?.();
  // A gRPC frame with the snapshotter (field 1) and container ID (field 2).
  const payload = Buffer.from(`\x0a\x09overlayfs\x12\x40${id}`);
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  const client = connect('http://localhost', { createConnection: () => createConnection(socket) });
  client.on('error', () => {}); // The request surfaces connection failures.
  const timeout = setTimeout(() => client.destroy(new Error('Containerd snapshot lookup exceeded its time budget.')), ms);
  const guard =
    check &&
    setInterval(() => {
      try {
        check();
      } catch (error) {
        client.destroy(error);
      }
    }, 500);
  try {
    const stream = client.request({ ':method': 'POST', ':path': mountsMethod, 'content-type': 'application/grpc', 'containerd-namespace': 'moby', 'grpc-timeout': `${ms}m`, te: 'trailers' });
    let status;
    const getStatus = headers => {
      status = headers['grpc-status'] ?? status;
    };
    stream.on('response', getStatus);
    stream.on('trailers', getStatus);
    stream.end(Buffer.concat([header, payload]));
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > maxResponseBytes) throw new Error('Containerd snapshot response exceeded its size limit.');
      chunks.push(chunk);
    }
    check?.();
    if (status !== '0') throw new Error('Containerd snapshot mount metadata is unavailable.');
    return upperOption(Buffer.concat(chunks));
  } finally {
    clearTimeout(timeout);
    clearInterval(guard);
    client.destroy();
  }
}
