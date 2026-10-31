/** Native selectors must describe the same authority at every launch stage. */
import { codexAuthDockerProjection } from './codex-auth-docker.lib.mjs';
import { claudeAuthDockerProjection } from './claude-auth-docker.lib.mjs';

export async function nativeAuthDockerProjection(options) {
  return (await codexAuthDockerProjection(options)) || (await claudeAuthDockerProjection(options));
}
