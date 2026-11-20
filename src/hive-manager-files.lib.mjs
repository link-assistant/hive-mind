import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export async function readBoundedFile(path, limit, label) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) throw new Error();
      const data = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < data.length) {
        const { bytesRead } = await file.read(data, size, data.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size < 1 || size > limit) throw new Error();
      return data.subarray(0, size);
    } finally {
      await file.close();
    }
  } catch {
    throw new Error(`Could not read ${label} as a nonempty file of at most ${limit} bytes.`);
  }
}
