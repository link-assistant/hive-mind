// Selected native experiment only. Coordinated refresh/login/logout writers
// are the next stage; expired credentials and writes explicitly refuse here.
import { lstatSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { readNativeQwenCredentials as readNativeOAuthCredentials } from '../native-qwen/read_credentials.mjs';

const refused = () => new Error('Gemini canonical authentication is unavailable or unsafe.');
const identity = info => `${info.dev}:${info.ino}`;
const admitted = new WeakSet();
const alternateAuthorities = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_ACCESS_TOKEN', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA', 'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE'];

export const nativeGeminiSelected = () => process.env.GEMINI_AUTH_HOME !== undefined;

export function refuseNativeGeminiWriter() {
  throw refused();
}

export async function validateNativeGeminiClient(client) {
  if (!admitted.has(client)) throw refused();
  await client.getAccessToken();
}

export async function initializeNativeGeminiClient(createClient, configurationDirectory, authType) {
  try {
    if (authType !== 'oauth-personal') throw refused();
    const selected = process.env.GEMINI_AUTH_HOME;
    if (!path.isAbsolute(selected) || path.normalize(selected) !== selected || selected === path.parse(selected).root || /[\0\r\n]/u.test(selected)) throw refused();
    const initial = await fs.lstat(selected, { bigint: true });
    const privateFile = path.join(configurationDirectory, 'oauth_creds.json');
    function admission() {
      if (process.env.GEMINI_AUTH_HOME !== selected || alternateAuthorities.some(name => process.env[name] !== undefined)) throw refused();
      if (selected !== configurationDirectory) {
        try {
          lstatSync(privateFile);
        } catch (error) {
          if (error.code === 'ENOENT') return;
          throw refused();
        }
        throw refused();
      }
    }
    admission();
    const client = createClient();
    // The original async token listener writes without an awaited transaction.
    // This read-only stage must never publish through that listener.
    if (client.listenerCount('tokens') !== 1) throw refused();
    client.removeAllListeners('tokens');
    async function current() {
      try {
        admission();
        if (identity(await fs.lstat(selected, { bigint: true })) !== identity(initial) || client.apiKey || client.refreshHandler) throw refused();
        const credentials = await readNativeOAuthCredentials(path.join(selected, 'oauth_creds.json'));
        admission();
        if (identity(await fs.lstat(selected, { bigint: true })) !== identity(initial)) throw refused();
        client.setCredentials(credentials);
        if (client.isTokenExpiring()) throw refused();
      } catch {
        client.setCredentials({});
        throw refused();
      }
    }
    for (const method of ['getAccessTokenAsync', 'getRequestMetadataAsync']) {
      const original = client[method].bind(client);
      client[method] = async (...args) => {
        await current();
        return original(...args);
      };
    }
    for (const method of ['refreshToken', 'refreshTokenNoCache', 'refreshAccessTokenAsync', 'getTokenAsync', 'revokeCredentialsAsync']) client[method] = refuseNativeGeminiWriter;
    await current();
    await client.getTokenInfo(client.credentials.access_token);
    admitted.add(client);
    return client;
  } catch {
    throw refused();
  }
}
