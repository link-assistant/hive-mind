import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { forEachLogBlock } from '../../../log-sanitize-stream.lib.mjs';
import { sanitizeForPublication } from '../../../token-sanitization.lib.mjs';
import { ArchiveLimitError, numberedPart, transcriptPartBytes } from './limits.mjs';
import { redactArchiveIdentity } from './privacy.mjs';

export async function stageTranscriptParts({ sourcePath, output, archive, budget, redactions, openSource }) {
  const stem = archive.slice(0, -'.jsonl'.length);
  const parts = [];
  let dest;
  let used = 0;
  let bytes = 0;
  let pending = Buffer.alloc(0);

  async function closePart() {
    if (dest) await dest.close();
    dest = null;
    used = 0;
  }

  async function write(data) {
    if (bytes + data.length > budget.bytes) throw new ArchiveLimitError('batch-budget');
    if (!dest) {
      if (parts.length >= budget.files) throw new ArchiveLimitError('batch-budget');
      const archive = numberedPart(stem, parts.length + 1, 'jsonl');
      dest = await open(join(output, archive), 'wx', 0o600);
      parts.push({ archive });
    }
    for (let offset = 0; offset < data.length;) {
      const { bytesWritten } = await dest.write(data, offset, data.length - offset);
      if (!bytesWritten) throw new Error('Could not write a transcript part.');
      offset += bytesWritten;
    }
    used += data.length;
    bytes += data.length;
  }

  async function writeRecords(chunk) {
    let data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (data.length) {
      const remaining = transcriptPartBytes - used;
      const end = remaining > 0 ? data.lastIndexOf(10, Math.min(remaining, data.length) - 1) + 1 : 0;
      if (end) {
        await write(data.subarray(0, end));
        data = data.subarray(end);
      } else if (data.length <= remaining) {
        break;
      } else if (used) {
        await closePart();
      } else {
        throw new ArchiveLimitError('oversized-record');
      }
    }
    pending = data;
  }

  try {
    const stats = await forEachLogBlock(
      sourcePath,
      async text => {
        const sanitized = await sanitizeForPublication(redactions ? redactions.redact(text) : text);
        await writeRecords(Buffer.from(redactArchiveIdentity(sanitized), 'utf8'));
      },
      { fsImpl: { open: openSource }, maxHoldBytes: transcriptPartBytes }
    );
    if (stats.forcedReleases) throw new ArchiveLimitError('oversized-record');
    if (pending.length) await write(pending);
    if (!parts.length) await write(pending);
    await closePart();
    for (const part of parts) await redactions?.assertCleanFile(join(output, part.archive));
    return parts;
  } finally {
    await dest?.close();
  }
}
