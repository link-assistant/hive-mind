import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareStorageDirectory } from './storage-directory.lib.mjs';

// Qwen loads generated workflow scripts from the same runtime tree as chats.
// Allocate a new directory for every task, even when its name is reused.
export async function createQwenTaskRuntime({ homeDir = os.homedir(), io = fs } = {}) {
  const parent = path.join(homeDir, '.hive-mind', 'task-data', 'qwen');
  await prepareStorageDirectory(parent, { io });
  return io.mkdtemp(path.join(parent, 'task-'));
}
