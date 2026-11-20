import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

const evidenceBytes = 4 * 1024 * 1024;

export async function readAttemptEvidence(file, start, end, maxBytes = evidenceBytes) {
  if (!file || start === null || end === null) return { available: false };
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = await handle.stat();
    const stop = Math.min(info.size, end);
    if (!info.isFile() || stop <= start) return { available: false };
    const offset = Math.max(start, stop - maxBytes);
    const buffer = Buffer.alloc(stop - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead !== buffer.length) return { available: false };
    const excerpt = buffer.toString('utf8');
    const firstNewline = excerpt.indexOf('\n');
    const text = offset === start ? excerpt : firstNewline < 0 ? '' : excerpt.slice(firstNewline + 1);
    return { available: true, bounded: offset > start, text };
  } catch {
    return { available: false };
  } finally {
    await handle?.close();
  }
}

function repeatedCount(text, pattern, minimum) {
  const counts = new Map();
  for (const match of text.matchAll(pattern)) {
    if (counts.size >= 4096 && !counts.has(match[1])) continue;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.values()]
    .filter(count => count >= minimum)
    .sort((a, b) => b - a)
    .slice(0, 3);
}

export function summarizeTaskEvidence({ available, bounded, text = '' }, attempt) {
  let signature;
  if (attempt.exitCode > 0) {
    if (attempt.exitCode === 127 && /^\s*\/[\w-]+\s/.test(attempt.command || '')) signature = 'alias-127';
    else if (/no rollout found for thread id/i.test(text)) signature = 'codex-no-rollout';
    else if (text.includes('Result event received') && text.includes('Stream timeout') && text.includes('failed with exit code 143')) signature = 'stream-close-timeout';
    else if (/Codex (?:exited|command failed) with exit code 137/.test(text) && (attempt.oomKilled === true || attempt.memoryExhausted === true || /oom_kill=[1-9]|OOM killer has killed [1-9]|"oomKills":\s*[1-9]/.test(text))) signature = 'codex-oom';
  }
  if (!available) return { available, signature };
  const output = text.split('\n').filter(line => !/^\s*(?:[[{}"\]]|[-+]\s)|"\w+"\s*:/.test(line));
  const turns = output.reduce((maximum, line) => Math.max(maximum, Number(/Session num_turns:\s*(\d{1,8})\b/.exec(line)?.[1] ?? 0)), 0);
  const noChanges = output.some(line => /^(?:\S+Z\s+)?\s*(?:💬 Posted:\s*)?No changes were produced\b/.test(line));
  const retries = output.filter(line => /Retry \d+ in .{1,240}\(session preserved\b/.test(line)).length;
  const reconnects = output.filter(line => line.includes('Reconnecting... waiting for network')).length;
  const repeatedCommands = repeatedCount(text, /"(?:command|cmd)"\s*:\s*"((?:[^"\\\n]|\\.){1,500})"/g, 20);
  const repeatedToolCalls = repeatedCount(text, /"type"\s*:\s*"mcp_tool_call"[^\n]{0,200}?("server"\s*:\s*"[^"\n]{1,100}"[^\n]{0,100}?"tool"\s*:\s*"[^"\n]{1,200}"[^\n]{0,100}?"arguments"\s*:\s*\{[^{}\n]{0,300}\})/g, 20);
  const repeatedMessages = repeatedCount(text, /"type"\s*:\s*"agent_message"[^\n]{0,200}?"text"\s*:\s*"((?:[^"\\\n]|\\.){1,300})"/g, 10);
  return { available, bounded, signature, turns, noChanges, possibleFalseSuccess: attempt.exitCode === 0 && (noChanges || (turns >= 1 && turns <= 2)), retries, reconnects, repeatedCommands, repeatedToolCalls, repeatedMessages };
}
