/** Admit selected native storage and executable bytes before Gemini probes. */
import os from 'node:os';
import console from 'node:console';
import { admitGeminiCanonicalStorage, nativeGeminiStorageRefusal as refused } from './gemini-canonical-storage.lib.mjs';
import { verifyNativeGeminiCommand } from './native-gemini-command.lib.mjs';
import { isRouterAuthGuardRequired } from './router-auth-guard.lib.mjs';

/** Retain the returned admission across preparation, retries and resume. */
export async function admitNativeGeminiStorage({ env = process.env, homeDir = os.homedir(), command = 'gemini', expected, useRouter = false } = {}) {
  let phase = 'authority selection';
  try {
    if (useRouter || isRouterAuthGuardRequired(env)) {
      if (expected) throw refused();
      return null;
    }
    phase = 'selected directory and credential admission';
    const admitted = await admitGeminiCanonicalStorage({ env, homeDir, expected });
    if (!admitted) return null;
    phase = 'native executable byte admission';
    const verified = await verifyNativeGeminiCommand({ command, searchPath: env.PATH });
    if (expected && expected.command !== verified.entrypoint) throw refused();
    phase = 'final selected directory and credential admission';
    const current = await admitGeminiCanonicalStorage({ env, homeDir, expected: admitted });
    return { ...current, command: verified.entrypoint };
  } catch {
    if (process.env.HIVE_MIND_NATIVE_GEMINI_STORAGE_DEBUG === '1') console.error(`[native-gemini-storage] Refused during ${phase}.`);
    throw refused();
  }
}
