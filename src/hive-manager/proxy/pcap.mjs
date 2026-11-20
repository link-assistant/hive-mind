import { parseArgs } from 'node:util';
import { readBoundedFile } from '../lib/files.mjs';

const captureLimit = 3 * 1024 * 1024;
const packetLimit = 10_000;
const usage = `Usage: hive-manager proxy-pcap [--port PORT] CLIENT_CAPTURE [SERVER_CAPTURE]
Summarize TCP flows in one or two bounded tcpdump captures taken on port PORT (default: 443).
For a comparison, collect both captures during the same probe window on its external interfaces.
`;

function ipOffset(packet, link) {
  if (link === 1 && packet.length >= 14) {
    const type = packet.readUInt16BE(12);
    if (type === 0x0800 || type === 0x86dd) return 14;
    if ((type === 0x8100 || type === 0x88a8) && packet.length >= 18) return 18;
  }
  return { 0: 4, 101: 0, 108: 4, 113: 16, 276: 20 }[link] ?? null;
}

function parsePacket(packet, ip, port) {
  const version = packet[ip] >> 4;
  let tcp, addressSize, source, remaining;
  if (version === 4 && packet.length >= ip + 20 && packet[ip + 9] === 6 && (packet.readUInt16BE(ip + 6) & 0x3fff) === 0) {
    const header = (packet[ip] & 15) * 4;
    if (header < 20) return null;
    tcp = ip + header;
    addressSize = 4;
    source = ip + 12;
    remaining = packet.readUInt16BE(ip + 2) - header;
  } else if (version === 6 && packet.length >= ip + 40 && packet[ip + 6] === 6) {
    tcp = ip + 40;
    addressSize = 16;
    source = ip + 8;
    remaining = packet.readUInt16BE(ip + 4);
  } else return null;
  if (remaining < 20 || packet.length < tcp + 20) return null;
  const sourcePort = packet.readUInt16BE(tcp);
  const destinationPort = packet.readUInt16BE(tcp + 2);
  if ((sourcePort === port) === (destinationPort === port)) return null;
  const header = (packet[tcp + 12] >> 4) * 4;
  if (header < 20 || header > remaining) return null;
  const fromProxy = sourcePort === port;
  const first = `${packet.toString('hex', source, source + addressSize)}:${sourcePort}`;
  const second = `${packet.toString('hex', source + addressSize, source + 2 * addressSize)}:${destinationPort}`;
  return {
    flow: fromProxy ? `${second}/${first}` : `${first}/${second}`,
    direction: fromProxy ? 'proxyToClient' : 'clientToProxy',
    seq: packet.readUInt32BE(tcp + 4),
    ack: packet.readUInt32BE(tcp + 8),
    flags: packet[tcp + 13],
    payload: remaining - header,
  };
}

function summarize(raw, port) {
  if (raw.length < 24) throw new Error('The capture header is incomplete.');
  const magic = raw.readUInt32LE(0);
  const little = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  if (!little && magic !== 0xd4c3b2a1 && magic !== 0x4d3cb2a1) throw new Error('Expected classic tcpdump pcap format.');
  const u32 = offset => (little ? raw.readUInt32LE(offset) : raw.readUInt32BE(offset));
  const link = u32(20) & 0xffff;
  if (![0, 1, 101, 108, 113, 276].includes(link)) throw new Error('Unsupported pcap link format.');
  const counters = () => ({ packets: 0, wirePayloadBytes: 0, firstSeenPayloadBytes: 0, repeatedSegments: 0, repeatedAcks: 0, syns: 0, synAcks: 0, resets: 0 });
  const summary = { flows: 0, capturedPackets: 0, clientToProxy: counters(), proxyToClient: counters() };
  const flows = new Map();
  for (let offset = 24; offset < raw.length;) {
    if (offset + 16 > raw.length) throw new Error('The capture ends inside a packet header.');
    const size = u32(offset + 8);
    offset += 16;
    if (size > raw.length - offset) throw new Error('The capture ends inside a packet.');
    if (++summary.capturedPackets > packetLimit) throw new Error(`The capture exceeds ${packetLimit} packets.`);
    const packet = raw.subarray(offset, offset + size);
    offset += size;
    const ip = ipOffset(packet, link);
    const parsed = ip === null ? null : parsePacket(packet, ip, port);
    if (!parsed) continue;
    const { flow, direction, seq, ack, flags, payload } = parsed;
    if (!flows.has(flow)) flows.set(flow, { clientToProxy: { segments: new Set() }, proxyToClient: { segments: new Set() } });
    const state = flows.get(flow)[direction];
    const stats = summary[direction];
    const syn = Boolean(flags & 2);
    const acked = Boolean(flags & 16);
    stats.packets++;
    if (syn) stats[acked ? 'synAcks' : 'syns']++;
    if (flags & 4) stats.resets++;
    if (payload > 0) {
      const segment = `${seq}:${payload}`;
      stats.wirePayloadBytes += payload;
      if (state.segments.has(segment)) stats.repeatedSegments++;
      else {
        state.segments.add(segment);
        stats.firstSeenPayloadBytes += payload;
      }
    }
    if (acked && !syn && !(flags & 5) && payload === 0) {
      if (state.ack === ack) stats.repeatedAcks++;
      state.ack = ack;
    } else state.ack = undefined;
  }
  summary.flows = flows.size;
  return summary;
}

async function inspect() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, port: { type: 'string', default: '443' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (!positionals.length || positionals.length > 2) throw new Error('Specify a capture and optionally its peer capture.');
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  const [clientCapture, serverCapture] = positionals;
  const client = summarize(await readBoundedFile(clientCapture, captureLimit, 'client capture'), port);
  const result = { port, client };
  if (serverCapture) {
    const server = summarize(await readBoundedFile(serverCapture, captureLimit, 'server capture'), port);
    result.server = server;
    result.observedPayloadDifference = {
      clientToProxy: client.clientToProxy.firstSeenPayloadBytes - server.clientToProxy.firstSeenPayloadBytes,
      proxyToClient: server.proxyToClient.firstSeenPayloadBytes - client.proxyToClient.firstSeenPayloadBytes,
    };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  await inspect();
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
