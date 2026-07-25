import os from 'node:os';
import path from 'node:path';

/**
 * Docker task filesystems are isolated, so every task can safely use the same
 * in-container checkout path. Stable paths keep Cargo and sccache cache keys
 * identical across independent containers.
 */
export function resolveDockerTaskWorkspaceRoot({ env = process.env, tmpDir = os.tmpdir() } = {}) {
  return env.HIVE_MIND_PARENT_SESSION_ID ? path.join(tmpDir, 'hive-mind-docker-task-workspace') : null;
}
