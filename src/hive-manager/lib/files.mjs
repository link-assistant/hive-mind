import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export async function readBoundedFile(path, limit, label, { noFollow = false, allowEmpty = false } = {}) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (noFollow ? constants.O_NOFOLLOW : 0));
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > limit) throw new Error();
      const data = Buffer.alloc(info.size + 1);
      let size = 0;
      while (size < data.length) {
        const { bytesRead } = await file.read(data, size, data.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if ((!size && !allowEmpty) || size !== info.size) throw new Error();
      return data.subarray(0, size);
    } finally {
      await file.close();
    }
  } catch {
    throw new Error(`Could not read ${label} as ${allowEmpty ? 'a' : 'a nonempty'} file of at most ${limit} bytes.`);
  }
}
