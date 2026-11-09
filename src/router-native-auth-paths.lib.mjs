// Native credential selectors from the pinned Agent/OpenCode/Gemini/Qwen CLIs.
// Relative paths belong to the native command's cwd, including XDG roots.
import path from 'node:path';

export function routerNativeCredentialFiles({ tool, env, homeDir, cwd }) {
  if (['agent', 'opencode'].includes(tool)) {
    const data = path.join(homeDir, '.local', 'share');
    const app = tool === 'agent' ? 'link-assistant-agent' : 'opencode';
    return [...new Set([data, env.XDG_DATA_HOME || data].map(root => path.resolve(cwd, root, app, 'auth.json')))];
  }
  if (!['gemini', 'qwen'].includes(tool)) return [];
  const roots = [path.join(homeDir, `.${tool}`)];
  if (tool === 'gemini') roots.push(path.join(env.GEMINI_CLI_HOME || homeDir, '.gemini'));
  else if (env.QWEN_HOME) {
    let root = env.QWEN_HOME;
    if (root === '~' || root.startsWith('~/') || root.startsWith('~\\'))
      root = path.join(
        homeDir,
        ...root
          .slice(2)
          .split(/[/\\]+/)
          .filter(Boolean)
      );
    roots.push(root);
  }
  // Reserved native AUTH_HOME experiments also reject malformed selection.
  const auth = env[`${tool.toUpperCase()}_AUTH_HOME`];
  if (auth !== undefined) {
    if (!path.isAbsolute(auth) || path.normalize(auth) !== auth || auth === path.parse(auth).root || /[\0\r\n]/u.test(auth)) throw new Error('Unsafe native authentication directory selector');
    roots.push(auth);
  }
  return [...new Set(roots.map(root => path.resolve(cwd, root, 'oauth_creds.json')))];
}
