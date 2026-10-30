// Selected native experiment: coordinate refreshed headers and the inspected
// cache/logout, authorization-code and revoke entrypoints.
import { createNativeOAuthTransaction } from '../native-oauth-transaction.mjs';
import { readNativeQwenCredentials as readCredentials } from '../native-qwen/read_credentials.mjs';
import { bindNativeGeminiAccounts, validateNativeGeminiAccounts, refreshNativeGeminiAccount, clearNativeGeminiAccount } from './accounts.mjs';
import path from 'node:path';

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
  validateNativeGeminiAccounts();
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
    await clearNativeGeminiAccount();
  });
}

export async function withNativeGeminiPostAuth(callback) {
  if (!authority || typeof callback !== 'function') throw refused();
  const { file, assertAdmission } = authority;
  return withTransaction(file, async transaction => {
    await assertAdmission();
    validateNativeGeminiAccounts();
    const current = await transaction.snapshot();
    await transaction.reconcile(current);
    return callback(current.credentials);
  });
}

export function bindNativeGeminiWriters(client, { file, rootIdentity, assertAdmission, accountFile, configurationDirectory, onReady, onLogout }) {
  register(file, rootIdentity, assertAdmission);
  bindNativeGeminiAccounts({ privateFile: accountFile, privateCredentialFile: path.join(configurationDirectory, 'oauth_creds.json'), withTransaction });
  const admitted = assertAdmission;
  assertAdmission = async () => {
    await admitted();
    validateNativeGeminiAccounts();
  };
  register(file, rootIdentity, assertAdmission);
  // Capture the actual native HTTP exchange before replacing every inspected
  // refresh entrypoint. Its unawaited token listener was removed by read admission.
  const exchange = client.refreshTokenNoCache.bind(client);
  const authorize = client.getTokenAsync.bind(client);
  const revoke = client.revokeToken.bind(client);
  async function revokeCurrent(explicit) {
    try {
      await assertAdmission();
      return await withTransaction(file, async transaction => {
        await assertAdmission();
        const current = await transaction.snapshot();
        if (explicit !== undefined && explicit !== current.credentials.access_token && explicit !== current.credentials.refresh_token) throw refused();
        // Durable local logout precedes a possibly lost revocation response. A
        // later client must not retain or refresh credentials being revoked.
        await transaction.remove();
        await clearNativeGeminiAccount();
        client.setCredentials({});
        if (onLogout) onLogout();
        const response = await revoke(explicit ?? current.credentials.access_token);
        await assertAdmission();
        return response;
      });
    } catch {
      client.setCredentials({});
      throw refused();
    }
  }
  client.revokeCredentialsAsync = () => revokeCurrent();
  client.revokeToken = (token, callback) => {
    const operation = revokeCurrent(token);
    if (typeof callback !== 'function') return operation;
    operation.then(response => callback(null, response), callback);
  };
  client.getTokenAsync = async options => {
    try {
      await assertAdmission();
      return await withTransaction(file, async transaction => {
        await assertAdmission();
        const previous = await transaction.prepareLogin();
        const response = await authorize(options);
        await assertAdmission();
        // A new login must supply its own complete generation. Never inherit a
        // refresh token belonging to the account which preceded this login.
        const published = await transaction.publishLogin(response.tokens, previous);
        client.setCredentials(published);
        if (onReady) await onReady(client);
        return { ...response, tokens: published };
      });
    } catch {
      client.setCredentials({});
      throw refused();
    }
  };
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
        await refreshNativeGeminiAccount(current.credentials, published);
        client.setCredentials(published);
        if (onReady) await onReady(client);
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
  return {
    current: () => refresh(),
    canLogin: () =>
      withTransaction(file, async transaction => {
        await assertAdmission();
        return (await transaction.prepareLogin()) === null;
      }),
  };
}
