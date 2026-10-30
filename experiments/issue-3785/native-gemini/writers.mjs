// Selected native experiment: coordinate refreshed headers and the inspected
// cache/logout entrypoints. Auth-code login and revocation remain unavailable.
import { createNativeOAuthTransaction } from '../native-oauth-transaction.mjs';
import { readNativeQwenCredentials as readCredentials } from '../native-qwen/read_credentials.mjs';

const { withTransaction } = createNativeOAuthTransaction({ provider: 'gemini', readCredentials });
const refused = () => new Error('Gemini canonical authentication is unavailable or unsafe.');
let authority;

function register(file, rootIdentity, assertAdmission) {
  if (authority && (authority.file !== file || authority.rootIdentity !== rootIdentity)) throw refused();
  authority = { file, rootIdentity, assertAdmission };
}

export async function publishNativeGeminiCredentials(credentials) {
  if (!authority) throw refused();
  const { file, assertAdmission } = authority;
  await assertAdmission();
  return withTransaction(file, async transaction => {
    await assertAdmission();
    return transaction.write(credentials);
  });
}

export async function clearNativeGeminiCredentials() {
  if (!authority) throw refused();
  const { file, assertAdmission } = authority;
  await assertAdmission();
  return withTransaction(file, async transaction => {
    await assertAdmission();
    await transaction.remove();
  });
}

export function bindNativeGeminiWriters(client, { file, rootIdentity, assertAdmission }) {
  register(file, rootIdentity, assertAdmission);
  // Capture the actual native HTTP exchange before replacing every inspected
  // refresh entrypoint. Its unawaited token listener was removed by read admission.
  const exchange = client.refreshTokenNoCache.bind(client);
  async function refresh(force = false, predecessor) {
    try {
      await assertAdmission();
      const requested = await readCredentials(file);
      const credentials = await withTransaction(file, async transaction => {
        await assertAdmission();
        const current = await transaction.snapshot();
        await transaction.reconcile(current);
        client.setCredentials(current.credentials);
        const newer = requested.refresh_token !== current.credentials.refresh_token || requested.access_token !== current.credentials.access_token;
        const explicitOldPredecessor = predecessor !== undefined && predecessor !== current.credentials.refresh_token;
        if (!client.isTokenExpiring() && (!force || newer || explicitOldPredecessor)) return current.credentials;
        if (explicitOldPredecessor) throw refused();
        await transaction.beginRefresh(current);
        const response = await exchange(current.credentials.refresh_token);
        await assertAdmission();
        // Google may rotate or retain the refresh token. Never let the native
        // wrapper overwrite a provider replacement with its cached predecessor.
        const tokens = { ...response.tokens, refresh_token: response.tokens?.refresh_token || current.credentials.refresh_token };
        const published = await transaction.write(tokens, current);
        client.setCredentials(published);
        return published;
      });
      client.setCredentials(credentials);
      return credentials;
    } catch {
      client.setCredentials({});
      throw refused();
    }
  }
  client.refreshToken = client.refreshTokenNoCache = async predecessor => ({ tokens: await refresh(true, predecessor) });
  client.refreshAccessTokenAsync = async () => ({ credentials: await refresh(true) });
  return { current: () => refresh() };
}
