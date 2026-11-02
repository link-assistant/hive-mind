// Pinned native Qwen experiment; all participating native writers share this
// provider-namespaced transaction engine. Production does not install it yet.
import { lstatSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createNativeOAuthTransaction } from '../native-oauth-transaction.mjs';
import { readNativeQwenCredentials } from './read_credentials.mjs';

const refused = () => new Error('Qwen canonical authentication is unavailable or unsafe.');
const transaction = createNativeOAuthTransaction({ provider: 'qwen', readCredentials: readNativeQwenCredentials });
export const nativeQwenTransactionActive = transaction.isActive;
export const withNativeQwenTransaction = transaction.withTransaction;

export function nativeQwenCredentialPath(configurationDirectory) {
  const selected = process.env.QWEN_AUTH_HOME;
  if (selected === undefined) return path.join(configurationDirectory, 'oauth_creds.json');
  if (!path.isAbsolute(selected) || path.normalize(selected) !== selected || selected === path.parse(selected).root || /[\0\r\n]/u.test(selected)) throw refused();
  if (selected !== configurationDirectory) {
    try {
      lstatSync(path.join(configurationDirectory, 'oauth_creds.json'));
    } catch (error) {
      if (error.code === 'ENOENT') return path.join(selected, 'oauth_creds.json');
      throw refused();
    }
    // A second native authority is a conflict, including an identical copy or
    // a symlink. Never copy, merge, delete or silently prefer one of them.
    throw refused();
  }
  return path.join(selected, 'oauth_creds.json');
}
