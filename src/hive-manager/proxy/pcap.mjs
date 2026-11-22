import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readBoundedFile } from '../lib/files.mjs';
import { directionState, recordAck, recordAckGap, recordPayload } from './tcp.mjs';

const captureLimit = 3 * 1024 * 1024;
const packetLimit = 10_000;
const usage = `Usage: hive-manager proxy-pcap [--port PORT] [--probe PROXY_TEST_JSON] CLIENT_CAPTURE [SERVER_CAPTURE]
       hive-manager proxy-pcap --compare BEFORE_JSON AFTER_JSON
Summarize TCP flows in one or two bounded tcpdump captures taken on port PORT (default: 443).
Collect both captures on external interfaces during the same probe window.
Use --compare for saved capture reports or proxy-test results from different runs.
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

export function summarize(raw, port) {
  if (raw.length < 24) throw new Error('The capture header is incomplete.');
  const magic = raw.readUInt32LE(0);
  const little = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  if (!little && magic !== 0xd4c3b2a1 && magic !== 0x4d3cb2a1) throw new Error('Expected classic tcpdump pcap format.');
  const u32 = offset => (little ? raw.readUInt32LE(offset) : raw.readUInt32BE(offset));
  const link = u32(20) & 0xffff;
  if (![0, 1, 101, 108, 113, 276].includes(link)) throw new Error('Unsupported pcap link format.');
  const counters = () => ({ packets: 0, wirePayloadBytes: 0, firstSeenPayloadBytes: 0, repeatedSegments: 0, repeatedPayloadBytes: 0, repeatedAcks: 0, syns: 0, synAcks: 0, resets: 0, ackGapMax: 0, ackGapSum: 0, ackGapFlows: 0, ackGapComparableFlows: 0 });
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
    if (!flows.has(flow)) flows.set(flow, { clientToProxy: directionState(), proxyToClient: directionState() });
    const directions = flows.get(flow);
    const state = directions[direction];
    const peer = directions[direction === 'clientToProxy' ? 'proxyToClient' : 'clientToProxy'];
    const stats = summary[direction];
    const syn = Boolean(flags & 2);
    const acked = Boolean(flags & 16);
    stats.packets++;
    if (syn) stats[acked ? 'synAcks' : 'syns']++;
    if (flags & 4) stats.resets++;
    if (payload > 0) {
      const repeated = recordPayload(state, syn ? (seq + 1) >>> 0 : seq, payload);
      stats.wirePayloadBytes += payload;
      stats.firstSeenPayloadBytes += payload - repeated;
      if (repeated > 0) stats.repeatedSegments++;
      stats.repeatedPayloadBytes += repeated;
    }
    if (acked && !(flags & 4)) recordAck(peer, ack);
    if (acked && !syn && !(flags & 5) && payload === 0) {
      if (state.lastAck === ack) stats.repeatedAcks++;
      state.lastAck = ack;
    } else state.lastAck = null;
  }
  for (const states of flows.values()) {
    for (const direction of ['clientToProxy', 'proxyToClient']) recordAckGap(summary[direction], states[direction]);
  }
  summary.flows = flows.size;
  return summary;
}

function probeResults(probe) {
  const routes = Array.isArray(probe?.results) ? probe.results : [probe];
  if (routes.length < 1 || routes.length > 12) throw new Error('Expected a proxy-test JSON result.');
  const result = {};
  for (const entry of routes) {
    const name = entry?.name ?? 'probe';
    if (typeof name !== 'string' || !/^[a-z\d][a-z\d-]{0,47}$/.test(name) || Object.hasOwn(result, name) || !['direct', 'proxy'].includes(entry?.route) || (entry.ok !== false && (typeof entry.text !== 'boolean' || typeof entry.cleaned !== 'boolean' || ![entry.document, entry.photo].every(bytes => bytes === null || (Number.isSafeInteger(bytes) && bytes > 0))))) {
      throw new Error('Expected a proxy-test JSON result.');
    }
    Object.defineProperty(result, name, { enumerable: true, value: entry.ok === false ? { route: entry.route, ok: false } : { route: entry.route, ok: true, text: entry.text, document: entry.document, photo: entry.photo, cleaned: entry.cleaned } });
  }
  return result;
}

async function readReport(file) {
  return JSON.parse((await readBoundedFile(file, 256 * 1024, 'proxy comparison report')).toString('utf8'));
}

function reportFields(report) {
  if (report?.client) {
    const fields = {};
    for (const side of ['client', 'server']) {
      if (!report[side]) continue;
      for (const [key, value] of Object.entries(report[side])) {
        if (typeof value === 'number') fields[`${side}.${key}`] = value;
        else if (['clientToProxy', 'proxyToClient'].includes(key)) {
          for (const [metric, count] of Object.entries(value ?? {})) {
            if (typeof count === 'number') fields[`${side}.${key}.${metric}`] = count;
          }
        }
      }
    }
    for (const [direction, bytes] of Object.entries(report.observedPayloadDifference ?? {})) {
      if (typeof bytes === 'number') fields[`observedPayloadDifference.${direction}`] = bytes;
    }
    for (const [name, probe] of Object.entries(report.probe ?? {})) addProbeFields(fields, name, probe);
    return fields;
  }
  const fields = {};
  for (const [name, probe] of Object.entries(probeResults(report))) addProbeFields(fields, name, probe);
  return fields;
}

function addProbeFields(fields, name, probe) {
  for (const key of ['route', 'ok', 'text', 'document', 'photo', 'cleaned']) {
    if (typeof probe?.[key] === 'string' || typeof probe?.[key] === 'boolean' || typeof probe?.[key] === 'number' || probe?.[key] === null) {
      fields[`probe.${name}.${key}`] = probe[key];
    }
  }
}

export function compareProxyReports(before, after) {
  const left = reportFields(before);
  const right = reportFields(after);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().map(metric => {
    const previous = left[metric] ?? null;
    const current = right[metric] ?? null;
    return {
      metric,
      before: previous,
      after: current,
      observedBefore: Object.hasOwn(left, metric),
      observedAfter: Object.hasOwn(right, metric),
      delta: typeof current === 'number' && typeof previous === 'number' ? current - previous : null,
    };
  });
}

async function inspect() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, port: { type: 'string' }, probe: { type: 'string' }, compare: { type: 'boolean' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (values.compare) {
    if (positionals.length !== 2 || values.port || values.probe) throw new Error('Specify two reports for --compare.');
    const [before, after] = positionals;
    const metrics = compareProxyReports(await readReport(before), await readReport(after));
    process.stdout.write(`${JSON.stringify({ metrics }, null, 2)}\n`);
    return;
  }
  if (!positionals.length || positionals.length > 2) throw new Error('Specify a capture and optionally its peer capture.');
  const portOption = values.port ?? '443';
  const port = Number(portOption);
  if (!/^\d+$/.test(portOption) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  const [clientCapture, serverCapture] = positionals;
  const client = summarize(await readBoundedFile(clientCapture, captureLimit, 'client capture'), port);
  const result = { port, client };
  if (values.probe) result.probe = probeResults(await readReport(values.probe));
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await inspect();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
