import fs from 'node:fs/promises';
import { readLogHeadText } from './log-bounded-read.lib.mjs';

// A final message is normally a few hundred KB; malformed artifacts must not
// become unbounded strings after a long run (issue #2189).
export const CODEX_LAST_MESSAGE_MAX_BYTES = 1024 * 1024;
export async function readCodexLastMessage(lastMessageFile) {
  try {
    const { size } = await fs.stat(lastMessageFile);
    const lastMessage = size > CODEX_LAST_MESSAGE_MAX_BYTES ? `${(await readLogHeadText(lastMessageFile, { maxBytes: CODEX_LAST_MESSAGE_MAX_BYTES })).trim()}\n…[last message truncated: ${size} bytes on disk, see ${lastMessageFile}]` : (await fs.readFile(lastMessageFile, 'utf8')).trim();
    return { lastMessage, readError: null };
  } catch (readError) {
    return { lastMessage: null, readError };
  }
}
