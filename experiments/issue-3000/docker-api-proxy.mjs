#!/usr/bin/env node
// Issue #3000 experiment: a logging proxy in front of the Docker socket.
//
// Prints every API request line the docker CLI sends, so we can see whether a
// `docker ps --format ...` call asks dockerd for container sizes (`size=1`).
//
// Usage:
//   node experiments/issue-3000/docker-api-proxy.mjs /tmp/docker-proxy.sock [/var/run/docker.sock]
//   DOCKER_HOST=unix:///tmp/docker-proxy.sock docker ps -a --format '{{json .}}'
import fs from 'node:fs';
import net from 'node:net';

const listenPath = process.argv[2] || '/tmp/docker-proxy.sock';
const upstreamPath = process.argv[3] || '/var/run/docker.sock';
try {
  fs.unlinkSync(listenPath);
} catch {
  /* not there */
}

net
  .createServer(client => {
    const upstream = net.createConnection(upstreamPath);
    let head = '';
    client.on('data', chunk => {
      if (head.length < 4096) {
        head += chunk.toString('latin1');
        for (const line of head.split('\r\n')) {
          if (/^(GET|POST|HEAD|DELETE|PUT) /.test(line)) console.log(`[docker-api] ${line}`);
        }
        head = head.slice(head.lastIndexOf('\r\n') + 2);
      }
      upstream.write(chunk);
    });
    upstream.on('data', chunk => client.write(chunk));
    client.on('end', () => upstream.end());
    upstream.on('end', () => client.end());
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  })
  .listen(listenPath, () => console.log(`[docker-api] proxy ${listenPath} -> ${upstreamPath}`));
